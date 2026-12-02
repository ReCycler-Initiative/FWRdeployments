# FRWDeployments MVP — setup and development reference

For the full workflow, migrations, privacy boundaries and real/mock integrations,
see the [README](readme.md). The [concept](konsepti_ja_mvp_suunnitelma.md) also
describes the longer-term vision; it is not a claim that every roadmap feature
exists in this MVP.

## Start the local environment

Docker Desktop and Docker Compose v2 are required. On a new installation copy
`.env.example` to `.env`. Leave provider keys empty with `MOCK_AI=true`.
Development database credentials must not be used in a real deployment.

```sh
docker compose up --build -d
docker compose logs -f frw_worker frw_web
curl --fail http://localhost:18001/health
curl --fail http://localhost:3001/api/health
```

This workspace uses web port **3001**, worker **18001** and PostgreSQL **5435**,
because other applications occupy the defaults. A fresh `.env.example` defaults
to 3000, 8000 and 5433; adapt the example URLs accordingly.

- Database from containers: `frw_postgres:5432`.
- Worker from the web container: `http://frw_worker:8000`.
- Both applications share `frw_media_storage` at `/app/media`.
- Media is not automatically exposed as a public directory.
- Port overrides: `WEB_PORT`, `WORKER_PORT`, `POSTGRES_PORT`.
- Compose v2 may warn that the supplied `version: '3.9'` field is obsolete.

