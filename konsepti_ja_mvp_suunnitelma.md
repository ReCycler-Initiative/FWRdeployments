# Concept and MVP plan: FRWDeployments.com

**Multimodal process and solution workspace — Service-as-a-Software**

## 1. Vision and business model

- **Core idea:** remove friction between discovering a business problem and
  delivering a useful outcome. Sell a productized result, not only a platform
  or consulting hours. Facilitated discussions become evaluated alternatives
  and an appropriate delivery.
- **Value proposition:** a half-day workshop can lead to evaluated candidates,
  a reviewable prototype, a plan or refined implementation prompts. A working
  production solution is not guaranteed by automatic generation.
- **Commercialization:**
  1. Productized expert service (MVP): forward-deployed engineers use the workspace
     and agents to deliver fixed-price sprints.
  2. Hybrid service: workshops plus recurring maintenance and development.
  3. Scalable SaaS: customer teams use the workspace independently.

**Product refinement:** an agent farm is optional. A process change, live artifact,
implementation plan or export to GitHub Copilot/Claude may be sufficient.
Multiple projects and multiple workshops per project are first-class concepts.

## 2. Four-stage architecture

### Stage 0 — Preparation

Create a project with goals, current systems and content language. Gather process
descriptions, documents and bounded GitHub source snapshots using an ephemeral
read-only token. Plan workshops with individual goals, times and meeting links.
Generate an agenda and clarifying questions for each workshop.

Participant invitations and automatic meeting participation are roadmap features.

### Stage 1 — Workshop observation and analysis

Upload MP4 recordings or VTT/TXT transcripts manually. Preserve each workshop's
agenda, transcript and results. Later workshops build on earlier findings.

The original research direction proposed speaker-baseline audio (`wav2vec2`) and
microexpression (`MediaPipe`) fusion, with an indicative unvalidated processing
estimate of EUR 0.30–0.75/hour. The MVP does not implement these local models or
validate that estimate: it offers an external signal-service adapter. Interpretations
must remain tentative, disclose limitations and never claim to prove emotions.

### Stage 2 — Problem definition and solution candidates

Synthesize context, transcripts and available signals into a timestamped
pain-point map with quotes and a Mermaid current-state process diagram. The vision
allows 2–4 alternatives; the current implementation produces three.

Candidates contain benefits, risks, indicative costs, architecture and a technical,
process or hybrid classification. Review them on a live canvas alongside prompt
drafts and static sandboxed prototype artifacts.

### Stage 3 — Human approval and appropriate delivery

Choose a candidate and delivery mode:

- `PROMPTS`: refined Copilot and Claude Markdown prompts (default).
- `PLAN`: a standalone implementation plan with decision gates.
- `AGENTS`: an explicit LangGraph architect → coder → data → QA chain.

Local mock refinement needs no provider key. Real integrations require explicit
configuration. Track the selected solution's progress manually even when coding
occurs in an external tool. A ready prompt is not a completed implementation.

## 3. Data and state — PostgreSQL 16 + pgvector

Project statuses:

1. `PREPARATION`: gathering context and planning workshops.
2. `WORKSHOP_UPLOADED`: uploaded evidence awaiting or undergoing analysis.
3. `CANDIDATES_READY`: analysis and alternatives available for review.
4. `BUILDING`: explicitly approved agent delivery is running.
5. `READY_FOR_REVIEW`: delivery artifacts are ready for human review.

Before approval, another workshop returns the project to `WORKSHOP_UPLOADED`.
Prompt/plan deliveries skip `BUILDING`. Independent solution implementation
states are `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `COMPLETED`.

Core tables:

- `projects`: UUID, title, description, target systems (JSONB), status, agenda,
  content language (`fi`/`en`), delivery mode and timestamps.
- `context_documents`: project FK, filename, content, VECTOR(1536) embedding,
  source type/URL/revision, storage path and creation time.
- `sessions`: project FK, workshop title/focus/time/link/agenda, recording path,
  VTT transcript, pain points (JSONB), Mermaid diagram and lifecycle timestamps.
- `solution_candidates`: project FK, title, summary, benefits/risks (JSONB),
  cost, architecture, selection, solution type and manual implementation tracking.
- `agent_tasks`: project/candidate FKs, role (`architect`, `coder`, `data`, `qa`),
  status (`pending`, `running`, `completed`, `failed`), output log, artifact path
  and update timestamp.

The authoritative schema is [db/init.sql](db/init.sql), with additive upgrades
in [db/migrations](db/migrations/).

## 4. Interface and monorepo

Next.js and Tailwind provide a multi-project dashboard at `/` and a project
workspace at `/projects/[id]`. Preparation, Workshop, Solutions and Delivery are
tabs within that page rather than separate `/prepare`, `/analysis`, `/build` routes.
Finnish and English are selectable; project content language is independent.

```text
docker-compose.yml
.env.example
db/                         PostgreSQL schema and migrations
worker/app/main.py          FastAPI routes and background jobs
worker/app/config.py        mock switch and provider configuration
worker/app/pipeline/        transcription, signals, synthesis
worker/app/agents/          LangGraph chain and reviewable artifacts
web/src/app/                pages and server API
web/src/components/         planner, canvas, Mermaid, tracking
web/src/lib/                database, types, sources, prompts, localization
```

## 5. Boundaries and future work

The MVP is a local, trusted-team tool without authentication or tenant isolation.
Generated artifacts are drafts, not automatically executed deployments. Real
audio/face analysis needs a separately configured measurement service.

Future work includes FRWDeployment Notetaker meeting participation, calendar
integration, GitHub App/OAuth, durable queues and versioned post-approval iterations.
The current UI marks Notetaker as future-only; it does not join meetings.

See [readme.md](readme.md) for implemented behavior, setup and privacy limits.
