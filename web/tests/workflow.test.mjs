import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

test("project deletion requires confirmation, blocks active work and removes only the target project", { timeout: 30000 }, async () => {
  const base = process.env.TEST_WEB_URL;
  assert.ok(base && process.env.DATABASE_URL && process.env.MEDIA_DIR && process.env.WORKER_URL);
  assert.equal((await (await fetch(`${process.env.WORKER_URL}/health`)).json()).mock_ai, true);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const projects = [];
  const remove = (id, body = { confirmed: true }, headers = {}) => fetch(`${base}/api/projects/${id}`, {
    method: "DELETE", headers: { "Content-Type": "application/json", Cookie: "frw_locale=en", ...headers },
    body: JSON.stringify(body),
  });
  try {
    for (const title of ["Deletion target confirmation test", "Deletion neighbor retained", "Empty project deletion"]) {
      const response = await fetch(`${base}/api/projects`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: "Isolated deletion fixture", target_systems: [] }),
      });
      assert.equal(response.status, 201);
      projects.push((await response.json()).id);
    }
    const [id, neighbor, empty] = projects;
    const folder = path.join(process.env.MEDIA_DIR, id);
    const neighborFile = path.join(process.env.MEDIA_DIR, neighbor, "retained.txt");
    await mkdir(path.join(folder, "artifacts"), { recursive: true });
    await mkdir(path.dirname(neighborFile), { recursive: true });
    await writeFile(path.join(folder, "artifacts", "delivery.md"), "Delete this project artifact");
    await writeFile(path.join(folder, "workshop.vtt"), "WEBVTT\n\nDelete this transcript");
    await writeFile(neighborFile, "Keep the other project untouched");
    await db.query("INSERT INTO context_documents(project_id,filename) VALUES($1,'context.txt')", [id]);
    const session = (await db.query("INSERT INTO sessions(project_id,title) VALUES($1,'Workshop') RETURNING id", [id])).rows[0].id;
    const candidate = (await db.query("INSERT INTO solution_candidates(project_id,title) VALUES($1,'Proposal') RETURNING id", [id])).rows[0].id;
    const task = (await db.query(
      "INSERT INTO agent_tasks(project_id,candidate_id,agent_role,status) VALUES($1,$2,'architect','completed') RETURNING id",
      [id, candidate],
    )).rows[0].id;
    assert.equal((await remove(id, {}, { Origin: "https://other.invalid" })).status, 403);
    const unconfirmed = await remove(id, {});
    assert.equal(unconfirmed.status, 400);
    assert.match((await unconfirmed.json()).error, /Project deletion must be confirmed/);
    assert.equal((await remove(id, { confirmed: false })).status, 400);
    assert.equal((await remove("not-a-uuid")).status, 400);
    assert.equal((await remove("00000000-0000-4000-8000-000000000001")).status, 404);
    await db.query("UPDATE sessions SET pain_points_json='{\"status\":\"running\"}' WHERE id=$1", [session]);
    assert.equal((await remove(id)).status, 409);
    await db.query("UPDATE sessions SET pain_points_json=NULL WHERE id=$1", [session]);
    await db.query("UPDATE agent_tasks SET status='running' WHERE id=$1", [task]);
    assert.equal((await remove(id)).status, 409);
    assert.equal((await fetch(`${base}/api/projects/${id}`)).status, 200);
    assert.match(await readFile(path.join(folder, "workshop.vtt"), "utf8"), /Delete this transcript/);
    await db.query("UPDATE agent_tasks SET status='completed' WHERE id=$1", [task]);
    await db.query("UPDATE projects SET status='BUILDING',delivery_mode='AGENTS' WHERE id=$1", [id]);
    assert.equal((await remove(id)).status, 409, "Protect the gap between the last agent finishing and build finalization");
    await db.query("UPDATE agent_tasks SET status='failed' WHERE id=$1", [task]);
    const deleted = await remove(id);
    assert.equal(deleted.status, 200, "Failed, inactive builds can be deleted");
    assert.equal((await deleted.json()).deleted, true);
    assert.equal((await fetch(`${base}/api/projects/${id}`)).status, 404);
    const remaining = await db.query(
      `SELECT (SELECT count(*) FROM projects WHERE id=$1)
       + (SELECT count(*) FROM context_documents WHERE project_id=$1)
       + (SELECT count(*) FROM sessions WHERE project_id=$1)
       + (SELECT count(*) FROM solution_candidates WHERE project_id=$1)
       + (SELECT count(*) FROM agent_tasks WHERE project_id=$1) AS count`, [id],
    );
    assert.equal(Number(remaining.rows[0].count), 0);
    await assert.rejects(readFile(path.join(folder, "artifacts", "delivery.md")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(folder, "workshop.vtt")), { code: "ENOENT" });
    assert.equal(await readFile(neighborFile, "utf8"), "Keep the other project untouched");
    assert.equal((await fetch(`${base}/api/projects/${neighbor}`)).status, 200);
    const html = await (await fetch(base)).text();
    assert.ok(!html.includes("Deletion target confirmation test"));
    assert.ok(html.includes("Deletion neighbor retained"));
    assert.equal((await remove(empty)).status, 200, "Projects without a media folder can be deleted");
  } finally {
    for (const id of projects) {
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
    }
    await db.end();
  }
});

test("workshop material saves to the chosen workshop without analysis and preserves other evidence", { timeout: 30000 }, async () => {
  const base = process.env.TEST_WEB_URL;
  assert.ok(base && process.env.DATABASE_URL && process.env.MEDIA_DIR && process.env.WORKER_URL);
  assert.equal((await (await fetch(`${process.env.WORKER_URL}/health`)).json()).mock_ai, true);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  let id;
  const json = (body) => ({
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const material = (filename, content, sessionId) => {
    const form = new FormData();
    form.set("file", new File([content], filename));
    form.set("title", "New workshop from evidence");
    form.set("analyze", "false");
    if (sessionId) form.set("session_id", sessionId);
    return { method: "POST", body: form };
  };
  try {
    const created = await fetch(`${base}/api/projects`, json({
      title: "Workshop material routing test", description: "Save without calling AI", target_systems: [],
    }));
    assert.equal(created.status, 201);
    id = (await created.json()).id;
    const route = `${base}/api/projects/${id}`;
    const first = await (await fetch(`${route}/workshops`, json({ title: "Workshop 1", notes: "Keep first notes" }))).json();
    const second = await (await fetch(`${route}/workshops`, json({ title: "Workshop 2", notes: "Keep second notes" }))).json();
    const saved = await fetch(`${route}/sessions`, material("first.txt", "First workshop source", first.id));
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).session_id, first.id);
    assert.equal((await fetch(`${route}/workshops/${second.id}/transcript`, material("second.txt", "Second workshop source"))).status, 200);
    await db.query("UPDATE projects SET status='READY_FOR_REVIEW' WHERE id=$1", [id]);
    const video = Buffer.alloc(12);
    video.write("ftyp", 4);
    assert.equal((await fetch(`${route}/sessions`, material("recording.mp4", video, first.id))).status, 201,
      "A held workshop can receive its video without losing its saved transcript");
    const snapshot = await (await fetch(route)).json();
    const workshop = snapshot.sessions.find((session) => session.id === first.id);
    assert.equal(snapshot.sessions.length, 2);
    assert.equal(workshop.title, "Workshop 1");
    assert.equal(workshop.notes, "Keep first notes");
    assert.equal(workshop.transcript_vtt, "First workshop source");
    assert.equal(workshop.transcript_filename, "first.txt");
    assert.ok(workshop.video_path.endsWith(".mp4"));
    assert.equal(workshop.processed_at, null);
    assert.equal(snapshot.candidates.length, 0);
    const savedHtml = await (await fetch(`${base}/projects/${id}`, { headers: { Cookie: "frw_locale=en" } })).text();
    assert.match(savedHtml, /Workshop material added/);
    assert.doesNotMatch(savedHtml, />Analyzing workshop</);
    const neighbor = snapshot.sessions.find((session) => session.id === second.id);
    assert.equal(neighbor.transcript_vtt, "Second workshop source");
    assert.equal(neighbor.notes, "Keep second notes");
    assert.equal((await fetch(`${route}/sessions`, material("other.mp4", video, first.id))).status, 409);
    assert.equal((await fetch(`${route}/sessions`, material("third.txt", "Third workshop source"))).status, 201);
    const after = await (await fetch(route)).json();
    assert.equal(after.sessions.length, 3);
    assert.equal(after.candidates.length, 0);
    assert.ok(after.sessions.every((session) => session.processed_at === null));
  } finally {
    if (id) {
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
    }
    await db.end();
  }
});

