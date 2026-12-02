# FRWDeployments

A facilitated Forward Deployment workspace: turn context and multiple workshops
into solution candidates, reviewable artifacts, implementation plans and
ready-to-use GitHub Copilot or Claude prompts.

**An agent farm is optional, not the default outcome.** A reviewed live canvas,
prompt package or implementation plan may be sufficient. Code generation starts
only when agent delivery is explicitly selected.

## Quick start

Requires Docker Desktop and Docker Compose v2. For a fresh installation:

```sh
cp .env.example .env
docker compose up --build -d
docker compose logs -f frw_web frw_worker
```

The local `.env` already exists. Do not overwrite it when upgrading.

| Service | Default address | This workspace |
| --- | --- | --- |
| Project workspace | http://localhost:3000 | http://localhost:3001 |
| Worker / OpenAPI | http://localhost:8000/docs | http://localhost:18001/docs |
| PostgreSQL 16 + pgvector | localhost:5433 | localhost:5435 |

Set `WEB_PORT`, `WORKER_PORT` and `POSTGRES_PORT` in `.env` when ports are occupied.
Do not stop unrelated applications. Internal addresses stay `frw_postgres:5432`
and `http://frw_worker:8000`. Both applications share `/app/media`.

The web container builds and starts Next.js in production mode for a stable
local demo; it is **not a hardened production deployment**. Source directories
are mounted, but changes require `docker compose restart frw_web frw_worker`.
After changing web dependencies, run `docker compose exec frw_web npm ci`
before restarting. For interactive web development, run `npm run dev` in
[web](web/) with the appropriate database and worker environment variables.

### Upgrading an existing database

[db/init.sql](db/init.sql) runs only against an empty database. Apply the
additive migrations in order to an older installation:

```sh
for migration in db/migrations/*.sql; do
  docker compose exec -T frw_postgres psql -U frw_admin -d frwdeployments \
    -v ON_ERROR_STOP=1 < "$migration" || break
done
```

Use your configured database credentials. Migrations preserve existing data.
Migration 006 gives existing projects Finnish content language.
Migration 007 records output provenance (`mock`, `ai`, or unknown) for agendas,
analysis, candidates and agent tasks. It recognizes known historical demo markers;
unrecognized older results remain explicitly unverified. Switching provider
configuration never relabels existing results.
Migration 008 adds delivery versions. Legacy deliveries remain accessible without
inventing a version identifier; subsequent approvals use distinct version folders.
Migration 009 adds per-workshop transcript file metadata and superseded candidates.
Recognizable existing VTT/TXT uploads remain linked to their original workshops.

## Finnish and English

Use **FI / EN** in the top navigation. The preference is saved in a browser
cookie for one year and applies across projects and reloads.

New projects have a separate **content language**, defaulting to the current
UI language. Agendas, analysis, agent drafts and exported prompts/plans follow
that project setting. Changing the UI language does not translate or replace
existing projects, imported source documents, user notes or generated artifacts.
Project content language is selected on creation; editing it later is not part
of this MVP.
Workshop and agent timestamps use the browser's local time zone after hydration;
the initial server-rendered timestamps use UTC to keep rendering consistent.

## Workflow

1. **Create a project:** title, business goal, existing systems and content language.
   The environment supports multiple independent project workspaces.
2. **Gather context:** paste process descriptions or import TXT, Markdown, CSV,
   JSON, VTT, PDF or DOCX files. PDF/DOCX extraction runs locally in the worker.
3. **Import a GitHub source:** provide `https://github.com/owner/repo`, optionally
   a branch/commit and a fine-grained token with **Contents: read-only** access.
   The token is used only for that request and is never stored. Import records
   a bounded text snapshot and commit SHA, not a clone or continuous sync.
4. **Plan multiple workshops:** give each a title, focus, optional time and HTTPS
   meeting link. Generate a separate timed agenda and questions for each workshop.
   Individual agendas do not overwrite each other.
