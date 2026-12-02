"use client";

import { useBrowserTimeZone, useI18n } from "@/components/i18n";


import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import { agentRoles, workspaceSchema, type DeliveryMode, type Workspace } from "@/lib/types";
import { StatusBadge, statusStages } from "./status-badge";
import { MermaidDiagram } from "./mermaid-diagram";
import { Artifacts } from "./artifacts";
import { SourceImport } from "./source-import";
import { SolutionCanvas } from "./solution-canvas";
import { ImplementationTracker, implementationLabels, solutionTypeLabels } from "./implementation-tracker";
import { WorkshopPlanner } from "./workshop-planner";

const stages = ["Valmistelu", "Työpaja", "Ratkaisut", "Toimitus"];
const roleLabels = { architect: "Arkkitehti", coder: "Koodaus", data: "Data", qa: "Testaus" };
const taskLabels = { pending: "Odottaa vuoroaan", running: "Työn alla", completed: "Valmis", failed: "Epäonnistui" };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function WorkspaceView({ initial }: { initial: Workspace }) {
  const { t, locale } = useI18n();
  const timeZone = useBrowserTimeZone();
  const euro = new Intl.NumberFormat(locale === "fi" ? "fi-FI" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const [workspace, setWorkspace] = useState(initial);
  const [stage, setStage] = useState(statusStages[initial.project.status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("PROMPTS");
  const [refinement, setRefinement] = useState("");
  const id = workspace.project.id;
  const base = `/api/projects/${id}`;
  const { project, documents, sessions, candidates, tasks } = workspace;
  const currentStage = statusStages[project.status];
  const uploadedSessions = sessions.filter((session) => session.video_path);
  const plannedSessions = sessions.filter((session) => !session.video_path);
  const session = uploadedSessions.find((session) => session.id === viewedSessionId) ?? uploadedSessions[0];
  const latest = uploadedSessions[0];
  const analysisError = latest?.pain_points_json && "error" in latest.pain_points_json
    ? latest.pain_points_json.error : null;
  const points = Array.isArray(session?.pain_points_json) ? session.pain_points_json : [];
  const failedTask = tasks.find((task) => task.status === "failed");
  const preparing = project.status === "PREPARATION" || project.status === "CANDIDATES_READY";
  const canUpload = preparing || project.status === "CANDIDATES_READY";
  const polling = (project.status === "BUILDING" && !failedTask)
    || (project.status === "WORKSHOP_UPLOADED" && !analysisError);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await requestJson(base, { signal }, workspaceSchema);
    setWorkspace(next);
    setPollError(null);
    return next;
  }, [base]);

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); }
      catch (error) {
        if (!controller.signal.aborted) setPollError(error instanceof Error ? error.message : t("Seurannan päivitys epäonnistui."));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [polling, refresh, t]);

  async function mutate(name: string, action: () => Promise<unknown>, nextStage?: number) {
    setBusy(name); setError(null); setNotice(null);
    try {
      await action();
      await refresh();
      if (nextStage !== undefined) setStage(nextStage);
      setNotice(name === "agenda" ? t("Työpajarunko on tallennettu.") : name === "context" ? t("Taustamateriaali on tallennettu.") : t("Työnkulku on käynnistetty."));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Toiminto epäonnistui."));
      try { await refresh(); } catch (refreshError) {
        setPollError(refreshError instanceof Error ? refreshError.message : t("Työtilan päivitys epäonnistui."));
      }
    } finally { setBusy(null); }
  }

  async function addContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await mutate("context", async () => {
      await requestJson(`${base}/context`, postJson({ filename: data.get("filename"), content_text: data.get("content_text") }), z.unknown());
      form.reset();
    });
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setViewedSessionId(null);
    await mutate("upload", async () => {
      await requestJson(`${base}/sessions`, { method: "POST", body: data }, z.unknown());
      form.reset();
    }, 1);
  }

  return <main className="shell">
    <Link href="/" className="text-sm text-slate-500">{t("← Kaikki projektit")}</Link>
    <header className="page-heading mt-6">
      <div><p className="eyebrow">{t("FRWDeployments-projektityötila")}</p><h1>{project.title}</h1>
        <p className="subtitle max-w-3xl whitespace-pre-wrap">{project.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">{project.target_systems.map((system, index) =>
          <span key={`${system}-${index}`} className="system-tag">{system}</span>)}</div>
      </div>
      <StatusBadge status={project.status} />
    </header>
    <div className="project-overview mb-6" aria-label={t("Projektin yhteenveto")}>
      <div><span className="overview-number">{documents.length}</span><span>{t("taustalähdettä")}</span></div>
      <div><span className="overview-number">{sessions.length}</span><span>{t("työpajaa ·")} {sessions.filter((session) => session.processed_at).length}  {t("analysoitu")}</span></div>
      <div><span className="overview-number">{candidates.length}</span><span>{t("ratkaisuvaihtoehtoa")}</span></div>
      <div><span className="overview-number">{workspace.artifacts.length}</span><span>{t("katselmoitavaa tuotosta")}</span></div>
    </div>
    <div className="stage-nav" role="tablist" aria-label={t("Projektin vaiheet")}>
      {stages.map((label, index) => <button key={label} type="button" role="tab"
        aria-selected={stage === index} aria-controls={`stage-${index}`} id={`tab-${index}`}
        className={`stage-button ${index < currentStage ? "stage-complete" : ""}`}
        onClick={() => setStage(index)}>
        <span className="stage-number" aria-hidden="true">{index < currentStage ? "✓" : index}</span>
        <span>{index}. {t(label)}{index === currentStage && <span className="block text-[.65rem] font-normal">{t("Nykyinen vaihe")}</span>}</span>
      </button>)}
    </div>
    {error && <p className="error-message mb-5" role="alert">{error}</p>}
    {pollError && <div className="error-message mb-5" role="alert">{t("Seuranta:")} {pollError}
      <button className="ml-4 underline" onClick={() => void mutate("refresh", () => refresh())}>{t("Päivitä nyt")}</button></div>}
    {notice && <p className="notice mb-5" role="status">{notice}</p>}

    {stage === 0 && <section id="stage-0" role="tabpanel" aria-labelledby="tab-0" className="workspace-grid">
      <div className="space-y-5">
        <form method="post" className="panel space-y-5" onSubmit={addContext}>
          <div><p className="eyebrow">{t("Vaihe 0 · Yhteinen lähtötilanne")}</p><h2>{t("Taustamateriaalit ja prosessikuvaukset")}</h2>
            <p className="subtitle">{t("Liitä nykytilan kuvaus, tavoitteet tai tärkeimmät kipupisteet tekstinä, tiedostoina tai GitHub-lähteenä.")}</p></div>
          <label>{t("Materiaalin nimi")}<input name="filename" required maxLength={200} placeholder={t("Esim. asiakaspalautteen nykyprosessi")} disabled={!preparing} /></label>
          <label>{t("Materiaalin sisältö")}<textarea name="content_text" required maxLength={100000} rows={7} placeholder={t("Liitä dokumentin teksti tähän…")} disabled={!preparing} /></label>
          <button className="button-primary" disabled={!!busy || !preparing}>{busy === "context" ? t("Tallennetaan…") : t("Lisää taustamateriaali")}</button>
          {!preparing && <p className="field-hint">{t("Valmistelu on lukittu analyysin ja toteutuksen ajaksi.")}</p>}
        </form>
        <SourceImport id={id} enabled={preparing && !busy} onSaved={() => refresh()} />
        <section className="panel"><h2>{t("Liitetyt materiaalit")} <span className="text-slate-400">({documents.length})</span></h2>
          {!documents.length && <p className="subtitle">{t("Taustamateriaaleja ei ole vielä lisätty.")}</p>}
          <div className="mt-4 space-y-4">{documents.map((document) => <details key={document.id}>
            <summary>{document.filename} <span className="text-xs text-slate-400">· {document.source_type}</span></summary>
            {document.source_url && <p className="mt-3 text-xs text-slate-500">{document.source_url} {document.source_revision && `@ ${document.source_revision.slice(0, 12)}`}</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{document.content_text}</p>
          </details>)}</div>
        </section>
      </div>
      <WorkshopPlanner id={id} workshops={sessions} enabled={preparing && !busy} onSaved={() => refresh()} />
    </section>}

    {stage === 1 && <section id="stage-1" role="tabpanel" aria-labelledby="tab-1" className="workspace-grid">
      <form method="post" className="panel space-y-5" onSubmit={upload}>
        <div><p className="eyebrow">{t("Vaihe 1 · Havainnointi")}</p><h2>{t("Lataa työpajatallenne tai litterointi")}</h2>
          <p className="subtitle">{t("Voit pitää useita työpajoja. Historiatiedot säilyvät, ja uusi analyysi yhdistää nykyisen työpajan aiempiin havaintoihin ennen kandidaattien päivittämistä.")}</p></div>
        <label>{t("Työpajan nimi")}<input name="title" required maxLength={200} defaultValue={`${t("Työpaja")} ${sessions.length + 1}`} disabled={!canUpload} /></label>
        {plannedSessions.length > 0 && <label>{t("Liitä suunniteltuun työpajaan")}<select name="session_id" disabled={!canUpload}>
          <option value="">{t("Luo uusi työpaja yllä olevalla nimellä")}</option>
          {plannedSessions.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.title}</option>)}
        </select><span className="field-hint">{t("Valitun työpajan nimi ja runko säilyvät. Uuden työpajan nimi ohitetaan.")}</span></label>}
        <label>{t("Tiedosto (.mp4, .vtt tai .txt)")}<input name="file" type="file" accept=".mp4,.vtt,.txt" required disabled={!canUpload} /></label>
        <p className="field-hint">{t("MP4 enintään 100 Mt. UTF-8-litterointi enintään 2 Mt. Varmista osallistujien suostumus ennen tallenteen lataamista.")}</p>
        <button className="button-primary" disabled={!!busy || !canUpload}>{busy === "upload" ? t("Ladataan ja käynnistetään…") : t("Lataa ja analysoi")}</button>
      </form>
      <section className="panel"><p className="eyebrow">{t("Analyysin tila")}</p><h2>{t("Puheesta ratkaisuvaihtoehdoiksi")}</h2>
        {!session && <p className="notice mt-5">{t("Lataa ensimmäinen työpajatallenne tai litterointi.")}</p>}
        {project.status === "WORKSHOP_UPLOADED" && !analysisError && <p className="notice mt-5" role="status">{t("Analyysi on käynnissä. Tila päivittyy automaattisesti 2 sekunnin välein.")}</p>}
        {analysisError && <div className="mt-5 space-y-4"><p className="error-message" role="alert">{t("Analyysi epäonnistui:")} {analysisError}</p>
          <button className="button-secondary" disabled={!!busy} onClick={() => void mutate("analyze",
            () => requestJson(`${base}/analyze`, postJson({ session_id: latest.id }), z.unknown()))}>{t("Yritä analyysia uudelleen")}</button></div>}
        {latest?.processed_at && !analysisError && <div className="mt-5"><p className="notice">{t("Analyysi valmis. Kipupistekartta, nykytilakaavio ja ratkaisukandidaatit ovat arvioitavana.")}</p>
          <button className="button-primary mt-5" onClick={() => setStage(2)}>{t("Siirry ratkaisuihin →")}</button></div>}
        <ol className="mt-6 space-y-3 text-sm text-slate-500"><li>{t("1. Litterointi ja kontekstin kokoaminen")}</li><li>{t("2. Aikaleimatut havainnot ja signaalifuusio")}</li><li>{t("3. Nykytila ja vaihtoehtoiset ratkaisukandidaatit")}</li></ol>
      </section>
      <section className="panel md:col-span-2"><h2>{t("Työpajahistoria (")}{sessions.length})</h2>
        <div className="mt-4 space-y-3">{sessions.map((workshop) => <div className="artifact-row" key={workshop.id}>
          <button onClick={() => { setViewedSessionId(workshop.id); setStage(2); }}>{workshop.title}</button>
          <span>{workshop.processed_at ? t("Analysoitu") : !workshop.video_path ? t("Suunniteltu") : workshop.pain_points_json && "error" in workshop.pain_points_json ? t("Analyysivirhe") : t("Käsiteltävänä")} · {new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(workshop.created_at))}</span>
        </div>)}</div>
      </section>
    </section>}

    {stage === 2 && <section id="stage-2" role="tabpanel" aria-labelledby="tab-2" className="space-y-6">
      <div><p className="eyebrow">{t("Vaihe 2 · Ihminen päättää")}</p><h2>{t("Kipupisteet, nykytila ja ratkaisuvaihtoehdot")}</h2>
        <p className="subtitle">{t("Signaalit ovat tulkinnan tukena, eivät todisteita osallistujien tunteista. Varmista havainnot yhdessä asiakkaan kanssa.")}</p></div>
      {uploadedSessions.length > 0 && <label>{t("Katselmoitava työpaja")}<select value={session?.id ?? ""} onChange={(event) => setViewedSessionId(event.target.value)}>
        {uploadedSessions.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.title} · {workshop.processed_at ? t("Analysoitu") : t("Kesken")}</option>)}
      </select></label>}
      {!session?.processed_at
        ? <p className="notice">{t("Tämän työpajan tulokset tulevat näkyviin analyysin valmistuttua.")}</p>
        : <>
          <div className="workspace-grid">
            <section className="panel"><h2>{t("Kipupistekartta")}</h2><p className="subtitle mb-6">{t("Aikaleimatut lainaukset ja havaintojen voimakkuus")}</p>
              <div className="timeline">{points.map((point, index) => <article className="timeline-item" key={index}>
                <div className="flex flex-wrap items-center gap-2"><time className="text-sm font-bold text-blue-700">{clock(point.timestamp_seconds)}</time>
                  <span className="system-tag">{point.emotion}</span></div>
                <blockquote>“{point.quote}”</blockquote><p className="text-xs leading-6 text-slate-500">{point.description}</p>
                <div className="intensity-track" role="meter" aria-label={t("Havainnon voimakkuus")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(point.intensity * 100)}>
                  <div className="intensity-fill" style={{ width: `${point.intensity * 100}%` }} /></div>
                <p className="mt-1 text-xs text-slate-400">{t("Voimakkuus")} {Math.round(point.intensity * 100)} %</p>
              </article>)}</div>
              {!points.length && <p className="notice">{t("Analyysi ei tuottanut aikaleimattuja kipupisteitä.")}</p>}
            </section>
            <section className="panel"><h2>{t("Nykytilan prosessikaavio")}</h2><p className="subtitle mb-5">{t("Työpajasta syntetisoitu prosessikuvaus")}</p>
              {session?.current_state_mermaid ? <MermaidDiagram chart={session.current_state_mermaid} /> : <p className="notice">{t("Kaaviota ei ole saatavilla.")}</p>}
            </section>
          </div>
          <SolutionCanvas workspace={workspace} refinement={refinement} onRefinementChange={setRefinement} />
          {candidates.filter((candidate) => candidate.is_selected).map((candidate) =>
            <ImplementationTracker key={candidate.id} id={id} candidate={candidate}
              locked={project.status === "BUILDING"} onSaved={() => refresh()} />)}
          <section className="panel space-y-4"><div><p className="eyebrow">{t("Toimitustapa · Agenttifarmi on valinnainen")}</p><h2>{t("Mikä lopputulos riittää asiakkaalle?")}</h2>
            <p className="subtitle">{t("Ratkaisu voi olla katselmoitu promptipaketti tai toteutussuunnitelma. Käynnistä koodia tuottavat agentit vain tarvittaessa.")}</p></div>
            <label>{t("Valitse toimitustapa")}<select value={project.delivery_mode ?? deliveryMode} disabled={project.status !== "CANDIDATES_READY" || !!busy}
              onChange={(event) => setDeliveryMode(z.enum(["PROMPTS", "PLAN", "AGENTS"]).parse(event.target.value))}>
              <option value="PROMPTS">{t("Promptipaketti Copilotiin / Claudeen – ei agentteja")}</option>
              <option value="PLAN">{t("Toteutussuunnitelma – ei automaattista koodausta")}</option>
              <option value="AGENTS">{t("Agenttitoteutus – arkkitehti, koodaus, data ja QA")}</option>
            </select></label>
            <p className="field-hint">{t("Promptien ja suunnitelman mockhienosäätö löytyy canvaksen Promptit ja toteutussuunnitelma -välilehdeltä. Promptit ja suunnitelma valmistuvat ilman API-avainta.")}</p>
          </section>
          <div><h2>{t("Vertaa ratkaisukandidaatteja")}</h2><p className="subtitle mb-5">{t("Kandidaatit perustuvat viimeisimpään kaikkien työpajojen synteesiin. Kustannukset ovat alustavia arvioita. Hyväksyntä tuottaa yllä valitun toimituksen.")}</p>
            <div className="candidate-grid">{candidates.map((candidate, index) => <article className={`panel candidate-card ${candidate.is_selected ? "selected" : ""}`} key={candidate.id}>
              <p className="eyebrow">{t("Vaihtoehto")} {String.fromCharCode(65 + index)}{candidate.is_selected ? t(" · Valittu") : ""}</p>
              <h2>{candidate.title}</h2><p className="text-sm leading-6 text-slate-600">{candidate.summary}</p>
              <div className="flex flex-wrap gap-2"><span className="system-tag">{t(solutionTypeLabels[candidate.solution_type])}</span>
                {candidate.is_selected && <span className="status-badge">{t("Toteutus:")} {t(implementationLabels[candidate.implementation_status])}</span>}</div>
              <p className="candidate-price">{candidate.estimated_cost === null ? t("Ei kustannusarviota") : euro.format(candidate.estimated_cost)}</p>
              <div><h3 className="mb-2 text-sm">{t("Liiketoimintahyödyt")}</h3><ul>{candidate.benefits.map((benefit, i) => <li key={i}>{benefit}</li>)}</ul></div>
              <div><h3 className="mb-2 text-sm">{t("Riskit ja huomioitavaa")}</h3><ul>{candidate.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul></div>
              <details><summary>{t("Arkkitehtuurispeksi")}</summary><pre className="agenda mt-3">{candidate.architecture_spec}</pre></details>
              <button className="button-primary mt-auto" disabled={!!busy || project.status !== "CANDIDATES_READY"}
                onClick={() => void mutate(candidate.id, () => requestJson(`${base}/${deliveryMode === "AGENTS" ? "build" : "approve"}`,
                  postJson(deliveryMode === "AGENTS" ? { candidate_id: candidate.id } : {
                    candidate_id: candidate.id, delivery_mode: deliveryMode, refinement,
                  }), z.unknown()), 3)}>
                {busy === candidate.id ? t("Valmistellaan…") : candidate.is_selected ? t("Valittu toimitukseen")
                  : deliveryMode === "AGENTS" ? t("Hyväksy ja käynnistä agenttitoteutus")
                  : deliveryMode === "PLAN" ? t("Hyväksy ja tuota toteutussuunnitelma") : t("Hyväksy ja vie promptipaketti")}</button>
            </article>)}</div>
          </div>
        </>}
    </section>}

    {stage === 3 && <section id="stage-3" role="tabpanel" aria-labelledby="tab-3" className="space-y-6">
      <div><p className="eyebrow">{t("Vaihe 3 · Toimitus asiakkaalle")}</p><h2>{project.delivery_mode === "AGENTS" ? t("Agenttitoteutuksen eteneminen")
        : project.delivery_mode === "PLAN" ? t("Toteutussuunnitelma") : t("Promptit ja katselmoitavat artefaktit")}</h2>
        <p className="subtitle">{project.status === "READY_FOR_REVIEW" ? t("Valittu toimitus on valmis asiakkaan katselmointiin.")
          : polling ? t("Tila ja lokit päivittyvät automaattisesti 2 sekunnin välein.") : t("Hyväksy kandidaatti ja valitse riittävä toimitustapa. Agenttifarmi ei ole pakollinen.")}</p></div>
      {project.delivery_mode && project.delivery_mode !== "AGENTS" && <p className="notice">
        {project.delivery_mode === "PLAN" ? t("Toimituksena on toteutussuunnitelma.") : t("Toimituksena on Copilot-/Claude-promptipaketti.")}  {t("Agentteja ei käynnistetty eikä koodia suoritettu. Varsinaisesta toteutuksesta voidaan sopia erikseen.")} </p>}
      {candidates.filter((candidate) => candidate.is_selected).map((candidate) =>
        <ImplementationTracker key={candidate.id} id={id} candidate={candidate}
          locked={project.status === "BUILDING"} onSaved={() => refresh()} />)}
      {failedTask && <p className="error-message" role="alert">{t("Agentti")} {t(roleLabels[failedTask.agent_role])}  {t("epäonnistui. Tarkista alla olevat lokit ja worker-palvelun asetukset. Toteutusta ei ole merkitty valmiiksi.")}</p>}
      {project.delivery_mode === "AGENTS" && <div className="kanban">{agentRoles.map((role, index) => {
        const task = tasks.find((task) => task.agent_role === role);
        return <section className="panel agent-card" key={role}>
          <p className="eyebrow">{t("Agentti")} {index + 1} / 4</p><h2>{t(roleLabels[role])}</h2>
          <p className={`task-status task-${task?.status ?? "pending"}`}>{task ? t(taskLabels[task.status]) : t("Ei vielä käynnistetty")}</p>
          {task?.output_log && <pre className="agent-log" aria-label={`${t(roleLabels[role])} ${t("lokit")}`}>{task.output_log}</pre>}
          {task?.updated_at && <p className="mt-3 text-[.65rem] text-slate-400">{t("Päivitetty")} {new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(task.updated_at))}</p>}
        </section>;
      })}</div>}
      <Artifacts id={id} files={workspace.artifacts} />
    </section>}
  </main>;
}
