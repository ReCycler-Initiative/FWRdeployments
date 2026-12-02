import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg import Error
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool, PoolTimeout

from app.agents.chain import ROLES, run_chain
from app.config import Settings
from app.models import AnalyzeRequest, BuildRequest
from app.pipeline.signals import signals
from app.pipeline.synthesize import generate_agenda, synthesize
from app.pipeline.transcribe import transcribe
from app.providers import require_openai
from app.ingest import extract_text
from app.paths import project_file
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = Settings()
pool = AsyncConnectionPool(
    conninfo=settings.database_url.get_secret_value(), open=False,
    min_size=1, max_size=5, timeout=5,
    kwargs={"row_factory": dict_row, "connect_timeout": 5},
)
jobs: set[asyncio.Task] = set()
ACCEPTED = {"status": "accepted"}
WORKER_LOCK = 746239180


async def recover_jobs(connection) -> None:
    await connection.execute(
        """UPDATE sessions SET pain_points_json = %s, processed_at = NULL
           WHERE pain_points_json->>'status' = 'running'""",
        (Jsonb({"error": "Worker restarted during analysis; retry the analysis."}),),
    )
    await connection.execute(
        """UPDATE agent_tasks SET status = 'failed',
           output_log = COALESCE(output_log, '') || %s
           WHERE status IN ('pending', 'running') AND project_id IN
           (SELECT id FROM projects WHERE status = 'BUILDING')""",
        ("\nWorker restarted during build. Job failed; human review required.",),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    try:
        await pool.open(wait=True, timeout=30)
        # In-process jobs need one owner; a session lock also prevents startup recovery
        # from declaring another live worker's jobs stale.
        async with pool.connection() as owner:
            locked = await (await owner.execute(
                "SELECT pg_try_advisory_lock(%s) AS locked", (WORKER_LOCK,)
            )).fetchone()
            await owner.commit()
            if not locked["locked"]:
                raise RuntimeError("Another worker owns the background jobs; run one worker replica")
            try:
                await recover_jobs(owner)
                await owner.commit()
                logger.info("Worker started (MOCK_AI=%s)", settings.mock_ai)
                yield
            finally:
                for job in list(jobs):
                    job.cancel()
                await asyncio.gather(*list(jobs), return_exceptions=True)
                await owner.execute("SELECT pg_advisory_unlock(%s)", (WORKER_LOCK,))
                await owner.commit()
    finally:
        await pool.close()


app = FastAPI(title="FRWDeployments Worker", lifespan=lifespan)


@app.exception_handler(Error)
@app.exception_handler(PoolTimeout)
async def database_error(request: Request, exc: Exception):
    logger.error("Database operation failed for %s", request.url.path, exc_info=exc)
    return JSONResponse(status_code=503, content={"detail": "Database unavailable; retry later"})


def enqueue(coroutine) -> None:
    task = asyncio.create_task(coroutine)
    jobs.add(task)

    def done(completed: asyncio.Task) -> None:
        jobs.discard(completed)
        if not completed.cancelled() and completed.exception():
            logger.error("Background job could not persist its outcome", exc_info=completed.exception())
    task.add_done_callback(done)


async def locked_project(connection, project_id: UUID) -> dict:
    project = await (await connection.execute(
        "SELECT * FROM projects WHERE id = %s FOR UPDATE", (project_id,)
    )).fetchone()
    if not project:
        raise HTTPException(404, "Project not found")
    return project


async def context_for(connection, project: dict, analysis_session_id: UUID | None = None) -> dict:
    documents = await (await connection.execute(
        """SELECT filename, content_text FROM context_documents
           WHERE project_id = %s ORDER BY created_at, id""", (project["id"],)
    )).fetchall()
    workshops = await (await connection.execute(
        """SELECT id, title, transcript_vtt, pain_points_json, current_state_mermaid, processed_at, analysis_mode
           FROM sessions WHERE project_id = %s AND id IS DISTINCT FROM %s
           AND (processed_at IS NOT NULL OR (%s::uuid IS NOT NULL AND transcript_vtt IS NOT NULL))
           ORDER BY created_at, id""", (project["id"], analysis_session_id, analysis_session_id)
    )).fetchall()
    return {"project": project, "documents": documents, "previous_workshops": workshops}


def real_config(*, video=False) -> None:
    if settings.mock_ai:
        return
    try:
        require_openai(settings)
        if video and not settings.signals_api_url:
            raise ValueError("Real video signal analysis requires SIGNALS_API_URL")
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/health")
async def health() -> dict:
    async with pool.connection() as connection:
        await connection.execute("SELECT 1")
    return {"status": "ok", "database": "ok", "mock_ai": settings.mock_ai}

@app.get("/capabilities")
async def capabilities() -> dict:
    return {
        "mode": "mock" if settings.mock_ai else "ai",
        "openai_configured": bool(settings.openai_api_key.get_secret_value()),
        "video_signals_configured": bool(settings.signals_api_url),
    }


class AgendaRequest(BaseModel):
    session_id: UUID | None = None


@app.post("/api/projects/{project_id}/generate-agenda")
async def agenda(project_id: UUID, body: AgendaRequest | None = None) -> dict:
    async with pool.connection() as connection:
        async with connection.transaction():
            project = await locked_project(connection, project_id)
            if project["status"] not in ("PREPARATION", "CANDIDATES_READY"):
                raise HTTPException(409, "Työpajarunko voidaan generoida valmistelussa tai työpajojen välillä.")
            real_config()
            context = await context_for(connection, project)
            workshop_id = body.session_id if body else None
            if workshop_id:
                workshop = await (await connection.execute(
                    "SELECT * FROM sessions WHERE id=%s AND project_id=%s FOR UPDATE",
                    (workshop_id, project_id),
                )).fetchone()
                if not workshop:
                    raise HTTPException(404, "Työpaja ei kuulu projektiin.")
                if workshop["video_path"]:
                    raise HTTPException(409, "Tallennetun työpajan runkoa ei voi muuttaa jälkikäteen.")
                context["workshop"] = workshop
            try:
                text = await generate_agenda(settings, context)
            except Exception as exc:
                logger.exception("Agenda generation failed for %s", project_id)
                raise HTTPException(502, f"Agenda generation failed: {failure_detail(exc)}") from exc
            await connection.execute(
                "UPDATE projects SET workshop_agenda = %s, agenda_mode = %s WHERE id = %s",
                (text, "mock" if settings.mock_ai else "ai", project_id),
            )
            if workshop_id:
                await connection.execute(
                    "UPDATE sessions SET agenda=%s, agenda_mode=%s WHERE id=%s",
                    (text, "mock" if settings.mock_ai else "ai", workshop_id),
                )
    return {"agenda": text}


@app.post("/api/projects/{project_id}/analyze", status_code=202)
async def analyze(project_id: UUID, body: AnalyzeRequest) -> dict:
    async with pool.connection() as connection:
        async with connection.transaction():
            project = await locked_project(connection, project_id)
            session = await (await connection.execute(
                "SELECT * FROM sessions WHERE id = %s AND project_id = %s FOR UPDATE",
                (body.session_id, project_id),
            )).fetchone()
            if not session:
                raise HTTPException(404, "Session not found in this project")
            if project["status"] == "BUILDING":
                raise HTTPException(409, "Transkriptiota ei voi muuttaa analyysin tai agenttityön aikana.")
            active = await (await connection.execute(
                """SELECT id FROM sessions WHERE project_id = %s
                   AND pain_points_json->>'status' = 'running'""", (project_id,)
            )).fetchone()
            if active:
                raise HTTPException(409, "An analysis is already running for this project")
            if not session["video_path"] and not session["transcript_path"]:
                raise HTTPException(409, "Työpajalle on ensin lisättävä tallenne tai transkriptio.")
            real_config(video=bool(session["video_path"] and session["video_path"].lower().endswith(".mp4")))
            context = await context_for(connection, project, body.session_id)
            await connection.execute("UPDATE projects SET status='WORKSHOP_UPLOADED' WHERE id=%s", (project_id,))
            await connection.execute("UPDATE solution_candidates SET is_superseded=true WHERE project_id=%s", (project_id,))
            await connection.execute(
                """UPDATE sessions SET pain_points_json = %s, processed_at = NULL,
                   current_state_mermaid = NULL, analysis_mode = NULL WHERE id = %s""",
                (Jsonb({"status": "running"}), body.session_id),
            )
    enqueue(analysis_job(project_id, body.session_id, session, context))
    return ACCEPTED


class ContextFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


@app.post("/api/projects/{project_id}/extract-context")
async def extract_context(project_id: UUID, body: ContextFileRequest) -> dict:
    async with pool.connection() as connection:
        project = await locked_project(connection, project_id)
        if project["status"] not in ("PREPARATION", "CANDIDATES_READY"):
            raise HTTPException(409, "Taustamateriaaleja ei voi lisätä käsittelyn aikana.")
    try:
        path = project_file(settings.media_dir, project_id, body.path)
        text = await asyncio.wait_for(asyncio.to_thread(extract_text, path), timeout=30)
    except (ValueError, UnicodeError) as exc:
        logger.warning("Context extraction rejected for %s: %s", project_id, exc)
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        logger.exception("Context extraction failed for %s", project_id)
        raise HTTPException(422, "Tiedoston tekstin poiminta epäonnistui. Tarkista tiedosto.") from exc
    return {"content_text": text}


def failure_detail(exc: BaseException) -> str:
    if isinstance(exc, asyncio.CancelledError):
        return "Worker shutting down; job interrupted"
    if isinstance(exc, TimeoutError):
        return "Job exceeded JOB_TIMEOUT_SECONDS"
    # Provider exceptions can contain request bodies, URLs and credentials.
    if isinstance(exc, ValueError):
        return str(exc)[:1000]
    return f"{type(exc).__name__}: provider or job failed; see worker logs"


async def analysis_job(project_id: UUID, session_id: UUID, session: dict, context: dict) -> None:
    try:
        async with asyncio.timeout(settings.job_timeout_seconds):
            logger.info("Analysis started project=%s session=%s", project_id, session_id)
            language = context["project"].get("language", "fi")
            transcript = await transcribe(settings, project_id, session, language)
            observations = await signals(settings, project_id, session, transcript, language)
            result = await synthesize(settings, context, transcript, observations)
            async with pool.connection() as connection:
                async with connection.transaction():
                    project = await locked_project(connection, project_id)
                    if project["status"] != "WORKSHOP_UPLOADED":
                        raise ValueError("Project state changed during analysis")
                    await connection.execute(
                        """UPDATE sessions SET transcript_vtt = %s, pain_points_json = %s,
                           current_state_mermaid = %s, analysis_mode = %s, processed_at = now()
                           WHERE id = %s AND project_id = %s""",
                        (transcript, Jsonb([p.model_dump() for p in result.pain_points]),
                         result.current_state_mermaid, "mock" if settings.mock_ai else "ai", session_id, project_id),
                    )
                    await connection.execute(
                        "UPDATE solution_candidates SET is_superseded=true WHERE project_id = %s", (project_id,)
                    )
                    for candidate in result.candidates:
                        await connection.execute(
                            """INSERT INTO solution_candidates
                               (project_id, title, summary, benefits, risks, architecture_spec, solution_type, generation_mode)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                            (project_id, candidate.title, candidate.summary,
                             Jsonb(candidate.benefits), Jsonb(candidate.risks),
                             candidate.architecture_spec, candidate.solution_type, "mock" if settings.mock_ai else "ai"),
                        )
                    await connection.execute(
                        "UPDATE projects SET status = 'CANDIDATES_READY' WHERE id = %s", (project_id,)
                    )
            logger.info("Analysis completed project=%s", project_id)
    except (Exception, asyncio.CancelledError) as exc:
        logger.exception("Analysis failed project=%s session=%s", project_id, session_id)
        async with pool.connection() as connection:
            await connection.execute(
                "UPDATE sessions SET pain_points_json = %s, processed_at = NULL WHERE id = %s AND project_id = %s",
                (Jsonb({"error": failure_detail(exc)}), session_id, project_id),
            )


@app.post("/api/projects/{project_id}/build", status_code=202)
async def build(project_id: UUID, body: BuildRequest) -> dict:
    async with pool.connection() as connection:
        async with connection.transaction():
            project = await locked_project(connection, project_id)
            candidate = await (await connection.execute(
                "SELECT * FROM solution_candidates WHERE id = %s AND project_id = %s FOR UPDATE",
                (body.candidate_id, project_id),
            )).fetchone()
            if not candidate:
                raise HTTPException(404, "Candidate not found in this project")
            if candidate["is_superseded"]:
                raise HTTPException(409, "Ratkaisun lähdeaineisto on muuttunut. Päivitä analyysi ja valitse ajantasainen ehdotus.")
            if project["status"] in ("BUILDING", "READY_FOR_REVIEW") and candidate["is_selected"] and project["delivery_mode"] == "AGENTS":
                return ACCEPTED
            if project["status"] not in ("CANDIDATES_READY", "READY_FOR_REVIEW"):
                raise HTTPException(409, "Valintaa voi muuttaa vain valmiiden ratkaisujen tai valmiin toimituksen vaiheessa.")
            selected = await (await connection.execute(
                "SELECT id FROM solution_candidates WHERE project_id=%s AND is_selected", (project_id,)
            )).fetchone()
            if selected and (
                "expected_delivery_id" not in body.model_fields_set
                or body.expected_delivery_id != project["active_delivery_id"]
            ):
                raise HTTPException(409, "Valinta on muuttunut tai vahvistus puuttuu. Päivitä työtila ja vahvista muutos uudelleen.")
            real_config()
            context = await context_for(connection, project)
            context["candidate"] = candidate
            delivery_id = uuid4()
            await connection.execute(
                "UPDATE solution_candidates SET is_selected = false WHERE project_id = %s", (project_id,)
            )
            await connection.execute(
                "UPDATE solution_candidates SET is_selected = true WHERE id = %s", (body.candidate_id,)
            )
            await connection.execute(
                """UPDATE projects SET status = 'BUILDING', delivery_mode = 'AGENTS',
                   active_delivery_id = %s WHERE id = %s""", (delivery_id, project_id)
            )
            await connection.execute(
                """UPDATE solution_candidates SET implementation_status = 'IN_PROGRESS',
                   implementation_updated_at = now() WHERE id = %s""", (body.candidate_id,)
            )
            task_ids = {}
            for role in ROLES:
                task = await (await connection.execute(
                    """INSERT INTO agent_tasks (project_id, candidate_id, agent_role, output_log, generation_mode, delivery_id)
                       VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                    (project_id, body.candidate_id, role,
                     "Waiting for the previous agent to finish." if project.get("language") == "en"
                     else "Odottaa edellisen agentin valmistumista.", "mock" if settings.mock_ai else "ai", delivery_id),
                )).fetchone()
                task_ids[role] = task["id"]
    enqueue(build_job(project_id, context, task_ids, delivery_id))
    return ACCEPTED