5. **Add workshop evidence:** choose an existing workshop (including one already
   held), or create a new one, then add an MP4, VTT or TXT recording/transcript.
   Adding evidence only saves it; **Analyze workshop** is a separate action.
   A video can be added to a workshop that already has a transcript, without
   losing the transcript. Existing videos cannot be overwritten by this form.
   Adding VTT/TXT to an existing workshop replaces its transcript with a warning.
   Open a workshop's title in **Workshop history** to inspect its details,
   agenda and transcript controls without leaving the Workshop stage.
   **View this workshop's analysis** is a separate, explicit navigation action.
   Each new synthesis considers prior workshops and refreshes current candidates.
   Each workshop also has **Add transcript**, **Replace transcript**, **View
   transcript** and **Remove transcript** controls in Preparation and Workshop.
   Saving a VTT/TXT file makes no AI calls: choose **Analyze workshop** separately.
   You can correct an already held workshop, including after a delivery.
   Changes clear that workshop's previous analysis and mark existing proposals
   outdated. Names, notes, agenda, meeting details, other workshops and any video
   are retained. The replaced/removed source file is deleted; earlier immutable
   deliveries and downloaded copies may still contain the original material.
   Changes are blocked while an analysis or agent build is running.
   Explicit reanalysis creates current proposals while keeping previous decisions,
   agent logs and delivery files. Outdated proposals cannot be approved again.
6. **Review solutions:** inspect timestamped pain points, quotes, intensity and
   the Mermaid current-state process. Compare three candidates by benefits,
   risks, architecture and recorded provenance. Solution prices are not generated
   or displayed. The nullable legacy database cost column is retained for upgrades.
7. **Use the live canvas:** review the relationship between the goal, selected
   outline and delivery path, alongside architecture and emerging artifacts.
   HTML previews are static sandboxed iframes: scripts, network access and form
   submissions are blocked. This is not arbitrary code execution or a running
   deployed application.
8. **Prepare an export:** copy/download one portable implementation prompt built
   from the workshop history, sources and candidate. Add facilitator constraints
   and choose **Update refined draft**. Refinement is a local template operation;
   it needs no ChatGPT key and makes no paid API calls. Unapproved candidate
   prompts permit planning only. Check confidentiality before transferring
   exported material to an external tool.
   The same prompt works with Copilot, Claude or another tool; the service does
   not generate duplicate tool-branded versions. Saved workshop transcripts are
   included as original source material, with provenance warnings on analysis.
   ChatGPT-assisted improvement of the solution set before export is a future
   feature, not the current local template refinement; a key alone cannot enable it.
9. **Approve a candidate and choose sufficient delivery:**
   - **Implementation prompt** (default): persist one tool-neutral Markdown prompt,
     without starting agents.
   - **Implementation plan:** deliver scope, milestones, decision gates, risks
     and acceptance criteria, without automatic coding.
   - **Agent delivery:** an explicit four-stage LangGraph chain
     (`architect → coder → data → qa`) produces reviewable draft artifacts.
     Tasks, logs and canvas refresh every two seconds.

Prompt and plan deliveries go directly to `READY_FOR_REVIEW`. Agent delivery
passes through `BUILDING`. Approval stores the current refinements in immutable
delivery files; subsequent canvas drafts do not replace those accepted exports.
Previously accepted files are retained unchanged, including any historical content.
New prompt/plan exports contain provenance notices and no generated budget section.

### Compare alternatives and change an approved selection

The canvas selector changes only what is being reviewed, not the approved solution.
Use **Compare alternatives or change selection** in Delivery to return to Solutions.
Choose an outcome, then **Switch to this solution** on an alternative card (or
**Change outcome** on the current solution). A confirmation shows the new candidate
and outcome before anything changes. Canceling leaves the decision untouched.

