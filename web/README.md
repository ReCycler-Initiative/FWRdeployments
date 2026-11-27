# FRWDeployments Web

Next.js App Router, TypeScript, Tailwind CSS and a server-side PostgreSQL pool.

Start the full environment from the monorepo root:

```sh
docker compose up --build -d
```

The default web address is http://localhost:3000; this workspace uses
http://localhost:3001. `/api/health` checks database connectivity.
The dashboard supports multiple projects. `/projects/[id]` contains context
import, individual workshop planning, recording upload, analysis, solution
comparison, the live canvas, prompt exports and optional agent delivery.

The project workspace follows an OODA feedback loop, not a locked progress wizard:

- **Observe:** context imports, workshop planning, recordings and transcripts.
- **Orient:** explicit analysis, source-linked observations and the current-state map.
- **Decide:** draft a candidate choice, rationale and next action/success criterion;
  explicitly confirm the decision, atomically entering ACT without AI calls.
- **Act:** review outputs, track follow-up work and record impact in existing notes.

A next-step suggestion navigates only; it never starts analysis or approves work.
Output types belong in Act: one locked solution can produce several document types
or immutable versions. Output generation requires that solution's active ACT
decision; selecting a different output type does not change the decision.
Review a ready output and record learning to complete the cycle and append a new
baseline. Then return to Observe for new evidence and explicitly reanalyze.
Evidence edits and reanalysis are blocked while the decision is locked. Previous
decisions, baseline snapshots and delivery files remain intact. Context entry and
canvas/export details expand on demand. Tabs support
Left/Right arrows and Home/End. No MCP integration is required or added.

When an existing database has `ooda_iterations`, project creation, workshop
creation, recording upload and analysis ensure an open iteration transactionally
under the project lock. New iterations reference the latest existing baseline;
locked decisions, baseline snapshots and previous deliveries are not rewritten.
Older databases without the iteration tables retain their existing workflow.
Missing baseline data is reported explicitly rather than fabricated. Apply
[migration 012](../db/migrations/012_ooda_decisions.sql) on older databases and
restart both web and worker together; fresh Docker installations apply it
automatically after the initial schema.

**FI / EN** saves a one-year browser preference. A new project's separate content
language controls generated agendas, analysis and exports. Switching the UI never
rewrites existing source material or generated content.

- [types.ts](src/lib/types.ts): all five table types and runtime row validation.
- [db.ts](src/lib/db.ts): pool, transactions and consistent workspace snapshots.
- [translations.ts](src/lib/translations.ts): Finnish-to-English interface messages.
- [i18n.tsx](src/components/i18n.tsx): client locale context and language selector.
- [locale.ts](src/lib/locale.ts): server-side preference access.

Inputs are validated server-side. Worker requests, media access, tokens and
provider keys stay on the server. HTML artifact previews are static and sandboxed.

```sh
npm run lint
npm run typecheck
npm run build
```

The Docker web service builds then starts Next.js; restart it after source changes.
For local hot reload use `npm run dev` with valid `DATABASE_URL`, `WORKER_URL` and
`MEDIA_DIR`. Do not share a `.next` directory between build and running processes.

Run integration tests against an isolated mock stack:

```sh
docker compose exec -e TEST_WEB_URL=http://127.0.0.1:3000 frw_web npm run test:integration
```

See the [main README](../readme.md) and [setup/API reference](../COPILOT_SETUP_AND_PROMPTS.md).
This is a trusted local-team MVP, not a secure public production deployment.