test("non-code outputs create versioned source-referenced documents without starting coding agents", { timeout: 30000 }, async () => {
  const base = process.env.TEST_WEB_URL;
  assert.ok(base && process.env.DATABASE_URL && process.env.MEDIA_DIR && process.env.WORKER_URL);
  assert.equal((await (await fetch(`${process.env.WORKER_URL}/health`)).json()).mock_ai, true);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  let id;
  const post = (body) => ({
    method: "POST", headers: { "Content-Type": "application/json", Cookie: "frw_locale=en" }, body: JSON.stringify(body),
  });
  try {
    const created = await fetch(`${base}/api/projects`, post({
      title: "Investigate ownership", description: "Understand responsibility gaps before choosing any implementation.",
      target_systems: ["Existing shared queue"], language: "en",
    }));
    assert.equal(created.status, 201);
    id = (await created.json()).id;
    const route = `${base}/api/projects/${id}`;
    const source = await (await fetch(`${route}/context`, post({
      filename: "Current situation", content_text: "Vastuun siirto kestää tunnin.",
    }))).json();
    const workshop = await (await fetch(`${route}/workshops`, post({ title: "Interviews" }))).json();
    const transcript = new FormData();
    transcript.set("file", new File(["No one owns the handover."], "interviews.txt"));
    assert.equal((await fetch(`${route}/workshops/${workshop.id}/transcript`, { method: "POST", body: transcript })).status, 200);
    const candidate = (await db.query(
      `INSERT INTO solution_candidates(project_id,title,summary,solution_type,generation_mode,benefits,risks)
       VALUES($1,'Clarify ownership','Investigate the gap before buying software.','PROCESS','mock',
       '["Shared understanding"]','["Missing baseline"]') RETURNING id`, [id],
    )).rows[0];
    await db.query("UPDATE projects SET status='CANDIDATES_READY' WHERE id=$1", [id]);
    let deliveryId;
    const earlier = [];
    for (const [mode, filename, expected] of [
      ["REPORT", "report.md", /completed research finding/],
      ["RECOMMENDATION", "recommendation.md", /decision criteria/],
      ["PROCESS", "operating-model.md", /handovers and exceptions/],
      ["GUIDE", "guide.md", /learning objective/],
      ["EXPERIMENT", "experiment-plan.md", /success threshold, stop criteria/],
    ]) {
      if (mode === "RECOMMENDATION") {
        assert.equal((await fetch(`${route}/approve`, post({ candidate_id: candidate.id, delivery_mode: mode }))).status, 409);
      }
      const approval = await fetch(`${route}/approve`, post({
        candidate_id: candidate.id, delivery_mode: mode, refinement: "Confirm the accountable person.",
        ...(deliveryId ? { expected_delivery_id: deliveryId } : {}),
      }));
      assert.equal(approval.status, 200, await approval.text());
      const workspace = await (await fetch(route)).json();
      assert.equal(workspace.project.status, "READY_FOR_REVIEW");
      assert.equal(workspace.project.delivery_mode, mode);
      assert.equal(workspace.project.delivery_generation_mode, "mock");
      assert.equal(workspace.tasks.length, 0);
      assert.equal(workspace.candidates[0].implementation_status, "NOT_STARTED");
      assert.notEqual(workspace.project.active_delivery_id, deliveryId);
      deliveryId = workspace.project.active_delivery_id;
      const artifact = `delivery/${deliveryId}/${filename}`;
      const content = (await (await fetch(`${route}/artifacts?path=${encodeURIComponent(artifact)}`)).json()).content;
      assert.match(content, expected);
      assert.match(content, /DEMO DRAFT/);
      assert.match(content, /No external research or independent source verification/);
      assert.match(content, /Vastuun siirto kestää tunnin/);
      assert.match(content, /No one owns the handover/);
      assert.match(content, /Confirm the accountable person/);
      const metadata = JSON.parse(await readFile(path.join(process.env.MEDIA_DIR, id, "artifacts", "delivery", deliveryId, "output-provenance.json"), "utf8"));
      assert.equal(metadata.external_research, false);
      assert.equal(metadata.output_type, mode);
      const savedWorkshop = workspace.sessions.find((session) => session.id === workshop.id);
      assert.ok(metadata.source_ids.includes(`transcript:${savedWorkshop.transcripts[0].id}`));
      earlier.push({ artifact, content });
    }
    const plan = await fetch(`${route}/approve`, post({
      candidate_id: candidate.id, delivery_mode: "PLAN", expected_delivery_id: deliveryId,
    }));
    assert.equal(plan.status, 200);
    const latest = await (await fetch(route)).json();
    assert.equal(latest.project.delivery_generation_mode, null, "A local plan must not inherit AI/demo provenance from an earlier output");
    const sourceId = source.id ?? (await db.query("SELECT id FROM context_documents WHERE project_id=$1", [id])).rows[0].id;
    await db.query("UPDATE context_documents SET content_text=repeat('x',200001) WHERE id=$1", [sourceId]);
    const failed = await fetch(`${route}/approve`, post({
      candidate_id: candidate.id, delivery_mode: "REPORT", expected_delivery_id: latest.project.active_delivery_id,
    }));
    assert.equal(failed.status, 502);
    const afterFailure = await (await fetch(route)).json();
    assert.equal(afterFailure.project.active_delivery_id, latest.project.active_delivery_id);
    assert.equal(afterFailure.project.delivery_mode, "PLAN");
    assert.equal(afterFailure.artifacts.length, latest.artifacts.length);
    assert.equal(Number((await db.query("SELECT count(*) FROM agent_tasks WHERE project_id=$1", [id])).rows[0].count), 0);
    for (const previous of earlier) {
      assert.equal((await (await fetch(`${route}/artifacts?path=${encodeURIComponent(previous.artifact)}`)).json()).content, previous.content);
    }
  } finally {
    if (id) {
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
    }
    await db.end();
  }
});