Replacement is available in `READY_FOR_REVIEW`, or with current `CANDIDATES_READY`
proposals after reanalysis, not `BUILDING`. An active or failed
build must be resolved before changing selection. Stale confirmations are rejected;
refresh and confirm the current decision again. External implementation work is not
reverted, and per-candidate progress notes and statuses are retained.

Every new approval has a distinct delivery folder. **Previous deliveries** retains
earlier files for preview/download, clearly separate from the current outcome.
Agent logs remain stored; the Kanban shows only the active delivery's four tasks.
Returning to a previously selected candidate creates a new run without overwriting
its earlier files. Repeating the same active approval does not create duplicates.

### Track implementation outside the workspace

Candidates may be **technical**, **process improvements** or **hybrid**.
Solutions remains the coordination view when implementation happens in Copilot,
Claude or the customer's own team.

The selected candidate has an independent implementation status:

```text
NOT_STARTED → IN_PROGRESS → IN_REVIEW → COMPLETED
                  ↕
               BLOCKED
```

Update status, progress notes and a GitHub repository/issue/PR link in Solutions
or Delivery. **A prompt package can be ready while implementation has not started.**
Agent delivery moves implementation to `IN_PROGRESS`, then `IN_REVIEW`; only
a person marks it complete. GitHub progress is not synchronized automatically.

### Delete a project

Use **Delete project** in the project workspace header. A confirmation dialog names
the project and explains that its database records, workshops, transcripts, context
materials and project media/deliveries will be permanently removed. **Cancel** or
Escape leaves everything unchanged. After confirmation, return to the project list.
Deletion is blocked while analysis or agent tasks are running. Other projects,
already downloaded copies and external GitHub repositories are not affected.
File-removal errors are reported and roll back the database deletion for retry.

## Mock mode and real integrations

`MOCK_AI=true` works without API keys. Example quotes, emotional peaks,
architecture, code and tests are explicitly labeled simulated. They are not
observations from a recording, measured emotions or executed tests. The mock
coder also creates a static HTML prototype for canvas review.
Mock synthesis uses fixed example pain points, diagrams and solution candidates:
uploading a different transcript does not make these examples evidence-based.
The workspace shows a demo/API status banner and separate persistent provenance
labels on existing outputs. Candidate approval or prompt export does not validate
a simulated solution. Unknown provenance is never presented as verified AI output.

To enable evidence-based generation, an administrator must configure an
OpenAI **API** key with API billing, set `MOCK_AI=false`, and recreate the worker:

```sh
docker compose up -d --no-deps --force-recreate frw_worker
```

Changing the environment file and only restarting does not update container
environment variables. ChatGPT subscriptions do not provide API billing.
Never paste API keys into project material. Real provider calls have not been
validated with a paid account in this MVP. Configuration is not proof of success.
Old demo outputs remain demos; explicitly regenerate them after configuration
(workshop analysis can be rerun before candidate approval).

`MOCK_AI=false` uses:

- `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-4o-mini`) for structured
  agendas, synthesis and LangGraph role outputs.
- `WHISPER_MODEL` (default `whisper-1`) for MP4 audio extraction using ffmpeg
  and Whisper transcription with segment timestamps.
- `SIGNALS_API_URL` and optional `SIGNALS_API_KEY` for a separately implemented
  audio/microexpression measurement service. This MVP includes the HTTP adapter,
  **not a local wav2vec2 or MediaPipe implementation**. Multipart fields are
  `video`, `transcript_vtt`, `language`; the expected JSON response is:

```json
{
  "signals": [{
    "timestamp_seconds": 12,
    "emotion": "tentative interpretation",
    "intensity": 0.6,
    "audio_observation": "observation relative to the speaker baseline",
    "microexpression_observation": "observation relative to the speaker baseline"
  }],
  "baseline_method": "Describe speaker-specific calibration",
  "limitations": "Describe uncertainty and measurement limitations"
}
```