`docker compose down` stops this stack while preserving database and media
volumes. Initialization SQL runs only on an empty database; use the ordered,
additive migrations for upgrades. See the [README migration guide](readme.md#upgrading-an-existing-database).

## Implementation notes

- PostgreSQL 16 + pgvector, five core tables, foreign keys, state constraints,
  automatic update timestamps and at most one selected candidate per project.
- Python 3.11+ FastAPI worker with a connection pool. `/health` includes
  `mock_ai`; database failures return HTTP 503.
- Next.js App Router, TypeScript, Tailwind and server-side PostgreSQL access.
  `/api/health` checks the database. Builds do not download remote fonts.
- TypeScript stays on scaffold-compatible 5.x; 7.x is incompatible with the
  current ESLint dependencies. Cache Components are disabled so database pages
  can render dynamically without a build-time database connection.
- The web container builds then serves Next.js. Source mounts do not provide
  automatic reload in this mode: restart after changes. Keep `.next` and
  `node_modules` isolated from host builds.
- FI/EN selection is a persistent browser preference. Project content language
  is stored separately and defaults to the current UI language at creation.
  Existing source text and generated content are never translated on navigation.

## End-to-end workflow

1. Create a project and add context text, files or a GitHub snapshot.
2. Plan one or more workshops and generate individual agendas and questions.
3. Attach MP4 (100 MB maximum) or UTF-8 VTT/TXT (2 MB maximum). VTT requires
   a `WEBVTT` header. Files receive UUID-based names inside project media.
4. Review workshop-specific quotes, pain points, Mermaid diagrams and three
   alternatives. Later workshops retain history and refresh current candidates.
5. Review the live canvas and refine/export Copilot/Claude prompts or a plan.
6. Approve a candidate with `REPORT` (default), `RECOMMENDATION`, `PROCESS`,
   `GUIDE`, `EXPERIMENT`, `PROMPTS`, `PLAN` or explicitly `AGENTS` delivery.
   Only the last starts `BUILDING` and the four-role agent chain.
7. Review/download the actual document in **Outputs**. Track report acceptance,
   process changes or other follow-up work manually; output readiness is not proof
   of achieved benefit.

Analysis and builds poll every two seconds. Analysis errors are visible and
retryable. Failed agent delivery is never marked ready. Mock quotes/signals and
artifacts are explicitly simulated. Generated code and tests are not executed.
Static HTML review is sandboxed and cannot run scripts or make network requests.

## API reference

### Web

| Method and route | Input / purpose |
| --- | --- |
| `POST /api/locale` | `{locale: "fi" \| "en"}`; save UI preference cookie |
| `POST /api/projects` | `{title, description, target_systems: string[], language?: "fi" \| "en"}` |
| `GET /api/projects` | All projects |
| `GET /api/projects/{id}` | Complete project workspace |
| `DELETE /api/projects/{id}` | `{confirmed: true}`; permanently delete the project, dependent rows and its media; 409 during active analysis/agent tasks |
| `POST /api/projects/{id}/context` | `{filename, content_text}` |
| `POST /api/projects/{id}/context/file` | Multipart `file` |
| `POST /api/projects/{id}/context/github` | `{url, ref?, token?}`; ephemeral read-only token |
| `POST /api/projects/{id}/workshops` | `{title, notes?, scheduled_at?, meeting_url?}` |
| `GET /api/projects/{id}/workshops/{sessionId}/transcripts` | List current named sources |
| `POST /api/projects/{id}/workshops/{sessionId}/transcripts` | Multipart VTT/TXT `file`, optional `title`; add a source without AI calls; reject identical spoken-content copies with 409 |
| `PUT /api/projects/{id}/workshops/{sessionId}/transcripts/{transcriptId}` | Replace only the selected source; invalidate analysis, preserve other sources and deliveries |
| `DELETE /api/projects/{id}/workshops/{sessionId}/transcripts/{transcriptId}` | Remove only the selected source; retain workshop/video/deliveries |
| `POST /api/projects/{id}/workshops/{sessionId}/transcript` | Compatibility alias for additive upload, not replacement |
| `DELETE /api/projects/{id}/workshops/{sessionId}/transcript` | Compatibility singleton removal; 409 when multiple transcripts require an explicit ID |
| `POST /api/projects/{id}/agenda` | Optional `{session_id}`; project or individual agenda |
| `POST /api/projects/{id}/sessions` | Multipart `file`, `title`, optional `session_id`, optional `analyze` (`true` by default; UI sends `false` to save only). VTT/TXT adds a source; MP4 preserves transcripts and never overwrites a video. Use the transcript item route for replacement. |
| `POST /api/projects/{id}/analyze` | `{session_id}`; retry analysis |
| `POST /api/projects/{id}/build` | `{candidate_id, expected_delivery_id?}`; explicitly request agents |
| `POST /api/projects/{id}/approve` | `{candidate_id, delivery_mode: "REPORT" \| "RECOMMENDATION" \| "PROCESS" \| "GUIDE" \| "EXPERIMENT" \| "PROMPTS" \| "PLAN", refinement?, expected_delivery_id?}` |
| `PATCH /api/projects/{id}/implementation` | `{candidate_id, implementation_status, implementation_notes, implementation_url}` |
| `POST /api/projects/{id}/prompts` | `{candidate_id, target?: "prompt" \| "plan", refinement?}` |
| `GET /api/projects/{id}/prompts?candidate_id=...&target=prompt` | Export the shared implementation prompt; also supports `plan` |
| `GET /api/projects/{id}/artifacts?path=...` | Text preview; append `&download=1` to download |

Prompt refinement is local mock templating, not paid LLM optimization.
Legacy `copilot`/`claude` target aliases return the same tool-neutral prompt.
Prompt delivery now writes one `implementation-prompt.md`, not duplicate exports.
Future ChatGPT-assisted solution refinement is not activated by adding an API key.
The five non-code output types produce standalone Markdown documents, not prompts.
They are local template drafts with source excerpts in mock mode and structured
OpenAI drafts in real mode. Output refinements scope that document, not the candidate
set. No external research or independent source verification is performed.
Documents label source-reported information, proposals and uncertainty. Unknown
source references are rejected; provider failures do not fall back to demo content.
Output provenance is persisted in `projects.delivery_generation_mode` and an
immutable per-version `output-provenance.json`; switching to a local plan/prompt
clears the current generation mode without rewriting historical metadata.
Transcript saves use `pain_points_json: {status: "pending"}`; an explicit analyze
action consumes every current source in the workshop. Workspace sessions expose
`transcripts[]` with source IDs, names, filenames and original content.
`transcript_vtt`, `transcript_path` and `transcript_filename` on the session are
derived compatibility caches, not additional sources. Multi-source timestamps
are local to their source; real pain points identify it with `transcript_id`.
Multiple transcripts use text-only analysis rather than aligning independent
clocks with one video's measured signals.

An explicit analyze
request transitions to `running`. Corrections clear the affected analysis and
supersede candidates without deleting previous candidate/agent records.
Explicit analysis can also update a previously analyzed workshop, except during
an active analysis or `BUILDING`. Unprocessed saved transcripts from other workshops
are included as source context. Outdated selected candidates remain visible but
cannot be reapproved; regenerate and confirm a current candidate instead.
External implementation status is manual, not automatic GitHub synchronization.

### Worker

- `GET /health`
- `GET /capabilities` — current mode and provider/signal-service configuration
  booleans only; no secrets and no claim that real calls have succeeded
- `POST /api/projects/{id}/generate-agenda` with optional `{session_id}`
- `POST /api/projects/{id}/generate-output` with `{candidate_id, output_type, refinement?}`;
  `output_type` is one of the five non-code types. Returns `{content, generation_mode,
  source_ids, external_research: false}` without changing the decision or writing
  files; the web transaction owns approval and versioned persistence. Input is
  limited to 200,000 serialized characters; generation times out after 110 seconds.
- `POST /api/projects/{id}/extract-context` with `{path}`
- `POST /api/projects/{id}/analyze` with `{session_id}`
- `POST /api/projects/{id}/build` with `{candidate_id}`

The web calls the worker server-side. State transitions and project ownership
are checked against the database, not trusted from UI state.
Workspace responses include safe runtime AI status separately from persisted
output provenance (`mock`, `ai`, or null for unknown). Enabling OpenAI does not
reclassify historical demos. VTT/TXT content analysis does not require video.
Generated candidates and new exports contain no price estimates. Legacy stored
costs and previously accepted immutable exports are not rewritten.
Changing an approved candidate or outcome requires `expected_delivery_id` matching
the current workspace value (explicit `null` for legacy deliveries). Replacements
are accepted in `READY_FOR_REVIEW` or `CANDIDATES_READY` after reanalysis, not
`BUILDING`. Each replacement gets a new `active_delivery_id`; agent tasks
carry the same `delivery_id`. Earlier files/logs are retained, not overwritten.

## Checks

```sh
docker compose config --quiet
docker compose exec frw_web npm run lint
docker compose exec frw_web npm run typecheck
docker compose exec frw_worker python -m unittest discover -s tests -v
```

In an isolated validation stack:

```sh
docker compose exec frw_web npm run build
docker compose exec -e TEST_WEB_URL=http://127.0.0.1:3000 frw_web npm run test:integration
docker compose exec -T frw_postgres psql -U frw_admin -d frwdeployments \
  -v ON_ERROR_STOP=1 < db/schema_test.sql
```

Use the configured database credentials. The SQL test checks constraints, vector
dimension, update timestamps and cascading deletion, then rolls back. Integration
tests require mock mode, create their own projects and remove their own data.
Never rebuild the live demo's `.next` directory while it is serving requests.

This local MVP has no authentication or tenant isolation. Protect services before
external use and obtain consent before processing recordings or calling AI providers.
