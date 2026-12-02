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
6. Approve a candidate with `PROMPTS`, `PLAN` or explicitly `AGENTS` delivery.
   Only the last starts `BUILDING` and the four-role agent chain.
7. Track implementation manually even if coding happens in another tool;
   delivery readiness and implementation completion are independent.

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
| `POST /api/projects/{id}/context` | `{filename, content_text}` |
| `POST /api/projects/{id}/context/file` | Multipart `file` |
| `POST /api/projects/{id}/context/github` | `{url, ref?, token?}`; ephemeral read-only token |
| `POST /api/projects/{id}/workshops` | `{title, notes?, scheduled_at?, meeting_url?}` |
| `POST /api/projects/{id}/agenda` | Optional `{session_id}`; project or individual agenda |
| `POST /api/projects/{id}/sessions` | Multipart `file`, `title`, optional `session_id` |
| `POST /api/projects/{id}/analyze` | `{session_id}`; retry analysis |
| `POST /api/projects/{id}/build` | `{candidate_id}`; explicitly request agents |
| `POST /api/projects/{id}/approve` | `{candidate_id, delivery_mode: "PROMPTS" \| "PLAN", refinement?}` |
| `PATCH /api/projects/{id}/implementation` | `{candidate_id, implementation_status, implementation_notes, implementation_url}` |
| `POST /api/projects/{id}/prompts` | `{candidate_id, target: "copilot" \| "claude" \| "plan", refinement?}` |
| `GET /api/projects/{id}/prompts?candidate_id=...&target=copilot` | Export a prompt draft; also supports `claude` and `plan` |
| `GET /api/projects/{id}/artifacts?path=...` | Text preview; append `&download=1` to download |

Prompt refinement is local mock templating, not paid LLM optimization.
External implementation status is manual, not automatic GitHub synchronization.

### Worker

- `GET /health`
- `POST /api/projects/{id}/generate-agenda` with optional `{session_id}`
- `POST /api/projects/{id}/extract-context` with `{path}`
- `POST /api/projects/{id}/analyze` with `{session_id}`
- `POST /api/projects/{id}/build` with `{candidate_id}`

The web calls the worker server-side. State transitions and project ownership
are checked against the database, not trusted from UI state.

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