async def build_job(project_id: UUID, context: dict, task_ids: dict, delivery_id: UUID) -> None:
    active_role = ROLES[0]
    root = settings.media_dir / str(project_id) / "artifacts" / "delivery" / str(delivery_id)

    async def started(role: str) -> None:
        nonlocal active_role
        active_role = role
        logger.info("Build project=%s role=%s started", project_id, role)
        async with pool.connection() as connection:
            await connection.execute(
                """UPDATE agent_tasks SET status = 'running', output_log = output_log || %s
                   WHERE id = %s""",
                (f"\n{role}: {'planning in progress' if context['project'].get('language') == 'en' else 'suunnittelu käynnissä'}. MOCK_AI={settings.mock_ai}", task_ids[role]),
            )

    async def finished(role, output, paths) -> None:
        async with pool.connection() as connection:
            await connection.execute(
                """UPDATE agent_tasks SET status = 'completed', output_log = output_log || %s,
                   artifacts_path = %s WHERE id = %s""",
                ("\n" + output.summary + "\n" + "\n".join(paths),
                 str(root / role), task_ids[role]),
            )
        logger.info("Build project=%s role=%s completed", project_id, role)

    try:
        async with asyncio.timeout(settings.job_timeout_seconds):
            root.mkdir(parents=True, exist_ok=True)
            if not root.resolve().is_relative_to(settings.media_dir.resolve()):
                raise ValueError("Artifact sandbox escapes MEDIA_DIR")
            await run_chain(settings, context, root, started, finished)
            async with pool.connection() as connection:
                async with connection.transaction():
                    project = await locked_project(connection, project_id)
                    if project["status"] != "BUILDING" or project["active_delivery_id"] != delivery_id:
                        raise ValueError("Project state changed during build")
                    await connection.execute(
                        "UPDATE projects SET status = 'READY_FOR_REVIEW' WHERE id = %s", (project_id,)
                    )
                    await connection.execute(
                        """UPDATE solution_candidates SET implementation_status = 'IN_REVIEW',
                           implementation_updated_at = now() WHERE project_id = %s AND is_selected""",
                        (project_id,),
                    )
    except (Exception, asyncio.CancelledError) as exc:
        logger.exception("Build failed project=%s role=%s", project_id, active_role)
        async with pool.connection() as connection:
            await connection.execute(
                """UPDATE agent_tasks SET status = 'failed', output_log = COALESCE(output_log, '') || %s
                   WHERE project_id = %s AND id = ANY(%s) AND status IN ('pending', 'running')""",
                (f"\nFAILED at {active_role}: {failure_detail(exc)}. Remaining chain stopped.",
                 project_id, list(task_ids.values())),
            )
            await connection.execute(
                """UPDATE solution_candidates SET implementation_status = 'BLOCKED',
                   implementation_updated_at = now() WHERE project_id = %s AND is_selected""",
                (project_id,),
            )
