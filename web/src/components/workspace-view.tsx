"use client";

import { useBrowserTimeZone, useI18n } from "@/components/i18n";


import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import { agentRoles, deliveryModeSchema, workspaceSchema, type DeliveryMode, type Workspace } from "@/lib/types";
import { isWrittenOutput, writtenOutputs } from "@/lib/deliveries";
import { StatusBadge, statusStages } from "./status-badge";
import { MermaidDiagram } from "./mermaid-diagram";
import { Artifacts } from "./artifacts";
import { SourceImport } from "./source-import";
import { SolutionCanvas } from "./solution-canvas";
import { ImplementationTracker, implementationLabels, solutionTypeLabels } from "./implementation-tracker";
import { WorkshopPlanner } from "./workshop-planner";
import { AiModeNotice, GenerationNotice } from "./ai-notice";
import { WorkshopTranscript } from "./workshop-transcript";
import { DeleteProject } from "./delete-project";

const stages = [
  { label: "Havainnoi", name: "Observe", description: "Aineisto ja työpajat" },
  { label: "Ymmärrä", name: "Orient", description: "Tilannekuva ja tulkinnat" },
  { label: "Päätä", name: "Decide", description: "Vaihtoehdot ja hyväksyntä" },
  { label: "Toimi", name: "Act", description: "Tuotokset ja vaikutukset" },
];
const roleLabels = { architect: "Arkkitehti", coder: "Koodaus", data: "Data", qa: "Testaus" };
const taskLabels = { pending: "Odottaa vuoroaan", running: "Työn alla", completed: "Valmis", failed: "Epäonnistui" };
const deliveryLabels: Record<DeliveryMode, string> = {
  REPORT: writtenOutputs.REPORT.title,
  RECOMMENDATION: writtenOutputs.RECOMMENDATION.title,
  PROCESS: writtenOutputs.PROCESS.title,
  GUIDE: writtenOutputs.GUIDE.title,
  EXPERIMENT: writtenOutputs.EXPERIMENT.title,
  PROMPTS: "Toteutusprompti – käytä valitsemassasi palvelussa",
  PLAN: "Toteutussuunnitelma – ei automaattista koodausta",
  AGENTS: "Agenttitoteutus – arkkitehti, koodaus, data ja QA",
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function WorkspaceView({ initial }: { initial: Workspace }) {
  const { t, locale } = useI18n();
  const timeZone = useBrowserTimeZone();

  const [workspace, setWorkspace] = useState(initial);
  const [stage, setStage] = useState(initial.iteration?.status === "ACT" ? 3 : statusStages[initial.project.status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [uploadSessionId, setUploadSessionId] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(initial.project.delivery_mode ?? "REPORT");
  const [draftCandidateId, setDraftCandidateId] = useState<string | null>(null);
  const [decisionRationale, setDecisionRationale] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [feedback, setFeedback] = useState("");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [refinement, setRefinement] = useState("");
  const id = workspace.project.id;
  const base = `/api/projects/${id}`;
  const { project, documents, sessions, candidates, tasks, iteration } = workspace;
  const selectedCandidate = candidates.find((candidate) => candidate.id === iteration?.selected_solution_id)
    ?? candidates.find((candidate) => candidate.is_selected);
  const draftCandidate = candidates.find((candidate) => candidate.id === draftCandidateId);
  const decisionLocked = iteration?.status === "ACT";
  const demo = workspace.ai.status === "available" && workspace.ai.mode === "mock";
  const currentCandidates = candidates.filter((candidate) => !candidate.is_superseded);
  const uploadedSessions = sessions.filter((session) => session.video_path || session.transcripts.length);
  const uploadWorkshop = sessions.find((workshop) => workshop.id === uploadSessionId);
  const pendingSession = uploadedSessions.find((session) => !session.processed_at);
  const session = uploadedSessions.find((session) => session.id === viewedSessionId) ?? pendingSession ?? uploadedSessions[0];
  const points = Array.isArray(session?.pain_points_json) ? session.pain_points_json : [];
  const failedTask = tasks.find((task) => task.status === "failed");
  const preparing = !decisionLocked && ["PREPARATION", "CANDIDATES_READY", "READY_FOR_REVIEW"].includes(project.status);
  const analysisRunning = sessions.some((session) => session.pain_points_json
    && "status" in session.pain_points_json && session.pain_points_json.status === "running");
  const polling = (project.status === "BUILDING" && !failedTask) || analysisRunning;
  const transcriptEnabled = project.status !== "BUILDING" && !decisionLocked && !analysisRunning && !busy;
  const canAnalyze = transcriptEnabled;
  const canDecide = !!iteration && !decisionLocked && !analysisRunning
    && ["CANDIDATES_READY", "READY_FOR_REVIEW"].includes(project.status);
  const canCreateOutput = decisionLocked && !!selectedCandidate && !selectedCandidate.is_superseded
    && !analysisRunning && ["CANDIDATES_READY", "READY_FOR_REVIEW"].includes(project.status);
  const suggestedStage = decisionLocked || failedTask || project.status === "BUILDING" ? 3
    : analysisRunning || pendingSession ? 1
      : iteration && currentCandidates.some((candidate) => candidate.iteration_id === iteration.id) ? 2 : 0;
  const nextStep = suggestedStage === 1
    ? analysisRunning ? "Analyysi kokoaa tilannekuvaa" : "Muodosta aineistosta tilannekuva"
    : suggestedStage === 2 ? "Vertaa vaihtoehtoja ja valitse seuraava teko"
      : suggestedStage === 3 ? failedTask ? "Tarkista toteutuksen virhe"
        : decisionLocked && !project.active_delivery_id ? "Laadi päätöstä tukeva tuotos" : "Katselmoi tuotos ja kirjaa vaikutukset"
        : "Kokoa havainnot yhteiseen työtilaan";

  function navigateStage(index: number) {
    setStage(index);
    tabs.current[index]?.focus();
  }

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
      const next = await refresh();
      if (nextStage !== undefined) setStage(nextStage);
      setNotice(name === "agenda" ? t("Työpajarunko on tallennettu.") : name === "context" ? t("Taustamateriaali on tallennettu.")
        : name === "upload" ? t("Työpajan aineisto on tallennettu. Käynnistä analyysi työpajan tiedoista.")
          : name === "decision" ? t("Päätös on vahvistettu. Tuotoksia tai agenttityötä ei vielä käynnistetty.")
            : name === "complete" ? t("Kierros on päätetty ja katselmointi tallennettu uutena baselinena.")
          : nextStage === 3 && next.project.status === "READY_FOR_REVIEW" ? t("Valittu tuotos on valmis katselmoitavaksi.") : t("Työnkulku on käynnistetty."));
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
    const file = data.get("file");
    const transcript = file instanceof File && /\.(vtt|txt)$/i.test(file.name);
    const url = uploadSessionId && transcript
      ? `${base}/workshops/${uploadSessionId}/transcripts` : `${base}/sessions`;
    data.set("analyze", "false");
    await mutate("upload", async () => {
      const saved = await requestJson(url, { method: "POST", body: data }, z.object({ session_id: z.string() }));
      setViewedSessionId(saved.session_id);
      form.reset();
    }, 1);
  }

  async function confirmDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftCandidate || !iteration) { setError(t("Valitse tämän kierroksen ajantasainen ratkaisuehdotus.")); return; }
    await mutate("decision", () => requestJson(`${base}/decision`, postJson({
      candidate_id: draftCandidate.id, expected_iteration_id: iteration.id,
      decision_rationale: decisionRationale, hypothesis,
    }), z.unknown()), 3);
  }

  async function createOutput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCandidate || !decisionLocked) { setError(t("Vahvista tämän ratkaisun päätös Päätä-osiossa ennen tuotoksen tekemistä.")); return; }
    await mutate("output", () => requestJson(`${base}/${deliveryMode === "AGENTS" ? "build" : "approve"}`,
      postJson({
        candidate_id: selectedCandidate.id, expected_delivery_id: project.active_delivery_id, refinement,
        ...(deliveryMode === "AGENTS" ? {} : { delivery_mode: deliveryMode }),
      }), z.unknown()), 3);
  }

  async function completeCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!iteration || !project.active_delivery_id) { setError(t("Katselmoi nykyinen valmis tuotos ennen kierroksen päättämistä.")); return; }
    await mutate("complete", () => requestJson(`${base}/complete`, postJson({
      expected_iteration_id: iteration.id, expected_delivery_id: project.active_delivery_id, feedback,
    }), z.unknown()), 0);
  }

  return <main className="shell workspace-shell">
    <Link href="/" className="text-sm text-slate-500">{t("← Kaikki projektit")}</Link>
    <header className="page-heading mt-6">
      <div><p className="eyebrow">{t("FRWDeployments-projektityötila")}</p><h1>{project.title}</h1>
        <p className="subtitle max-w-3xl whitespace-pre-wrap">{project.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">{project.target_systems.map((system, index) =>
          <span key={`${system}-${index}`} className="system-tag">{system}</span>)}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-3">
        <StatusBadge status={project.status} />
        <DeleteProject id={id} title={project.title} disabled={!!busy || analysisRunning || (project.status === "BUILDING" && !failedTask)
          || tasks.some((task) => task.status === "pending" || task.status === "running")} />
      </div>
    </header>
    <AiModeNotice ai={workspace.ai} />
    <div className="project-overview mb-6" aria-label={t("Projektin yhteenveto")}>
      <div><span className="overview-number">{documents.length}</span><span>{t("taustalähdettä")}</span></div>
      <div><span className="overview-number">{sessions.length}</span><span>{t("työpajaa ·")} {sessions.filter((session) => session.processed_at).length}  {t("analysoitu")}</span></div>
      <div><span className="overview-number">{candidates.length}</span><span>{t("ratkaisuvaihtoehtoa")}</span></div>
      <div><span className="overview-number">{workspace.artifacts.length}</span><span>{t("katselmoitavaa tuotosta")}</span></div>
    </div>
    <section className="next-step" aria-labelledby="next-step-title">
      <div><p className="eyebrow">{t("Seuraava hyödyllinen askel")}</p>
        <h2 id="next-step-title">{t(nextStep)}</h2>
        <p>{t("Ihminen päättää. AI auttaa jäsentämään. Voit palata havaintoihin milloin tahansa.")}</p>
      </div>
      <button type="button" className="button-primary" onClick={() => navigateStage(suggestedStage)}>
        {t(stages[suggestedStage].label)} <span aria-hidden="true">→</span>
      </button>
    </section>
    <div className="stage-nav ooda-nav" role="tablist" aria-label={t("OODA-työtila")}>
      {stages.map(({ label, name, description }, index) => <button key={name} type="button" role="tab"
        ref={(element) => { tabs.current[index] = element; }}
        tabIndex={stage === index ? 0 : -1}
        aria-selected={stage === index} aria-controls={`stage-${index}`} id={`tab-${index}`}
        className="stage-button"
        onClick={() => setStage(index)}
        onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % stages.length
            : event.key === "ArrowLeft" ? (index + stages.length - 1) % stages.length
              : event.key === "Home" ? 0 : event.key === "End" ? stages.length - 1 : null;
          if (next !== null) { event.preventDefault(); navigateStage(next); }
        }}>
        <span className="stage-number" aria-hidden="true">{name[0]}</span>
        <span><strong>{t(label)}</strong><span className="stage-description">{t(description)}</span></span>
      </button>)}
    </div>
    {error && <p className="error-message mb-5" role="alert">{error}</p>}
    {pollError && <div className="error-message mb-5" role="alert">{t("Seuranta:")} {pollError}
      <button className="ml-4 underline" onClick={() => void mutate("refresh", () => refresh())}>{t("Päivitä nyt")}</button></div>}
    {notice && <p className="notice mb-5" role="status">{notice}</p>}

    {stage === 0 && <section id="stage-0" role="tabpanel" aria-labelledby="tab-0" className="space-y-6">
      {decisionLocked && <p className="notice">{t("Kierroksen päätös on vahvistettu. Katselmoi tuotos ja päätä kierros Toimi-osiossa ennen aineiston muuttamista.")}</p>}
      <div className="workspace-section-heading"><div><p className="eyebrow">Observe</p>
        <h2>{t("Yhteinen tietopohja")}</h2><p className="subtitle">{t("Lisää aineistoa, suunnittele keskustelu tai tuo uuden kokeilun havainnot. Tallennus ei käynnistä analyysiä.")}</p></div>
        <button className="button-secondary" onClick={() => navigateStage(1)}>{t("Muodosta tilannekuva →")}</button>
      </div>
      <div className="workspace-grid">
      <div className="space-y-5">
        <details className="panel workspace-disclosure" open={documents.length === 0}>
          <summary>{t("Lisää taustamateriaalia")}</summary>
        <form method="post" className="mt-5 space-y-5" onSubmit={addContext}>
          <div><h2>{t("Taustamateriaalit ja prosessikuvaukset")}</h2>
            <p className="subtitle">{t("Liitä nykytilan kuvaus, tavoitteet tai tärkeimmät kipupisteet tekstinä, tiedostoina tai GitHub-lähteenä.")}</p></div>
          <label>{t("Materiaalin nimi")}<input name="filename" required maxLength={200} placeholder={t("Esim. asiakaspalautteen nykyprosessi")} disabled={!preparing} /></label>
          <label>{t("Materiaalin sisältö")}<textarea name="content_text" required maxLength={100000} rows={7} placeholder={t("Liitä dokumentin teksti tähän…")} disabled={!preparing} /></label>
          <button className="button-primary" disabled={!!busy || !preparing}>{busy === "context" ? t("Tallennetaan…") : t("Lisää taustamateriaali")}</button>
          {!preparing && <p className="field-hint">{t("Valmistelu on lukittu analyysin ja toteutuksen ajaksi.")}</p>}
        </form>
        <SourceImport id={id} enabled={preparing && !busy} onSaved={() => refresh()} />
        </details>
        <section className="panel"><h2>{t("Liitetyt materiaalit")} <span className="text-slate-400">({documents.length})</span></h2>
          {!documents.length && <p className="subtitle">{t("Taustamateriaaleja ei ole vielä lisätty.")}</p>}
          <div className="mt-4 space-y-4">{documents.map((document) => <details key={document.id}>
            <summary>{document.filename} <span className="text-xs text-slate-400">· {document.source_type}</span></summary>
            {document.source_url && <p className="mt-3 text-xs text-slate-500">{document.source_url} {document.source_revision && `@ ${document.source_revision.slice(0, 12)}`}</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{document.content_text}</p>
          </details>)}</div>
        </section>
      </div>
      <WorkshopPlanner id={id} workshops={sessions} enabled={preparing && !busy}
        mode={workspace.ai.status === "available" ? workspace.ai.mode : null}
        transcriptEnabled={!!transcriptEnabled} canAnalyze={!!canAnalyze} onSaved={() => refresh()}
        onViewAnalysis={(sessionId) => { setViewedSessionId(sessionId); navigateStage(1); }} />
      </div>

      <details className="panel workspace-disclosure" open={uploadedSessions.length === 0}>
        <summary>{t("Lisää työpajatallenne tai litterointi")}</summary>
      <form method="post" className="mt-5 space-y-5" onSubmit={upload}>
        <div><h2>{t("Lisää työpajatallenne tai litterointi")}</h2>
          <p className="subtitle">{t("Voit pitää useita työpajoja. Historiatiedot säilyvät, ja uusi analyysi yhdistää nykyisen työpajan aiempiin havaintoihin ennen kandidaattien päivittämistä.")}</p></div>
        <label>{t("Työpaja, johon aineisto lisätään")}<select name="session_id" value={uploadSessionId}
          onChange={(event) => setUploadSessionId(event.target.value)} disabled={!transcriptEnabled}>
          <option value="">{t("Luo uusi työpaja")}</option>
          {sessions.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.title}</option>)}
        </select><span className="field-hint">{t("Voit valita myös jo pidetyn työpajan. Sen nimi, runko ja muut tiedot säilyvät.")}</span></label>
        {!uploadSessionId && <label>{t("Työpajan nimi")}<input name="title" required maxLength={200}
          defaultValue={`${t("Työpaja")} ${sessions.length + 1}`} disabled={!transcriptEnabled} /></label>}
        <label>{t("Tiedosto (.mp4, .vtt tai .txt)")}<input name="file" type="file"
          accept={uploadWorkshop?.video_path?.toLowerCase().endsWith(".mp4") ? ".vtt,.txt" : ".mp4,.vtt,.txt"}
          required disabled={!transcriptEnabled} /></label>
        {uploadWorkshop?.video_path?.toLowerCase().endsWith(".mp4") && <p className="field-hint">{t("Työpajalla on jo video. Voit lisätä tai vaihtaa sen transkription.")}</p>}
        {uploadWorkshop && <p className="notice">{t("Uusi VTT/TXT lisätään valitun työpajan muiden transkriptioiden rinnalle. Aiempi analyysi ja ratkaisuehdotusten ajantasaisuus mitätöidään; toimitukset säilyvät. Korvaa yksittäinen transkriptio työpajan tiedoista.")}</p>}
        <p className="field-hint">{t("MP4 enintään 100 Mt. UTF-8-litterointi enintään 2 Mt. Varmista osallistujien suostumus ennen aineiston lisäämistä.")}</p>
        <p className="notice">{t("Aineisto tallennetaan valitulle työpajalle ilman API-kutsuja. Käynnistä analyysi erikseen työpajan tiedoista.")}</p>
        <p className="notice">{t("VTT tai TXT riittää sisällön kipupisteiden ja ratkaisuehdotusten AI-analyysiin, kun OpenAI API on otettu käyttöön. Tekstistä ei mitata äänenpainoja tai ilmeitä. Videon ääni- ja ilmesignaalit vaativat lisäksi erillisen signaalipalvelun.")}</p>
        <button className="button-primary" disabled={!transcriptEnabled}>{busy === "upload" ? t("Tallennetaan…")
          : uploadSessionId ? t("Lisää aineisto työpajalle") : t("Lisää työpaja ja aineisto")}</button>
      </form>
      </details>
    </section>}

    {stage === 1 && <section id="stage-1" role="tabpanel" aria-labelledby="tab-1" className="space-y-6">
      <div className="workspace-section-heading"><div><p className="eyebrow">Orient</p><h2>{t("Ymmärrä tilanne ennen päätöstä")}</h2>
        <p className="subtitle">{t("Signaalit ovat tulkinnan tukena, eivät todisteita osallistujien tunteista. Varmista havainnot yhdessä asiakkaan kanssa.")}</p></div>
        <button className="button-secondary" onClick={() => navigateStage(0)}>{t("Täydennä havaintoja")}</button>
      </div>
      {analysisRunning && <p className="notice" role="status">{t("Analyysi on käynnissä. Tila päivittyy automaattisesti 2 sekunnin välein.")}</p>}
      {!session && <div className="panel empty-state"><h2>{t("Tilannekuva alkaa havainnoista")}</h2>
        <p>{t("Lisää ensimmäinen työpajatallenne tai litterointi.")}</p>
        <button className="button-primary mt-5" onClick={() => navigateStage(0)}>{t("Lisää aineistoa")}</button></div>}
      {uploadedSessions.length > 0 && <label>{t("Katselmoitava työpaja")}<select value={session?.id ?? ""} onChange={(event) => setViewedSessionId(event.target.value)}>
        {uploadedSessions.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.title} · {workshop.processed_at ? t("Analysoitu") : t("Kesken")}</option>)}
      </select></label>}
      {session && !session.processed_at && <section className="panel">
        <h2>{session.title}</h2><p className="subtitle">{t("Käynnistä analyysi, kun aineisto on valmis. AI:n tulkinnat katselmoidaan ennen päätöstä.")}</p>
        <WorkshopTranscript id={id} workshop={session} enabled={!!transcriptEnabled} canAnalyze={!!canAnalyze} onSaved={() => refresh()} />
      </section>}
      {!session?.processed_at
        ? <p className="notice">{t("Tämän työpajan tulokset tulevat näkyviin analyysin valmistuttua.")}</p>
        : <>
          <div className="workspace-grid">
            <section className="panel"><h2>{t("Kipupistekartta")}</h2><GenerationNotice mode={session.analysis_mode} />
              <p className="subtitle mb-6">{t("Aikaleimatut lainaukset ja havaintojen voimakkuus")}</p>
              {!session.video_path?.toLowerCase().endsWith(".mp4") && <p className="field-hint mb-4">{t("Tekstiaineisto: tunne- ja voimakkuusarviot eivät ole mitattuja ääni- tai ilmesignaaleja.")}</p>}
              <div className="timeline">{points.map((point, index) => <article className="timeline-item" key={index}>
                <div className="flex flex-wrap items-center gap-2"><time className="text-sm font-bold text-blue-700">{clock(point.timestamp_seconds)}</time>
                  {point.transcript_id && <span className="text-xs text-slate-600">{session?.transcripts.find((part) => part.id === point.transcript_id)?.title}</span>}
                  <span className="system-tag">{point.emotion}</span></div>
                <blockquote>“{point.quote}”</blockquote><p className="text-xs leading-6 text-slate-500">{point.description}</p>
                <div className="intensity-track" role="meter" aria-label={t("Havainnon voimakkuus")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(point.intensity * 100)}>
                  <div className="intensity-fill" style={{ width: `${point.intensity * 100}%` }} /></div>
                <p className="mt-1 text-xs text-slate-400">{t("Voimakkuus")} {Math.round(point.intensity * 100)} %</p>
              </article>)}</div>
              {!points.length && <p className="notice">{t("Analyysi ei tuottanut aikaleimattuja kipupisteitä.")}</p>}
            </section>
            <section className="panel"><h2>{t("Nykytilan prosessikaavio")}</h2><GenerationNotice mode={session.analysis_mode} /><p className="subtitle mb-5">{t("Työpajasta syntetisoitu prosessikuvaus")}</p>
              {session?.current_state_mermaid ? <MermaidDiagram chart={session.current_state_mermaid} /> : <p className="notice">{t("Kaaviota ei ole saatavilla.")}</p>}
            </section>
          </div>
        </>}
      {currentCandidates.length > 0 && <div className="workspace-section-heading panel">
        <div><h2>{t("Tilannekuvasta päätökseen")}</h2><p className="subtitle">{t("Tarkista havainnot ja vertaile niiden pohjalta syntyneitä vaihtoehtoja.")}</p></div>
        <button className="button-primary" onClick={() => navigateStage(2)}>{t("Vertaa vaihtoehtoja →")}</button>
      </div>}
    </section>}

    {stage === 2 && <section id="stage-2" role="tabpanel" aria-labelledby="tab-2" className="space-y-6">
      <div className="workspace-section-heading"><div><p className="eyebrow">Decide</p><h2>{t("Valitse seuraava teko")}</h2>
        <p className="subtitle">{t("Ratkaisuehdotus kertoo, miten ongelmaa lähestytään. Päätös määrittelee seuraavan teon ja onnistumiskriteerin. Tuotos tehdään erikseen Toimi-osiossa.")}</p></div>
        <button className="button-secondary" onClick={() => navigateStage(1)}>{t("Tarkista tilannekuva")}</button>
      </div>
      {!candidates.length && <div className="panel empty-state"><h2>{t("Vaihtoehdot syntyvät analyysistä")}</h2>
        <p>{t("Kokoa ja analysoi aineisto ensin. Mitään ratkaisua ei valita automaattisesti.")}</p>
        <button className="button-primary mt-5" onClick={() => navigateStage(1)}>{t("Muodosta tilannekuva →")}</button></div>}
      {decisionLocked && <section className="panel space-y-4"><h2>{t("Vahvistettu päätös")}</h2>
        <h3>{selectedCandidate?.title}</h3><p className="whitespace-pre-wrap">{iteration.decision_rationale}</p>
        <p className="whitespace-pre-wrap">{iteration.hypothesis}</p>
        <p className="notice">{t("Kierroksen päätös on lukittu. Tuotostyyppiä voi vaihtaa Toimi-osiossa muuttamatta ratkaisua. Uusi ratkaisu edellyttää uutta päätöskierrosta.")}</p>
        <button className="button-primary" onClick={() => navigateStage(3)}>{t("Siirry tekemään tuotoksia →")}</button>
      </section>}
      {!iteration && candidates.length > 0 && <p className="notice">{t("Aloita seuraava kierros lisäämällä uutta aineistoa ja analysoimalla se. Aiemmat päätökset ja tuotokset säilyvät.")}</p>}
      {candidates.length > 0 && !decisionLocked && <>
          <div><h2>{t("Vertaa ratkaisukandidaatteja")}</h2><p className="subtitle mb-5">{t("Valinta on luonnos, kunnes vahvistat päätöksen. Ehdotuksen valitseminen ei tee API-kutsuja eikä käynnistä tuotosta.")}</p>
            <div className="candidate-grid">{candidates.map((candidate, index) => <article className={`panel candidate-card ${candidate.id === draftCandidateId ? "selected" : ""}`} key={candidate.id}>
              <p className="eyebrow">{t("Vaihtoehto")} {String.fromCharCode(65 + index)}{candidate.id === draftCandidateId ? t(" · Valittu") : ""}</p>
              <h2>{candidate.title}</h2><p className="text-sm leading-6 text-slate-600">{candidate.summary}</p>
              <GenerationNotice mode={candidate.generation_mode} />
              {candidate.is_superseded && <p className="notice">{t("Lähdeaineisto on muuttunut. Tämä on aiempi ratkaisuehdotus; päivitä analyysi ennen uutta hyväksyntää.")}</p>}
              <div className="flex flex-wrap gap-2"><span className="system-tag">{t(solutionTypeLabels[candidate.solution_type])}</span>
                {candidate.is_selected && <span className="status-badge">{t("Toteutus:")} {t(implementationLabels[candidate.implementation_status])}</span>}</div>
              <div><h3 className="mb-2 text-sm">{t("Liiketoimintahyödyt")}</h3><ul>{candidate.benefits.map((benefit, i) => <li key={i}>{benefit}</li>)}</ul></div>
              <div><h3 className="mb-2 text-sm">{t("Riskit ja huomioitavaa")}</h3><ul>{candidate.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul></div>
              <details><summary>{t("Ratkaisukuvaus ja ehdotettu toimintatapa")}</summary><pre className="agenda mt-3">{candidate.architecture_spec}</pre></details>
              <button type="button" className="button-secondary mt-auto" aria-pressed={candidate.id === draftCandidateId}
                disabled={!!busy || !canDecide || candidate.is_superseded || candidate.iteration_id !== iteration?.id}
                onClick={() => setDraftCandidateId(candidate.id)}>
                {candidate.id === draftCandidateId ? t("Valittu päätösluonnokseen") : t("Valitse ratkaisuehdotus")}</button>
            </article>)}</div>
          </div>
          {canDecide && <form className="panel space-y-5" onSubmit={confirmDecision}>
            <h2>{t("Vahvista seuraava teko")}</h2>
            <p>{draftCandidate?.title ?? t("Valitse ensin ratkaisuehdotus yllä olevista vaihtoehdoista.")}</p>
            <label>{t("Miksi tämä ratkaisu?")}<textarea required rows={3} maxLength={5000} value={decisionRationale}
              onChange={(event) => setDecisionRationale(event.target.value)} disabled={!!busy} /></label>
            <label>{t("Seuraava teko ja onnistumiskriteeri")}<textarea required rows={4} maxLength={5000} value={hypothesis}
              placeholder={t("Mitä kokeillaan seuraavaksi, ja mistä tiedetään sen auttaneen?")}
              onChange={(event) => setHypothesis(event.target.value)} disabled={!!busy} /></label>
            <p className="field-hint">{t("Vahvistus tallentaa päätöksen ja siirtää kierroksen ACT-tilaan. Se ei generoi dokumentteja eikä käynnistä agentteja.")}</p>
            <button className="button-primary" disabled={!!busy || !draftCandidate || draftCandidate.is_superseded || draftCandidate.iteration_id !== iteration?.id}>
              {busy === "decision" ? t("Tallennetaan…") : t("Vahvista päätös ja siirry toimimaan")}</button>
          </form>}
        </>}
    </section>}

    {stage === 3 && <section id="stage-3" role="tabpanel" aria-labelledby="tab-3" className="space-y-6">
      <div><p className="eyebrow">Act</p><h2>{project.delivery_mode === "AGENTS" ? t("Agenttitoteutuksen eteneminen")
        : project.delivery_mode && isWrittenOutput(project.delivery_mode) ? t(writtenOutputs[project.delivery_mode].title)
          : project.delivery_mode === "PLAN" ? t("Toteutussuunnitelma") : t("Tuotokset")}</h2>
        <p className="subtitle">{project.status === "READY_FOR_REVIEW" ? t("Valittu lopputulos on valmis katselmoitavaksi. Tarkista tuotosten alkuperämerkinnät.")
          : polling ? t("Tila ja lokit päivittyvät automaattisesti 2 sekunnin välein.") : t("Tuotos tukee ratkaisua. Koodausta tai agentteja ei tarvita kaikkiin ratkaisuihin.")}</p></div>
      {selectedCandidate && <button className="button-secondary" onClick={() => navigateStage(2)}>{t("Katso päätös tai ratkaisuvaihtoehdot")}</button>}
      {canCreateOutput ? <form className="panel space-y-5" onSubmit={createOutput}>
        <div><h2>{t("Tarvitsetko dokumentin tai toteutuksen?")}</h2>
          <p className="subtitle">{t("Tuotos tukee vahvistettua ratkaisua. Voit vaihtaa tuotostyyppiä tai tehdä uuden version ilman uutta ratkaisupäätöstä.")}</p></div>
        <p><strong>{t("Vahvistettu ratkaisu:")}</strong> {selectedCandidate?.title}</p>
        <label>{t("Valitse tuotos")}<select value={deliveryMode} disabled={!!busy}
          onChange={(event) => setDeliveryMode(deliveryModeSchema.parse(event.target.value))}>
          {Object.entries(deliveryLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select></label>
        <label>{t("Tuotoksen rajaus tai tarkennukset")}<textarea rows={3} maxLength={5000} value={refinement}
          onChange={(event) => setRefinement(event.target.value)} disabled={!!busy} /></label>
        {isWrittenOutput(deliveryMode) && <p className="notice">{demo
          ? t("Demotilassa syntyy paikallinen mallipohjaluonnos aineisto-otteineen. Aineistopohjainen AI-generointi edellyttää OpenAI API:n käyttöönottoa.")
          : t("Generointi käyttää OpenAI API:a ja voi olla maksullista. Tuotos on ihmisen tarkistettava AI-luonnos.")}</p>}
        {deliveryMode === "AGENTS" && <p className="notice">{demo
          ? t("Vahvistus käynnistää uuden simuloidun agenttiketjun.")
          : t("Vahvistus käynnistää uuden agenttiketjun ja voi tehdä maksullisia API-kutsuja.")}</p>}
        {["PLAN", "PROMPTS"].includes(deliveryMode) && <p className="field-hint">{t("Promptit ja suunnitelma koostetaan paikallisesti ilman API-kutsuja.")}</p>}
        <button className="button-primary" disabled={!!busy}>
          {busy === "output" ? t("Valmistellaan…") : deliveryMode === "AGENTS" ? t("Käynnistä agenttitoteutus") : t("Laadi valittu tuotos")}</button>
      </form> : !decisionLocked && <p className="notice">{t("Vahvista päätös Päätä-osiossa ennen uuden tuotoksen tekemistä. Aiemmat tuotokset ovat edelleen katselmoitavissa.")}</p>}
      {project.delivery_mode && isWrittenOutput(project.delivery_mode) && <div className="space-y-3">
        <GenerationNotice mode={project.delivery_generation_mode} />
        <p className="notice">{t("Tämä tuotos perustuu toimitettuun projektiaineistoon. Se ei ole ulkoisilla lähteillä varmennettu selvitys. Tarkista lähdeviitteet, tulkinnat ja avoimet kysymykset ennen hyväksymistä.")}</p>
        <p className="field-hint">{t("Koodia tai agenttiketjua ei käynnistetty. Tuotoksen katselmointi ja mahdollisista jatkotoimista päättäminen riittää seuraavaksi askeleeksi.")}</p>
      </div>}
      {project.delivery_mode && ["PLAN", "PROMPTS"].includes(project.delivery_mode) && <p className="notice">
        {project.delivery_mode === "PLAN" ? t("Toimituksena on toteutussuunnitelma.")
          : project.active_delivery_id ? t("Toimituksena on yhteinen toteutusprompti. Lataa se palvelusta ja käytä valitsemassasi työkalussa.")
          : t("Aiempi prompttitoimitus säilyy alkuperäisenä. Uuden yhteisen toteutuspromptin voit ladata Ratkaisut-vaiheen canvaksesta.")}  {t("Agentteja ei käynnistetty eikä koodia suoritettu. Varsinaisesta toteutuksesta voidaan sopia erikseen.")} </p>}
      {project.delivery_mode && isWrittenOutput(project.delivery_mode) &&
        <Artifacts id={id} files={workspace.artifacts} activeDeliveryId={project.active_delivery_id}
          awaitingDelivery={decisionLocked && !project.active_delivery_id} />}
      {candidates.filter((candidate) => candidate.is_selected).map((candidate) =>
        <div key={candidate.id}><p className="field-hint">{t("Ratkaisuehdotuksen alkuperä")}</p><GenerationNotice mode={candidate.generation_mode} />
          {candidate.is_superseded && <p className="notice">{t("Lähdeaineisto on muuttunut. Tämä on aiempi ratkaisuehdotus; päivitä analyysi ennen uutta hyväksyntää.")}</p>}
          <div className="mt-4">
            <ImplementationTracker id={id} candidate={candidate}
              locked={project.status === "BUILDING"} onSaved={() => refresh()} /></div></div>)}
      {failedTask && <p className="error-message" role="alert">{t("Agentti")} {t(roleLabels[failedTask.agent_role])}  {t("epäonnistui. Tarkista alla olevat lokit ja worker-palvelun asetukset. Toteutusta ei ole merkitty valmiiksi.")}</p>}
      {project.delivery_mode === "AGENTS" && <div className="kanban">{agentRoles.map((role, index) => {
        const task = tasks.find((task) => task.agent_role === role);
        return <section className="panel agent-card" key={role}>
          <p className="eyebrow">{t("Agentti")} {index + 1} / 4</p><h2>{t(roleLabels[role])}</h2>
          {task && <GenerationNotice mode={task.generation_mode} />}
          <p className={`task-status task-${task?.status ?? "pending"}`}>{task ? t(taskLabels[task.status]) : t("Ei vielä käynnistetty")}</p>
          {task?.output_log && <pre className="agent-log" aria-label={`${t(roleLabels[role])} ${t("lokit")}`}>{task.output_log}</pre>}
          {task?.updated_at && <p className="mt-3 text-[.65rem] text-slate-400">{t("Päivitetty")} {new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(task.updated_at))}</p>}
        </section>;
      })}</div>}
      {(!project.delivery_mode || !isWrittenOutput(project.delivery_mode)) &&
        <Artifacts id={id} files={workspace.artifacts} activeDeliveryId={project.active_delivery_id}
          awaitingDelivery={decisionLocked && !project.active_delivery_id} />}
      {candidates.length > 0 && <details className="workspace-disclosure"><summary>{t("Ratkaisukuvaus, canvas ja viennit")}</summary>
        <div className="mt-5"><SolutionCanvas workspace={workspace} refinement={refinement} onRefinementChange={setRefinement} /></div>
      </details>}
      {decisionLocked && project.status === "READY_FOR_REVIEW" && project.active_delivery_id && <form className="panel space-y-5" onSubmit={completeCycle}>
        <h2>{t("Katselmoi ja päätä kierros")}</h2>
        <p className="subtitle">{t("Valmis dokumentti ei todista vaikutusta. Kirjaa katselmointi, havaittu vaikutus tai vielä puuttuva näyttö ennen seuraavaa kierrosta.")}</p>
        <label>{t("Katselmointi ja opit")}<textarea required rows={4} maxLength={10000} value={feedback}
          onChange={(event) => setFeedback(event.target.value)} disabled={!!busy} /></label>
        <button className="button-primary" disabled={!!busy}>{busy === "complete" ? t("Tallennetaan…") : t("Hyväksy katselmointi ja päätä kierros")}</button>
      </form>}
      <section className="loop-return panel">
        <div><p className="eyebrow">{t("Takaisin havaintoihin")}</p><h2>{t("Mitä toiminnasta opittiin?")}</h2>
          <p className="subtitle">{decisionLocked
            ? t("Kierroksen päätös on vahvistettu. Katselmoi tuotos ja päätä kierros Toimi-osiossa ennen aineiston muuttamista.")
            : t("Kirjaa vaikutukset seurannan muistiinpanoihin. Lisää kokeilun palaute uutena työpaja-aineistona ja päivitä tilannekuva. Aiemmat päätökset ja toimitukset säilyvät.")}</p>
        </div>
        <button className="button-secondary" disabled={decisionLocked || !!busy} onClick={() => navigateStage(0)}>{t("Lisää uusia havaintoja")} <span aria-hidden="true">↻</span></button>
      </section>
    </section>}
  </main>;
}