Real video analysis fails explicitly if the signal service is not configured.
**VTT/TXT content analysis needs OpenAI, not video or a signal service.**
Text-only analysis has no audio/face measurements and
TXT timestamps are estimates. Failures never silently fall back to mock results.
Provider keys remain server-side. Real AI calls can transfer input material
to the configured providers; obtain the necessary consent first. Paid AI and
private-token integrations are not required for the mock validation suite.

## Structure and state

```text
db/init.sql                  core tables, constraints and pgvector
db/migrations/               additive upgrades
web/src/lib/                 types, database, media, GitHub import, prompts, locale
web/src/components/          workspace, workshop planner, canvas, artifact review
web/src/app/api/              server-side routes
worker/app/pipeline/          transcription, signals and synthesis
worker/app/agents/            four-role LangGraph chain
worker/tests/                focused pipeline and adapter tests
```

Core tables: `projects`, `context_documents`, `sessions`, `solution_candidates`,
`agent_tasks`. Each project has its own media under `/app/media/{project_id}/`.

```text
PREPARATION → WORKSHOP_UPLOADED → CANDIDATES_READY → BUILDING → READY_FOR_REVIEW
                                    │
                                    └→ another workshop → WORKSHOP_UPLOADED
```

For `PROMPTS` and `PLAN`, `CANDIDATES_READY → READY_FOR_REVIEW` skips `BUILDING`.
`projects.delivery_mode` records the delivery choice; only `AGENTS` creates tasks.

## Validation

```sh
docker compose config --quiet
docker compose exec frw_web npm run lint
docker compose exec frw_web npm run typecheck
docker compose exec frw_worker python -m unittest discover -s tests -v
```

Run builds and integration tests in a separate validation stack, not while
serving the demo from the same Next.js build directory:

```sh
docker compose exec frw_web npm run build
docker compose exec -e TEST_WEB_URL=http://127.0.0.1:3000 frw_web npm run test:integration
docker compose exec -T frw_postgres psql -U frw_admin -d frwdeployments \
  -v ON_ERROR_STOP=1 < db/schema_test.sql
```

Integration tests require mock mode and an isolated development database. They
exercise project creation, sources, multiple workshops, candidate approval,
optional deliveries, external progress and artifacts, and remove their own
projects/media. The SQL test rolls its changes back.

## Limits and privacy

- Trusted local-team MVP: no authentication, tenant isolation, secrets vault
  or public-service authorization layer. Do not expose it directly to the internet.
- Multiple projects have independent sources, sessions, candidates and media,
  but this is not access isolation between customer organizations.
- Background context: 10 MB / 100,000 extracted characters; PDF: 100 pages,
  no scanned-document OCR. GitHub: up to 20 files, 64 KB per file and 190,000
  characters total. Import explicitly reports snapshot limits.
- MP4: 100 MB; UTF-8 VTT/TXT: 2 MB. Whisper's 24 MB extracted audio limit may
  require splitting longer recordings.
- Jobs run in one worker process, not a durable queue. Restart marks interrupted
  jobs failed; analysis can be retried, failed agent delivery needs human review.
- Approval locks the solution. Post-approval versioned replanning is out of scope.
- Artifact text preview: 128 KB; download: 10 MB. Paths are confined to the
  project's artifact directory. Generated code is never automatically executed.
- Review, test and secure any real implementation before deployment. Emotional
  signals are not proof of a person's internal state.
- Obtain participant consent and source-processing/transfer rights. Do not import
  repository secrets or unnecessary personal data. Production GitHub access needs
  a GitHub App/OAuth and encrypted credential lifecycle.
- **FRWDeployment Notetaker** is a future roadmap item only. The MVP does not
  book calendars, send invitations, open meeting links in the background or join
  calls. Workshop recording upload is manual.

See [setup/API reference](COPILOT_SETUP_AND_PROMPTS.md) and
[concept and roadmap](konsepti_ja_mvp_suunnitelma.md).