test("language preference, project content language and English exports remain independent", { timeout: 60000 }, async () => {
  const base = process.env.TEST_WEB_URL;
  assert.ok(base && process.env.DATABASE_URL && process.env.MEDIA_DIR && process.env.WORKER_URL);
  assert.equal((await (await fetch(`${process.env.WORKER_URL}/health`)).json()).mock_ai, true);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const projects = [];
  const post = async (url, body, cookie = "frw_locale=en") => {
    const response = await fetch(`${base}${url}`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(response.ok, `${url}: ${JSON.stringify(data)}`);
    return { response, data };
  };
  try {
    const preference = await post("/api/locale", { locale: "en" });
    assert.match(preference.response.headers.get("set-cookie"), /frw_locale=en/);
    assert.match(preference.response.headers.get("set-cookie"), /HttpOnly/i);
    const html = await (await fetch(base, { headers: { Cookie: "frw_locale=en" } })).text();
    assert.match(html, /lang="en"/);
    assert.match(html, /Create a new FRWDeployments project/);
    const finnish = await (await fetch(base, { headers: { Cookie: "frw_locale=fi" } })).text();
    assert.match(finnish, /lang="fi"/);
    assert.match(finnish, /Luo uusi FRWDeployments-projekti/);
    const invalid = await fetch(`${base}/api/locale`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"locale":"de"}',
    });
    assert.equal(invalid.status, 400);
    const foreign = await fetch(`${base}/api/locale`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.invalid" },
      body: '{"locale":"en"}',
    });
    assert.equal(foreign.status, 403);
    const missing = await fetch(`${base}/api/projects/00000000-0000-4000-8000-000000000001`, {
      headers: { Cookie: "frw_locale=en" },
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "Project not found.");

    const created = await post("/api/projects", {
      title: "Language workflow test", description: "Preserve the source text", target_systems: ["CRM"],
    });
    const id = created.data.id;
    projects.push(id);
    assert.equal(created.data.language, "en", "Creation defaults to the current UI language");
    const explicit = await post("/api/projects", {
      title: "Explicit language", description: "Suomenkielinen projekti", target_systems: [], language: "fi",
    });
    projects.push(explicit.data.id);
    assert.equal(explicit.data.language, "fi", "An explicit content language overrides the UI");
    await post(`/api/projects/${id}/context`, { filename: "Source", content_text: "Alkuperäinen lähde säilyy." });
    const workshop = await post(`/api/projects/${id}/workshops`, { title: "Pilot review", notes: "Verify ownership" });
    const agenda = await post(`/api/projects/${id}/agenda`, { session_id: workshop.data.id }, "frw_locale=fi");
    assert.match(agenda.data.agenda, /# Workshop agenda: Pilot review/);
    assert.match(agenda.data.agenda, /Verify ownership/);
    const form = new FormData();
    form.set("file", new File(["Original English workshop transcript."], "workshop.txt", { type: "text/plain" }));
    form.set("session_id", workshop.data.id);
    const upload = await fetch(`${base}/api/projects/${id}/sessions`, { method: "POST", body: form });
    assert.equal(upload.status, 202);
    let workspace;
    for (let attempt = 0; attempt < 40; attempt++) {
      workspace = await (await fetch(`${base}/api/projects/${id}`)).json();
      if (workspace.project.status === "CANDIDATES_READY") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(workspace.project.status, "CANDIDATES_READY");
    assert.match(workspace.candidates[0].title, /simulated option/);
    assert.equal(workspace.ai.status, "available");
    assert.equal(workspace.ai.mode, "mock");
    assert.equal(workspace.sessions[0].agenda_mode, "mock");
    assert.equal(workspace.sessions[0].analysis_mode, "mock");
    assert.ok(workspace.candidates.every((candidate) => candidate.generation_mode === "mock" && !("estimated_cost" in candidate)));
    const workspaceHtml = await (await fetch(`${base}/projects/${id}`, { headers: { Cookie: "frw_locale=en" } })).text();
    assert.match(workspaceHtml, /Choose an outcome/);
    assert.match(workspaceHtml, /Demo mode/);
    assert.match(workspaceHtml, /not evidence-based AI output/);
    assert.doesNotMatch(workspaceHtml, /What outcome is enough for the customer|candidate-price/);
    assert.equal(workspace.documents[0].content_text, "Alkuperäinen lähde säilyy.");
    assert.match(workspace.sessions[0].transcript_vtt, /Original English workshop transcript/);
    let portablePrompt;
    for (const target of ["prompt", "copilot", "claude", "plan"]) {
      const draft = await post(`/api/projects/${id}/prompts`, {
        candidate_id: workspace.candidates[0].id, target, refinement: "Keep the pilot small.",
      }, "frw_locale=fi");
      assert.match(draft.data.prompt, target === "plan" ? /# Implementation plan:/ : /Forward Deployment implementation prompt/);
      assert.match(draft.data.prompt, /Keep the pilot small/);
      assert.match(draft.data.prompt, /Candidate: SIMULATED EXAMPLE/);
      assert.match(draft.data.prompt, /Pilot review: SIMULATED EXAMPLE/);
      assert.doesNotMatch(draft.data.prompt, /Indicative budget|\bEUR\b|estimated_cost/);
      if (target !== "plan") {
        if (portablePrompt) assert.equal(draft.data.prompt, portablePrompt, "Copilot/Claude aliases must return the same portable prompt");
        portablePrompt = draft.data.prompt;
      }
      if (target !== "plan") assert.match(draft.data.prompt, /Alkuperäinen lähde säilyy/);
    }
    await post(`/api/projects/${id}/approve`, { candidate_id: workspace.candidates[0].id, delivery_mode: "PROMPTS" });
    workspace = await (await fetch(`${base}/api/projects/${id}`)).json();
    assert.equal(workspace.project.language, "en");
    assert.equal(workspace.tasks.length, 0);
    for (const artifact of workspace.artifacts) {
      const preview = await (await fetch(`${base}/api/projects/${id}/artifacts?path=${encodeURIComponent(artifact.path)}`)).json();
      assert.match(preview.content, /The customer has selected this candidate/);
      assert.doesNotMatch(preview.content, /NOT APPROVED/);
    }
    const firstDelivery = workspace.project.active_delivery_id;
    const originalFiles = workspace.artifacts.map((artifact) => artifact.path);
    const alternative = workspace.candidates.find((candidate) => !candidate.is_selected);
    await post(`/api/projects/${id}/approve`, {
      candidate_id: alternative.id, delivery_mode: "PLAN", expected_delivery_id: firstDelivery,
    });
    const replaced = await (await fetch(`${base}/api/projects/${id}`)).json();
    assert.notEqual(replaced.project.active_delivery_id, firstDelivery);
    assert.equal(replaced.candidates.find((candidate) => candidate.is_selected).id, alternative.id);
    assert.equal(replaced.candidates.filter((candidate) => candidate.is_selected).length, 1);
    assert.ok(originalFiles.every((file) => replaced.artifacts.some((artifact) => artifact.path === file)));
    assert.equal(replaced.artifacts.length, originalFiles.length + 1);
    const replacedHtml = await (await fetch(`${base}/projects/${id}`, { headers: { Cookie: "frw_locale=en" } })).text();
    assert.match(replacedHtml, /Compare alternatives or change selection/);
    assert.match(replacedHtml, /Previous deliveries/);
  } finally {
    for (const id of projects) {
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
    }
    await db.end();
  }
});

test("mock workspace: preparation, upload, analysis, selection and four-agent delivery", { timeout: 90000 }, async () => {
  const base = process.env.TEST_WEB_URL;
  assert.ok(base, "Set TEST_WEB_URL to an isolated running web service");
  assert.ok(process.env.DATABASE_URL);
  assert.ok(process.env.MEDIA_DIR);
  assert.ok(process.env.WORKER_URL);
  const workerHealth = await fetch(`${process.env.WORKER_URL}/health`);
  assert.equal((await workerHealth.json()).mock_ai, true, "This test must never call real AI providers");
  const capabilities = await (await fetch(`${process.env.WORKER_URL}/capabilities`)).json();
  assert.deepEqual(Object.keys(capabilities).sort(), ["mode", "openai_configured", "video_signals_configured"]);
  assert.equal(capabilities.mode, "mock");
  assert.equal(typeof capabilities.openai_configured, "boolean");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const projects = [];
  async function call(url, options = {}) {
    const response = await fetch(`${base}${url}`, options);
    return { status: response.status, data: await response.json() };
  }
  const post = (body) => ({
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  test("prompt-package and plan deliveries finish without agent tasks or AI keys", { timeout: 30000 }, async () => {
    const base = process.env.TEST_WEB_URL;
    assert.ok(base);
    const db = new Pool({ connectionString: process.env.DATABASE_URL });
    const projects = [];
    async function post(url, body) {
      const response = await fetch(`${base}${url}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }
    try {
      for (const delivery_mode of ["PROMPTS", "PLAN"]) {
        const created = await post("/api/projects", {
          title: `Toimitustesti ${delivery_mode}`, description: "Asiakkaalle riittää suunnitelma tai promptit.", target_systems: [],
        });
        assert.equal(created.status, 201);
        const id = created.data.id;
        projects.push(id);
        const candidate = await db.query(
          `INSERT INTO solution_candidates (project_id,title,summary,benefits,risks,estimated_cost,architecture_spec)
           VALUES ($1,'Prosessin yksinkertaistus','Ei koodia oletuksena','["Vähemmän käsityötä"]',
           '["Vastuut varmistettava"]',1000,'Prosessikuvaus ja pilotin suunnittelu') RETURNING id`, [id],
        );
        const candidate_id = candidate.rows[0].id;
        await db.query("UPDATE projects SET status='CANDIDATES_READY' WHERE id=$1", [id]);
        const refinement = "Pilotti ilman integraatioita; mittaa käsittelyaika.";
        const draft = await post(`/api/projects/${id}/prompts`, { candidate_id, target: "plan", refinement });
        assert.equal(draft.status, 200);
        assert.equal(draft.data.mock, true);
        assert.match(draft.data.prompt, /Pilotti ilman integraatioita/);
        assert.match(draft.data.prompt, /Kandidaatti: Alkuperää ei tallennettu/);
        assert.doesNotMatch(draft.data.prompt, /1000|EUR|kustannusarvio|Alustava budjetti/);
        if (delivery_mode === "PLAN") {
          await db.query("UPDATE solution_candidates SET generation_mode='ai' WHERE id=$1", [candidate_id]);
          const recordedAi = await post(`/api/projects/${id}/prompts`, { candidate_id, target: "plan" });
          assert.match(recordedAi.data.prompt, /Kandidaatti: AI-generoitu luonnos/,
            "Recorded output provenance must not be relabeled by current mock configuration");
        }
        const approved = await post(`/api/projects/${id}/approve`, { candidate_id, delivery_mode, refinement });
        assert.equal(approved.status, 200);
        const workspace = await (await fetch(`${base}/api/projects/${id}`)).json();
        assert.equal(workspace.project.status, "READY_FOR_REVIEW");
        assert.equal(workspace.project.delivery_mode, delivery_mode);
        assert.equal(workspace.tasks.length, 0, "Non-agent deliveries must never create agent tasks");
        assert.equal(workspace.candidates[0].implementation_status, "NOT_STARTED",
          "Exported prompts are not a completed implementation");
        assert.equal(workspace.artifacts.length, 1, "A shared prompt must not be duplicated per tool");
        const preview = await (await fetch(`${base}/api/projects/${id}/artifacts?path=${encodeURIComponent(workspace.artifacts[0].path)}`)).json();
        assert.match(preview.content, /Pilotti ilman integraatioita/);
        assert.doesNotMatch(preview.content, /1000|EUR|kustannusarvio|Alustava budjetti/);
        if (delivery_mode === "PROMPTS") assert.doesNotMatch(preview.content, /EI HYVÄKSYTTY/);
        assert.equal((await post(`/api/projects/${id}/approve`, { candidate_id, delivery_mode, refinement })).status, 200);
        const repeated = await (await fetch(`${base}/api/projects/${id}`)).json();
        assert.equal(repeated.artifacts.length, workspace.artifacts.length, "Repeated approval must not duplicate exports");
        const progress = await fetch(`${base}/api/projects/${id}/implementation`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_id, implementation_status: "IN_PROGRESS",
            implementation_notes: "Toteutus GH Copilotissa, ensimmäinen PR katselmoitavana.",
            implementation_url: "https://github.com/example/project/pull/42",
          }),
        });
        assert.equal(progress.status, 200);
        assert.equal((await progress.json()).implementation_status, "IN_PROGRESS");
        const tracked = await (await fetch(`${base}/api/projects/${id}`)).json();
        assert.equal(tracked.project.status, "READY_FOR_REVIEW", "Delivery readiness is independent of implementation progress");
        assert.equal(tracked.tasks.length, 0);
        assert.match(tracked.candidates[0].implementation_notes, /GH Copilotissa/);
        assert.equal(tracked.candidates[0].implementation_url, "https://github.com/example/project/pull/42");
        if (delivery_mode === "PROMPTS") {
          const agents = await post(`/api/projects/${id}/build`, {
            candidate_id, expected_delivery_id: tracked.project.active_delivery_id,
          });
          assert.equal(agents.status, 202);
          const built = await waitFor(id, (value) => value.project.status === "READY_FOR_REVIEW");
          assert.equal(built.project.delivery_mode, "AGENTS", "The same candidate can move from prompt export to agents");
          assert.equal(built.tasks.length, 4, "Switching a prompt delivery to agents must actually start the chain");
          assert.match(built.candidates[0].implementation_notes, /GH Copilotissa/);
        }
      }
    } finally {
      for (const id of projects) {
        await db.query("DELETE FROM projects WHERE id=$1", [id]);
        await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
      }
      await db.end();
    }
  });
  async function waitFor(id, predicate) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const response = await call(`/api/projects/${id}`);
      assert.equal(response.status, 200);
      if (predicate(response.data)) return response.data;
      const errors = response.data.sessions.filter((session) => session.pain_points_json?.error);
      const failed = response.data.tasks.filter((task) => task.status === "failed");
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.equal(failed.length, 0, JSON.stringify(failed));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.fail("Workflow did not finish within 40 seconds");
  }
  try {
    assert.equal((await call("/api/projects", post({ title: "", description: "", target_systems: [] }))).status, 400);
    assert.equal((await call("/api/projects/not-a-uuid")).status, 400);
    assert.equal((await call("/api/projects", {
      ...post({ title: "Blocked", description: "Blocked", target_systems: [] }),
      headers: { "Content-Type": "application/json", Origin: "http://untrusted.invalid" },
    })).status, 403);
    const created = await call("/api/projects", post({
      title: "Integraatiotesti: asiakaspalautteet",
      description: "Lyhennetään palautteiden käsittelyaikaa ja poistetaan Excelin käsityö.",
      target_systems: ["Teams", "Excel", "CRM"],
    }));
    assert.equal(created.status, 201);
    const id = created.data.id;
    projects.push(id);
    assert.equal(created.data.status, "PREPARATION");
    assert.deepEqual(created.data.target_systems, ["Teams", "Excel", "CRM"]);
    const route = `/api/projects/${id}`;
    assert.equal((await call(`${route}/context`, post({
      filename: "Nykyprosessi",
      content_text: "Palautteet siirretään sähköpostista Exceliin. Vastuu on epäselvä, eikä asiakas näe käsittelyn tilaa.",
    }))).status, 201);
    const agenda = await call(`${route}/agenda`, post({}));
    assert.equal(agenda.status, 200);
    assert.ok(agenda.data.agenda.length > 200);
    let snapshot = (await call(route)).data;
    assert.equal(snapshot.documents.length, 1);
    assert.equal(snapshot.project.workshop_agenda, agenda.data.agenda);
    assert.equal(snapshot.project.agenda_mode, "mock");
    const contextFile = new FormData();
    contextFile.set("file", new File(["# Prosessi\nPalautteet kopioidaan Exceliin."], "process.md"));
    const imported = await call(`${route}/context/file`, { method: "POST", body: contextFile });
    assert.equal(imported.status, 201);
    assert.equal(imported.data.source_type, "file");
    assert.match(imported.data.content_text, /Excel/);
    const disallowedGithub = await call(`${route}/context/github`, post({
      url: "http://127.0.0.1/private", token: "not-a-real-token",
    }));
    assert.equal(disallowedGithub.status, 400);
    const invalid = new FormData();
    invalid.set("file", new File(["bad"], "../bad.exe"));
    assert.equal((await call(`${route}/sessions`, { method: "POST", body: invalid })).status, 400);
    assert.equal((await call(route)).data.sessions.length, 0);
    const forgedVideo = new FormData();
    forgedVideo.set("file", new File(["not a video"], "fake.mp4"));
    assert.equal((await call(`${route}/sessions`, { method: "POST", body: forgedVideo })).status, 400);
    const plannedFirst = await call(`${route}/workshops`, post({
      title: "Työpaja 1: nykytila", notes: "Kartoitetaan vastuut ja käsityövaiheet.",
      scheduled_at: "2026-12-01T08:00:00.000Z", meeting_url: "https://teams.microsoft.com/example",
    }));
    assert.equal(plannedFirst.status, 201);
    assert.equal(plannedFirst.data.video_path, null);
    const firstAgenda = await call(`${route}/agenda`, post({ session_id: plannedFirst.data.id }));
    assert.equal(firstAgenda.status, 200);
    assert.match(firstAgenda.data.agenda, /Työpaja 1: nykytila/);
    assert.match(firstAgenda.data.agenda, /Kartoitetaan vastuut/);
    const upload = new FormData();
    upload.set("session_id", plannedFirst.data.id);
    upload.set("file", new File([
      "WEBVTT\n\n00:00:12.000 --> 00:00:20.000\nPalautteet kopioidaan käsin Exceliin, eikä kukaan tiedä kenen vastuulla vastaus on.\n\n00:01:00.000 --> 00:01:08.000\nCRM:ssä on samat tiedot, mutta integraatio puuttuu.\n",
    ], "../../workshop.vtt", { type: "text/vtt" }));
    const uploaded = await call(`${route}/sessions`, { method: "POST", body: upload });
    assert.equal(uploaded.status, 202);
    snapshot = await waitFor(id, (value) => value.project.status === "CANDIDATES_READY");
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0].id, plannedFirst.data.id);
    assert.equal(snapshot.sessions[0].agenda, firstAgenda.data.agenda);
    assert.ok(snapshot.sessions[0].transcript_path.startsWith(path.join(process.env.MEDIA_DIR, id)));
    assert.ok(Array.isArray(snapshot.sessions[0].pain_points_json));
    assert.equal(snapshot.sessions[0].agenda_mode, "mock");
    assert.equal(snapshot.sessions[0].analysis_mode, "mock");
    assert.ok(snapshot.sessions[0].pain_points_json.length > 0);
    for (const point of snapshot.sessions[0].pain_points_json) {
      assert.ok(point.timestamp_seconds >= 0);
      assert.ok(point.intensity >= 0 && point.intensity <= 1);
      assert.equal(typeof point.quote, "string");
    }
    assert.match(snapshot.sessions[0].current_state_mermaid, /flowchart|graph/);
    assert.equal(snapshot.candidates.length, 3);
    for (const candidate of snapshot.candidates) {
      assert.ok(candidate.benefits.length);
      assert.ok(candidate.risks.length);
      assert.equal(candidate.generation_mode, "mock");
      assert.ok(!("estimated_cost" in candidate));
      assert.ok(candidate.architecture_spec);
    }
    const storedCosts = await db.query("SELECT estimated_cost FROM solution_candidates WHERE project_id=$1", [id]);
    assert.ok(storedCosts.rows.every((row) => row.estimated_cost === null), "New candidates must not store generated prices");
    const workspaceHtml = await (await fetch(`${base}/projects/${id}`)).text();
    assert.match(workspaceHtml, /Valitse lopputulos/);
    assert.match(workspaceHtml, /Esimerkkisisältö/);
    assert.doesNotMatch(workspaceHtml, /Mikä lopputulos riittää asiakkaalle|candidate-price/);
    const firstSessionId = snapshot.sessions[0].id;
    const plannedSecond = await call(`${route}/workshops`, post({
      title: "Työpaja 2: validointi", notes: "Varmennetaan pilotin hyväksymiskriteerit.",
    }));
    assert.equal(plannedSecond.status, 201);
    const secondAgenda = await call(`${route}/agenda`, post({ session_id: plannedSecond.data.id }));
    assert.equal(secondAgenda.status, 200);
    assert.match(secondAgenda.data.agenda, /Työpaja 2: validointi/);
    assert.match(secondAgenda.data.agenda, /Varmennetaan pilotin/);
    assert.notEqual(firstAgenda.data.agenda, secondAgenda.data.agenda);
    const secondUpload = new FormData();
    secondUpload.set("session_id", plannedSecond.data.id);
    secondUpload.set("title", "Työpaja 2: validointi");
    secondUpload.set("file", new File(["Toisessa työpajassa varmistettiin asiakkaan tavoite ja vastuuhenkilöt."], "workshop2.txt"));
    assert.equal((await call(`${route}/sessions`, { method: "POST", body: secondUpload })).status, 202);
    snapshot = await waitFor(id, (value) => value.project.status === "CANDIDATES_READY" && value.sessions.length === 2);
    assert.ok(snapshot.sessions.some((session) => session.id === firstSessionId && session.processed_at));
    assert.equal(snapshot.sessions[0].title, "Työpaja 2: validointi");
    assert.equal(snapshot.sessions.find((session) => session.id === firstSessionId).agenda, firstAgenda.data.agenda);
    assert.equal(snapshot.sessions[0].agenda, secondAgenda.data.agenda);
    for (const target of ["copilot", "claude"]) {
      const prompt = await call(`${route}/prompts?target=${target}&candidate_id=${snapshot.candidates[0].id}`);
      assert.equal(prompt.status, 200);
      assert.match(prompt.data.prompt, /Työpajoja: 2/);
      assert.match(prompt.data.prompt, /EI HYVÄKSYTTY/);
      assert.match(prompt.data.prompt, /Prosessi/);
      assert.doesNotMatch(prompt.data.prompt, /not-a-real-token/);
      assert.match(prompt.data.prompt, /Kandidaatti: SIMULOITU ESIMERKKI/);
      assert.doesNotMatch(prompt.data.prompt, /Alustava kustannusarvio|Alustava budjetti|\bEUR\b/);
    }
    const other = await call("/api/projects", post({ title: "Toinen projekti", description: "Viiteavaintesti", target_systems: [] }));
    projects.push(other.data.id);
    assert.ok([404, 409].includes((await call(`/api/projects/${other.data.id}/build`, post({
      candidate_id: snapshot.candidates[0].id,
    }))).status));
    const chosen = snapshot.candidates[0].id;
    assert.equal((await call(`${route}/build`, post({ candidate_id: chosen }))).status, 202);
    const started = (await call(route)).data;
    assert.equal(started.project.status, "BUILDING");
    assert.equal(started.candidates.filter((candidate) => candidate.is_selected).length, 1);
    assert.equal(started.tasks.length, 4);
    assert.ok(started.tasks.some((task) => task.status === "pending" || task.status === "running"));
    assert.equal((await call(`${route}/workshops/${firstSessionId}/transcript`, { method: "DELETE" })).status, 409);
    assert.equal((await call(`${route}/approve`, post({
      candidate_id: snapshot.candidates[1].id, delivery_mode: "PLAN",
      expected_delivery_id: started.project.active_delivery_id,
    }))).status, 409, "Selection changes must be blocked while agents are building");
    assert.equal((await call(`${route}/build`, post({
      candidate_id: snapshot.candidates[1].id, expected_delivery_id: started.project.active_delivery_id,
    }))).status, 409);
    const duplicate = await call(`${route}/build`, post({ candidate_id: chosen }));
    assert.ok([202, 409].includes(duplicate.status));
    snapshot = await waitFor(id, (value) => value.project.status === "READY_FOR_REVIEW");
    assert.equal(snapshot.tasks.length, 4, "Duplicate requests must not create duplicate tasks");
    assert.deepEqual(snapshot.tasks.map((task) => task.agent_role).sort(), ["architect", "coder", "data", "qa"]);
    assert.ok(snapshot.tasks.every((task) => task.status === "completed" && task.output_log && task.artifacts_path));
    assert.ok(snapshot.tasks.every((task) => task.generation_mode === "mock"));
    assert.equal(snapshot.project.delivery_mode, "AGENTS");
    assert.equal(snapshot.candidates.find((candidate) => candidate.is_selected).implementation_status, "IN_REVIEW");
    assert.ok(snapshot.artifacts.length >= 4);
    const file = snapshot.artifacts.find((artifact) => /\.py$|\.ts$|\.md$/.test(artifact.path));
    assert.ok(file);
    const preview = await call(`${route}/artifacts?path=${encodeURIComponent(file.path)}`);
    assert.equal(preview.status, 200);
    assert.ok(preview.data.content.length);
    const download = await fetch(`${base}${route}/artifacts?path=${encodeURIComponent(file.path)}&download=1`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /^attachment/);
    assert.equal(await download.text(), preview.data.content);
    assert.equal((await call(`${route}/artifacts?path=${encodeURIComponent("../outside.txt")}`)).status, 400);
    assert.equal((await call(`${route}/context`, post({ filename: "Late", content_text: "Not allowed" }))).status, 409);
    const firstDelivery = snapshot.project.active_delivery_id;
    const alternative = snapshot.candidates.find((candidate) => candidate.id !== chosen).id;
    assert.equal((await call(`${route}/build`, post({ candidate_id: alternative }))).status, 409,
      "Replacing an approval requires the expected current delivery");
    assert.equal((await call(`${route}/build`, post({
      candidate_id: alternative, expected_delivery_id: firstDelivery,
    }))).status, 202);
    snapshot = await waitFor(id, (value) => value.project.status === "READY_FOR_REVIEW");
    const secondDelivery = snapshot.project.active_delivery_id;
    assert.notEqual(secondDelivery, firstDelivery);
    assert.equal(snapshot.tasks.length, 4, "Only the active run belongs in the Kanban");
    assert.ok(snapshot.tasks.every((task) => task.candidate_id === alternative && task.delivery_id === secondDelivery));
    assert.equal(Number((await db.query("SELECT count(*) FROM agent_tasks WHERE project_id=$1", [id])).rows[0].count), 8,
      "Previous agent logs must remain stored");
    assert.equal((await call(`${route}/artifacts?path=${encodeURIComponent(file.path)}`)).data.content, preview.data.content,
      "Starting another run must never overwrite earlier artifacts");
    assert.equal((await call(`${route}/approve`, post({ candidate_id: chosen, delivery_mode: "PLAN" }))).status, 409);
    assert.equal((await call(`${route}/approve`, post({
      candidate_id: chosen, delivery_mode: "PLAN", expected_delivery_id: firstDelivery,
    }))).status, 409, "A stale browser must not replace the current decision");
    assert.equal((await call(`${route}/approve`, post({
      candidate_id: alternative, delivery_mode: "PLAN", expected_delivery_id: secondDelivery,
    }))).status, 200, "The outcome can change without changing the candidate");
    snapshot = (await call(route)).data;
    assert.equal(snapshot.tasks.length, 0, "Previous agents must not appear as the current plan's agents");
    assert.equal(snapshot.candidates.find((candidate) => candidate.id === chosen).implementation_status, "IN_REVIEW");
    assert.equal(snapshot.artifacts.filter((artifact) =>
      artifact.path.startsWith(`delivery/${snapshot.project.active_delivery_id}/`)).length, 1);
    assert.equal((await call(`${route}/approve`, post({
      candidate_id: alternative, delivery_mode: "PROMPTS", expected_delivery_id: snapshot.project.active_delivery_id,
    }))).status, 200);
    snapshot = (await call(route)).data;
    assert.equal(snapshot.tasks.length, 0);
    assert.equal((await call(`${route}/build`, post({
      candidate_id: chosen, expected_delivery_id: snapshot.project.active_delivery_id,
    }))).status, 202, "A previously selected candidate can be selected again");
    snapshot = await waitFor(id, (value) => value.project.status === "READY_FOR_REVIEW");
    assert.equal(snapshot.tasks.length, 4);
    assert.ok(snapshot.tasks.every((task) => task.candidate_id === chosen && task.delivery_id === snapshot.project.active_delivery_id));
    assert.equal(Number((await db.query("SELECT count(*) FROM agent_tasks WHERE project_id=$1", [id])).rows[0].count), 12);
    assert.equal((await call(`${route}/artifacts?path=${encodeURIComponent(file.path)}`)).data.content, preview.data.content);
  } finally {
    for (const id of projects) {
      await db.query("DELETE FROM projects WHERE id = $1", [id]);
      assert.match(id, /^[0-9a-f-]{36}$/);
      await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
    }
    await db.end();
  }
});

test("multiple named transcripts add, deduplicate, analyze and change only the targeted source", { timeout: 60000 }, async () => {
      const base = process.env.TEST_WEB_URL;
      assert.ok(base && process.env.DATABASE_URL && process.env.MEDIA_DIR && process.env.WORKER_URL);
      assert.equal((await (await fetch(`${process.env.WORKER_URL}/health`)).json()).mock_ai, true);
      const db = new Pool({ connectionString: process.env.DATABASE_URL });
      const projects = [];
      const post = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      async function create(url, body) {
        const response = await fetch(url, post(body));
        const data = await response.json();
        assert.ok(response.ok, JSON.stringify(data));
        return data;
      }
      const material = (content, title, method = "POST", filename = "source.txt") => {
        const form = new FormData();
        form.set("file", new File([content], filename));
        form.set("title", title);
        return { method, body: form };
      };
      const firstText = "FIRST SOURCE & caf\u00e9";
      const firstVtt = `WEBVTT\n\nNOTE This metadata is not spoken evidence.\n\ncue-1\n00:00:01.000 --> 00:00:04.000\n<v Alice>${firstText.replace("&", "&amp;")}</v>\n\n`;
      try {
        for (const title of ["Multiple transcript test", "Transcript isolation neighbor"]) {
          projects.push((await create(`${base}/api/projects`, { title, description: "Isolated multiple transcript fixture", target_systems: [] })).id);
        }
        const [id, neighbor] = projects;
        const route = `${base}/api/projects/${id}`;
        const workshop = await create(`${route}/workshops`, { title: "Held workshop", notes: "Keep the workshop identity" });
        const other = await create(`${route}/workshops`, { title: "Another workshop" });
        const foreign = await create(`${base}/api/projects/${neighbor}/workshops`, { title: "Foreign workshop" });
        const collection = `${route}/workshops/${workshop.id}/transcripts`;
        const snapshot = async () => (await fetch(route)).json();
        async function ready() {
          for (let i = 0; i < 60; i++) {
            const current = await snapshot();
            assert.ok(!current.sessions.some((session) => session.pain_points_json?.error), JSON.stringify(current.sessions));
            if (current.project.status === "CANDIDATES_READY") return current;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          assert.fail("Multiple transcript analysis did not finish");
        }
        const firstSave = await fetch(`${route}/workshops/${workshop.id}/transcript`, material(firstVtt, "Morning", "POST", "morning.vtt"));
        assert.equal(firstSave.status, 200, "The singular compatibility route must add, not replace");
        const firstId = (await firstSave.json()).transcript_id;
        await create(`${route}/analyze`, { session_id: workshop.id });
        let current = await ready();
        await create(`${route}/approve`, { candidate_id: current.candidates[0].id, delivery_mode: "PROMPTS" });
        current = await snapshot();
        const delivery = current.project.active_delivery_id;
        const artifact = current.artifacts[0].path;
        const artifactFile = path.join(process.env.MEDIA_DIR, id, "artifacts", artifact);
        const originalExport = await readFile(artifactFile, "utf8");
        const secondUpload = material("SECOND ORIGINAL SOURCE", "Unused workshop rename");
        secondUpload.body.set("session_id", workshop.id);
        secondUpload.body.set("analyze", "false");
        assert.equal((await fetch(`${route}/sessions`, secondUpload)).status, 201,
          "The general upload route also adds to an existing workshop");
        current = await snapshot();
        let saved = current.sessions.find((session) => session.id === workshop.id);
        assert.equal(saved.title, "Held workshop");
        assert.equal(saved.transcripts.length, 2);
        assert.equal(saved.processed_at, null);
        assert.equal(saved.pain_points_json.status, "pending");
        assert.equal(current.project.active_delivery_id, delivery);
        assert.ok(current.candidates.every((candidate) => candidate.is_superseded));
        const secondId = saved.transcripts.find((part) => part.id !== firstId).id;
        const secondPath = saved.transcripts.find((part) => part.id === secondId).storage_path;
        const firstPath = saved.transcripts.find((part) => part.id === firstId).storage_path;
        assert.equal((await (await fetch(collection)).json()).transcripts.length, 2);
        const duplicate = await fetch(collection, material("  FIRST SOURCE & cafe\u0301 \n", "Duplicate TXT"));
        assert.equal(duplicate.status, 409, "Cue markup, metadata, whitespace and Unicode normalization must not hide a VTT/TXT copy");
        assert.equal((await fetch(`${collection}/${firstId}`, material("SECOND ORIGINAL SOURCE", "Duplicate replacement", "PUT"))).status, 409);
        assert.equal(await readFile(firstPath, "utf8"), firstVtt, "Rejected replacement leaves the original source untouched");
        assert.equal((await fetch(`${route}/workshops/${workshop.id}/transcript`, { method: "DELETE" })).status, 409,
          "Legacy removal must never delete a whole list");
        assert.equal((await fetch(`${route}/workshops/${other.id}/transcripts`, material(firstVtt, "Independent source", "POST", "other.vtt"))).status, 200,
          "The same spoken text remains valid in a different workshop");
        assert.equal((await fetch(`${route}/workshops/${foreign.id}/transcripts`, material("Foreign", "Foreign"))).status, 404);
        assert.equal((await fetch(`${route}/workshops/${other.id}/transcripts/${firstId}`, { method: "DELETE" })).status, 404);
        const concurrent = await Promise.all([1, 2].map((index) => fetch(collection, material("CONCURRENT SOURCE", `Copy ${index}`))));
        assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409]);
        saved = (await snapshot()).sessions.find((session) => session.id === workshop.id);
        const concurrentPart = saved.transcripts.find((part) => part.content === "CONCURRENT SOURCE");
        assert.equal(saved.transcripts.length, 3);
        assert.equal((await fetch(`${collection}/${concurrentPart.id}`, { method: "DELETE" })).status, 200);
        await db.query("UPDATE projects SET status='BUILDING' WHERE id=$1", [id]);
        assert.equal((await fetch(collection, material("Blocked source", "Blocked"))).status, 409);
        assert.equal((await fetch(`${collection}/${firstId}`, material("Blocked change", "Blocked", "PUT"))).status, 409);
        assert.equal((await fetch(`${collection}/${firstId}`, { method: "DELETE" })).status, 409);
        await db.query("UPDATE projects SET status='WORKSHOP_UPLOADED' WHERE id=$1", [id]);
        await db.query("UPDATE sessions SET pain_points_json='{\"status\":\"running\"}' WHERE id=$1", [other.id]);
        assert.equal((await fetch(collection, material("Blocked analysis source", "Blocked"))).status, 409);
        assert.equal((await fetch(`${collection}/${firstId}`, { method: "DELETE" })).status, 409);
        await db.query("UPDATE sessions SET pain_points_json=NULL WHERE id=$1", [other.id]);
        await create(`${route}/analyze`, { session_id: workshop.id });
        current = await ready();
        saved = current.sessions.find((session) => session.id === workshop.id);
        assert.ok(saved.transcript_vtt.includes(firstVtt));
        assert.ok(saved.transcript_vtt.includes("SECOND ORIGINAL SOURCE"));
        const prompt = await create(`${route}/prompts`, { candidate_id: current.candidates.find((candidate) => !candidate.is_superseded).id });
        for (const part of saved.transcripts) {
          assert.equal(prompt.prompt.split(`[transcript:${part.id}]`).length - 1, 1);
        }
        assert.equal((await fetch(`${collection}/${firstId}`, material("CORRECTED FIRST SOURCE", "Corrected morning", "PUT"))).status, 200);
        saved = (await snapshot()).sessions.find((session) => session.id === workshop.id);
        assert.equal(saved.transcripts.length, 2);
        assert.equal(saved.transcripts.find((part) => part.id === firstId).title, "Corrected morning");
        assert.equal(saved.transcripts.find((part) => part.id === secondId).content, "SECOND ORIGINAL SOURCE");
        assert.ok(!saved.transcript_vtt.includes(firstText));
        await assert.rejects(readFile(firstPath), { code: "ENOENT" });
        const correctedPath = saved.transcripts.find((part) => part.id === firstId).storage_path;
        assert.equal((await fetch(`${collection}/${firstId}`, { method: "DELETE" })).status, 200);
        saved = (await snapshot()).sessions.find((session) => session.id === workshop.id);
        assert.equal(saved.transcripts.length, 1);
        assert.equal(saved.transcript_vtt, "SECOND ORIGINAL SOURCE");
        assert.equal(saved.transcript_path, secondPath);
        assert.equal(await readFile(secondPath, "utf8"), "SECOND ORIGINAL SOURCE");
        await assert.rejects(readFile(correctedPath), { code: "ENOENT" });
        assert.equal(await readFile(artifactFile, "utf8"), originalExport);
        assert.equal((await snapshot()).project.active_delivery_id, delivery);
        assert.equal((await fetch(`${route}/workshops/${workshop.id}/transcript`, { method: "DELETE" })).status, 200);
        saved = (await snapshot()).sessions.find((session) => session.id === workshop.id);
        assert.equal(saved.transcripts.length, 0);
        assert.equal(saved.transcript_vtt, null);
        assert.equal(saved.notes, "Keep the workshop identity");
        assert.equal((await snapshot()).sessions.find((session) => session.id === other.id).transcripts.length, 1);
      } finally {
        for (const id of projects) {
          await db.query("DELETE FROM projects WHERE id=$1", [id]);
          await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
        }
        await db.end();
      }
});

test("workshop transcripts can be saved, corrected and removed without losing workshops or previous deliveries", { timeout: 60000 }, async () => {
  const base = process.env.TEST_WEB_URL;
  assert.ok(base && process.env.DATABASE_URL && process.env.MEDIA_DIR && process.env.WORKER_URL);
  assert.equal((await (await fetch(`${process.env.WORKER_URL}/health`)).json()).mock_ai, true);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  let id;
  async function post(url, body) {
    const response = await fetch(`${base}${url}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(response.ok, `${url}: ${JSON.stringify(data)}`);
    return data;
  }
  async function workspace() {
    const response = await fetch(`${base}/api/projects/${id}`);
    assert.equal(response.status, 200);
    return response.json();
  }
  async function ready() {
    for (let i = 0; i < 60; i++) {
      const current = await workspace();
      const failure = current.sessions.find((session) => session.pain_points_json?.error);
      assert.ok(!failure, JSON.stringify(failure));
      if (current.project.status === "CANDIDATES_READY") return current;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.fail("Transcript analysis did not finish");
  }
  async function save(sessionId, text, filename = "workshop.vtt", transcriptId) {
    const form = new FormData();
    form.set("file", new File([text], filename, { type: "text/vtt" }));
    return fetch(`${base}/api/projects/${id}/workshops/${sessionId}/transcripts${transcriptId ? `/${transcriptId}` : ""}`,
      { method: transcriptId ? "PUT" : "POST", body: form });
  }
  const vtt = (text) => `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n${text}\n`;
  try {
    id = (await post("/api/projects", {
      title: "Transcript corrections", description: "Preserve workshop identity and delivery history", target_systems: [],
    })).id;
    const first = await post(`/api/projects/${id}/workshops`, {
      title: "Held workshop", notes: "Keep these notes", scheduled_at: "2026-12-01T10:00:00.000Z",
      meeting_url: "https://teams.microsoft.com/retained",
    });
    const second = await post(`/api/projects/${id}/workshops`, { title: "Second workshop", notes: "Separate source" });
    await post(`/api/projects/${id}/agenda`, { session_id: first.id });
    const originalAgenda = (await workspace()).sessions.find((session) => session.id === first.id).agenda;
    assert.equal((await save(first.id, "invalid VTT")).status, 400);
    assert.equal((await save("00000000-0000-4000-8000-000000000001", vtt("Foreign workshop"))).status, 404);
    assert.equal((await save(first.id, vtt("WRONG ORIGINAL TRANSCRIPT"))).status, 200);
    let current = await workspace();
    let workshop = current.sessions.find((session) => session.id === first.id);
    assert.equal(workshop.processed_at, null, "Saving must not automatically call AI");
    assert.equal(workshop.pain_points_json.status, "pending");
    const wrongPath = workshop.transcript_path;
    const transcriptId = workshop.transcripts[0].id;
    assert.match(await readFile(wrongPath, "utf8"), /WRONG ORIGINAL/);
    await post(`/api/projects/${id}/analyze`, { session_id: first.id });
    current = await ready();
    const originalCandidate = current.candidates[0].id;
    await post(`/api/projects/${id}/approve`, { candidate_id: originalCandidate, delivery_mode: "PROMPTS" });
    current = await workspace();
    const originalDelivery = current.project.active_delivery_id;
    const originalArtifact = current.artifacts[0].path;
    const originalContent = await readFile(path.join(process.env.MEDIA_DIR, id, "artifacts", originalArtifact), "utf8");
    assert.match(originalContent, /WRONG ORIGINAL TRANSCRIPT/);
    assert.equal((await save(first.id, vtt("CORRECTED TRANSCRIPT"), "corrected.vtt", transcriptId)).status, 200);
    current = await workspace();
    workshop = current.sessions.find((session) => session.id === first.id);
    assert.equal(current.project.active_delivery_id, originalDelivery);
    assert.ok(current.candidates.every((candidate) => candidate.is_superseded));
    assert.equal(workshop.transcript_filename, "corrected.vtt");
    assert.equal(workshop.transcripts.length, 1);
    assert.equal(workshop.transcripts[0].id, transcriptId);
    assert.equal(workshop.agenda, originalAgenda);
    assert.equal(workshop.notes, "Keep these notes");
    assert.equal(workshop.scheduled_at, "2026-12-01T10:00:00.000Z");
    assert.equal(workshop.meeting_url, "https://teams.microsoft.com/retained");
    assert.equal(workshop.pain_points_json.status, "pending");
    assert.equal(workshop.current_state_mermaid, null);
    await assert.rejects(readFile(wrongPath), { code: "ENOENT" });
    const outdated = await post(`/api/projects/${id}/prompts`, { candidate_id: originalCandidate });
    assert.match(outdated.prompt, /VANHENTUNUT/);
    assert.match(outdated.prompt, /CORRECTED TRANSCRIPT/);
    assert.doesNotMatch(outdated.prompt, /WRONG ORIGINAL TRANSCRIPT/);
    const staleApproval = await fetch(`${base}/api/projects/${id}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: originalCandidate, delivery_mode: "PLAN", expected_delivery_id: originalDelivery }),
    });
    assert.equal(staleApproval.status, 409);
    assert.equal((await save(second.id, vtt("SEPARATE WORKSHOP TRANSCRIPT"))).status, 200);
    await post(`/api/projects/${id}/analyze`, { session_id: first.id });
    current = await ready();
    assert.equal(current.candidates.filter((candidate) => !candidate.is_superseded).length, 3);
    assert.ok(current.candidates.find((candidate) => candidate.id === originalCandidate).is_superseded);
    const nextCandidate = current.candidates.find((candidate) => !candidate.is_superseded).id;
    const portable = await post(`/api/projects/${id}/prompts`, { candidate_id: nextCandidate });
    assert.match(portable.prompt, /CORRECTED TRANSCRIPT/);
    assert.match(portable.prompt, /SEPARATE WORKSHOP TRANSCRIPT/);
    await post(`/api/projects/${id}/approve`, {
      candidate_id: nextCandidate, delivery_mode: "PLAN", expected_delivery_id: originalDelivery,
    });
    assert.equal(await readFile(path.join(process.env.MEDIA_DIR, id, "artifacts", originalArtifact), "utf8"), originalContent);
    current = await workspace();
    const correctedPath = current.sessions.find((session) => session.id === first.id).transcript_path;
    const videoPath = path.join(process.env.MEDIA_DIR, id, "retained-recording.mp4");
    await writeFile(videoPath, "Recording fixture must not be deleted");
    await db.query("UPDATE sessions SET video_path=$2 WHERE id=$1", [first.id, videoPath]);
    const removed = await fetch(`${base}/api/projects/${id}/workshops/${first.id}/transcript`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    workshop = (await workspace()).sessions.find((session) => session.id === first.id);
    assert.equal(workshop.transcript_vtt, null);
    assert.equal(workshop.transcript_path, null);
    assert.equal(workshop.video_path, videoPath);
    assert.equal(workshop.agenda, originalAgenda);
    assert.match(await readFile(videoPath, "utf8"), /must not be deleted/);
    await assert.rejects(readFile(correctedPath), { code: "ENOENT" });
    const otherTranscript = (await workspace()).sessions.find((session) => session.id === second.id).transcript_vtt;
    assert.match(otherTranscript, /SEPARATE WORKSHOP/);
    const secondPath = (await workspace()).sessions.find((session) => session.id === second.id).transcript_path;
    assert.equal((await fetch(`${base}/api/projects/${id}/workshops/${second.id}/transcript`, { method: "DELETE" })).status, 200);
    const emptied = (await workspace()).sessions.find((session) => session.id === second.id);
    assert.equal(emptied.video_path, null);
    assert.equal(emptied.transcript_vtt, null);
    assert.equal(emptied.title, "Second workshop");
    await assert.rejects(readFile(secondPath), { code: "ENOENT" });
    assert.equal((await save(second.id, vtt("REATTACHED CORRECT TRANSCRIPT"))).status, 200);
  } finally {
    if (id) {
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await rm(path.join(process.env.MEDIA_DIR, id), { recursive: true, force: true });
    }
    await db.end();
  }
});
