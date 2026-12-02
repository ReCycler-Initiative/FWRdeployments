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
import { AgendaContent, WorkshopPlanner } from "./workshop-planner";
import { AiModeNotice, GenerationNotice } from "./ai-notice";
import { WorkshopTranscript } from "./workshop-transcript";
import { DeleteProject } from "./delete-project";

const stages = ["Valmistelu", "Työpaja", "Ratkaisut", "Tuotokset"];
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
type ApprovalChoice = { candidateId: string; deliveryMode: DeliveryMode; expectedDeliveryId: string | null; refinement: string };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function WorkspaceView({ initial }: { initial: Workspace }) {
  const { t, locale } = useI18n();
  const timeZone = useBrowserTimeZone();

  const [workspace, setWorkspace] = useState(initial);
  const [stage, setStage] = useState(statusStages[initial.project.status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [openWorkshopId, setOpenWorkshopId] = useState<string | null>(null);
  const [uploadSessionId, setUploadSessionId] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(initial.project.delivery_mode ?? "REPORT");
  const [pendingChoice, setPendingChoice] = useState<ApprovalChoice | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const [refinement, setRefinement] = useState("");
  const id = workspace.project.id;
  const base = `/api/projects/${id}`;
  const { project, documents, sessions, candidates, tasks } = workspace;
  const selectedCandidate = candidates.find((candidate) => candidate.is_selected);
  const canApprove = project.status === "CANDIDATES_READY" || project.status === "READY_FOR_REVIEW";
  const demo = workspace.ai.status === "available" && workspace.ai.mode === "mock";
  const currentStage = statusStages[project.status];
  const uploadedSessions = sessions.filter((session) => session.video_path || session.transcripts.length);
  const uploadWorkshop = sessions.find((workshop) => workshop.id === uploadSessionId);
  const session = uploadedSessions.find((session) => session.id === viewedSessionId) ?? uploadedSessions[0];
  const latest = uploadedSessions[0];
  const analysisError = latest?.pain_points_json && "error" in latest.pain_points_json
    ? latest.pain_points_json.error : null;
  const points = Array.isArray(session?.pain_points_json) ? session.pain_points_json : [];
  const failedTask = tasks.find((task) => task.status === "failed");
  const preparing = project.status === "PREPARATION" || project.status === "CANDIDATES_READY";
  const analysisRunning = sessions.some((session) => session.pain_points_json
    && "status" in session.pain_points_json && session.pain_points_json.status === "running");
  const polling = (project.status === "BUILDING" && !failedTask) || analysisRunning;
  const transcriptEnabled = project.status !== "BUILDING" && !analysisRunning && !busy;
  const canAnalyze = project.status !== "BUILDING" && !analysisRunning && !busy;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await requestJson(base, { signal }, workspaceSchema);
    setWorkspace(next);
    setPollError(null);
    return next;
  }, [base]);

  useEffect(() => {
    if (pendingChoice) confirmation.current?.showModal();
    else confirmation.current?.close();
  }, [pendingChoice]);

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
      setOpenWorkshopId(saved.session_id);
      form.reset();
    }, 1);
  }

  async function submitChoice(choice: ApprovalChoice) {
    setPendingChoice(null);
    await mutate(choice.candidateId, () => requestJson(`${base}/${choice.deliveryMode === "AGENTS" ? "build" : "approve"}`,
      postJson({
        candidate_id: choice.candidateId, expected_delivery_id: choice.expectedDeliveryId,
        ...(choice.deliveryMode === "AGENTS" ? {} : { delivery_mode: choice.deliveryMode, refinement: choice.refinement }),
      }), z.unknown()), 3);
  }

  function choose(candidateId: string) {
    const choice = { candidateId, deliveryMode, expectedDeliveryId: project.active_delivery_id, refinement };
    if (selectedCandidate) setPendingChoice(choice);
    else void submitChoice(choice);
  }

  return <main className="shell">
    <dialog ref={confirmation} className="panel selection-dialog" aria-labelledby="selection-confirm-title"
      onCancel={() => setPendingChoice(null)}>
      {pendingChoice && <div className="space-y-5">
        <h2 id="selection-confirm-title">{t("Vahvista valinnan muutos")}</h2>
        <p><strong>{t("Nykyinen valinta:")}</strong> {selectedCandidate?.title}</p>
        <p><strong>{t("Uusi valinta:")}</strong> {candidates.find((candidate) => candidate.id === pendingChoice.candidateId)?.title}</p>
        <p><strong>{t("Lopputulos:")}</strong> {t(deliveryLabels[pendingChoice.deliveryMode])}</p>
        <p className="notice">{t("Aiemmat toimitustiedostot ja toteutuksen seurantatiedot säilyvät. Uusi valinta luo uuden toimituksen, eikä peruuta ulkoisissa työkaluissa tehtyä työtä.")}</p>
        {pendingChoice.deliveryMode === "AGENTS" && <p className="field-hint">{demo
          ? t("Vahvistus käynnistää uuden simuloidun agenttiketjun.")
          : t("Vahvistus käynnistää uuden agenttiketjun ja voi tehdä maksullisia API-kutsuja.")}</p>}
        {isWrittenOutput(pendingChoice.deliveryMode) && <p className="field-hint">{demo
          ? t("Vahvistus luo aineisto-otteita sisältävän demoluonnoksen, ei varmennettua selvitystä.")
          : t("Vahvistus generoi AI-luonnoksen OpenAI API:lla ja voi tehdä maksullisia API-kutsuja. Ulkoista tiedonhakua ei tehdä.")}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="button-secondary" onClick={() => setPendingChoice(null)}>{t("Peruuta")}</button>
          <button type="button" className="button-primary" onClick={() => void submitChoice(pendingChoice)}>{t("Vahvista ja vaihda valinta")}</button>
        </div>
      </div>}
    </dialog>
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
      <WorkshopPlanner id={id} workshops={sessions} enabled={preparing && !busy}
        mode={workspace.ai.status === "available" ? workspace.ai.mode : null}
        transcriptEnabled={!!transcriptEnabled} canAnalyze={!!canAnalyze} onSaved={() => refresh()} />
    </section>}

    {stage === 1 && <section id="stage-1" role="tabpanel" aria-labelledby="tab-1" className="workspace-grid">
      <form method="post" className="panel space-y-5" onSubmit={upload}>
        <div><p className="eyebrow">{t("Vaihe 1 · Havainnointi")}</p><h2>{t("Lisää työpajatallenne tai litterointi")}</h2>
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
      <section className="panel"><p className="eyebrow">{t("Analyysin tila")}</p><h2>{t("Puheesta ratkaisuvaihtoehdoiksi")}</h2>
        {!session && <p className="notice mt-5">{t("Lisää ensimmäinen työpajatallenne tai litterointi.")}</p>}
        {analysisRunning && <p className="notice mt-5" role="status">{t("Analyysi on käynnissä. Tila päivittyy automaattisesti 2 sekunnin välein.")}</p>}
        {project.status === "WORKSHOP_UPLOADED" && !analysisRunning && !analysisError && <p className="notice mt-5">{t("Aineisto odottaa analyysiä. Valitse työpajan kohdalta Analysoi työpaja päivittääksesi ratkaisukokonaisuuden.")}</p>}
        {analysisError && <div className="mt-5 space-y-4"><p className="error-message" role="alert">{t("Analyysi epäonnistui:")} {analysisError}</p>
          <button className="button-secondary" disabled={!!busy} onClick={() => void mutate("analyze",
            () => requestJson(`${base}/analyze`, postJson({ session_id: latest.id }), z.unknown()))}>{t("Yritä analyysia uudelleen")}</button></div>}
        {latest?.processed_at && !analysisError && <div className="mt-5"><GenerationNotice mode={latest.analysis_mode} />
          <p className="notice">{latest.analysis_mode === "mock" ? t("Demoanalyysi valmis. Näytetään esimerkkikipupisteet, esimerkkikaavio ja esimerkkiratkaisut.") : t("Analyysi valmis. Kipupistekartta, nykytilakaavio ja ratkaisukandidaatit ovat arvioitavana.")}</p>
          <button className="button-primary mt-5" onClick={() => setStage(2)}>{t("Siirry ratkaisuihin →")}</button></div>}
        <ol className="mt-6 space-y-3 text-sm text-slate-500"><li>{t("1. Litterointi ja kontekstin kokoaminen")}</li><li>{t("2. Aikaleimatut havainnot ja signaalifuusio")}</li><li>{t("3. Nykytila ja vaihtoehtoiset ratkaisukandidaatit")}</li></ol>
      </section>
      <section className="panel md:col-span-2"><h2>{t("Työpajahistoria (")}{sessions.length})</h2>
        <div className="mt-4 space-y-3">{sessions.map((workshop) => <article className="workshop-card" key={workshop.id}><div className="artifact-row">
          <button type="button" aria-expanded={openWorkshopId === workshop.id} aria-controls={`workshop-${workshop.id}`}
            onClick={() => setOpenWorkshopId(openWorkshopId === workshop.id ? null : workshop.id)}>{workshop.title}</button>
          <span>{workshop.processed_at ? t("Analysoitu") : !workshop.video_path && !workshop.transcripts.length ? t("Suunniteltu")
            : workshop.pain_points_json && "error" in workshop.pain_points_json ? t("Analyysivirhe")
            : workshop.pain_points_json && "status" in workshop.pain_points_json && workshop.pain_points_json.status === "running"
              ? t("Analyysi on käynnissä") : t("Odottaa analyysiä")} · {new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(workshop.created_at))}</span>
        </div>{openWorkshopId === workshop.id && <div id={`workshop-${workshop.id}`} className="mt-4 space-y-4"
          role="region" aria-label={`${t("Työpajan tiedot:")} ${workshop.title}`}>
          {workshop.notes && <p className="whitespace-pre-wrap text-sm">{workshop.notes}</p>}
          {workshop.scheduled_at && <p className="field-hint">{new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB",
            { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(workshop.scheduled_at))}</p>}
          {workshop.meeting_url && <a className="button-secondary" href={workshop.meeting_url}
            target="_blank" rel="noopener noreferrer">{t("Kokouslinkki ↗")}</a>}
          {workshop.agenda && <details><summary>{t("Työpajarunko")}</summary><GenerationNotice mode={workshop.agenda_mode} />
            <AgendaContent text={workshop.agenda} /></details>}
          <WorkshopTranscript id={id} workshop={workshop} enabled={!!transcriptEnabled} canAnalyze={!!canAnalyze} onSaved={() => refresh()} />
          {workshop.processed_at && <button className="button-secondary"
            onClick={() => { setViewedSessionId(workshop.id); setStage(2); }}>{t("Näytä tämän työpajan analyysi →")}</button>}
        </div>}</article>)}</div>
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
        {candidates.length > 0 && <>
          <SolutionCanvas workspace={workspace} refinement={refinement} onRefinementChange={setRefinement} />
          {candidates.filter((candidate) => candidate.is_selected).map((candidate) =>
            <ImplementationTracker key={candidate.id} id={id} candidate={candidate}
              locked={project.status === "BUILDING"} onSaved={() => refresh()} />)}
          <section className="panel space-y-4"><div><p className="eyebrow">{t("Ratkaisu ei edellytä koodausta")}</p><h2>{t("Valitse lopputulos")}</h2>
            <p className="subtitle">{t("Lopputulos voi olla selvitys, suositus, toimintamalli, ohjeistus tai kokeilusuunnitelma. Valitse ohjelmistototeutus vain tarvittaessa.")}</p></div>
            {selectedCandidate && <p className="notice"><strong>{t("Nykyinen valinta:")}</strong> {selectedCandidate.title}<br />
              {canApprove ? t("Voit vertailla muita vaihtoehtoja ja vaihtaa ratkaisua tai lopputulosta vahvistamalla uuden valinnan.")
                : t("Vaihtoehtoja voi katsella, mutta valinnan muuttaminen on estetty BUILDING-vaiheessa.")}</p>}
            <label>{t("Valitse tuotos")}<select value={deliveryMode} disabled={!canApprove || !!busy}
              onChange={(event) => setDeliveryMode(deliveryModeSchema.parse(event.target.value))}>
              {Object.entries(deliveryLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select></label>
            {isWrittenOutput(deliveryMode) ? <>
              <label>{t("Tuotoksen rajaus tai tarkennukset")}<textarea rows={3} maxLength={5000} value={refinement}
                onChange={(event) => setRefinement(event.target.value)} disabled={!canApprove || !!busy} /></label>
              <p className="notice">{demo
                ? t("Demotilassa syntyy paikallinen mallipohjaluonnos aineisto-otteineen. Aineistopohjainen AI-generointi edellyttää OpenAI API:n käyttöönottoa.")
                : t("Generointi käyttää OpenAI API:a ja voi olla maksullista. Tuotos on ihmisen tarkistettava AI-luonnos.")}</p>
              <p className="field-hint">{t("Tietopohjana käytetään projektin aineistoa. Ulkoista tiedonhakua tai riippumatonta lähdevarmennusta ei tehdä. Lähdetiedot, ehdotukset ja epävarmuudet erotetaan toisistaan.")}</p>
            </> : <p className="field-hint">{t("Promptien ja suunnitelman mockhienosäätö löytyy canvaksen Promptit ja toteutussuunnitelma -välilehdeltä. Promptit ja suunnitelma valmistuvat ilman API-avainta.")}</p>}
          </section>
          <div><h2>{t("Vertaa ratkaisukandidaatteja")}</h2><p className="subtitle mb-5">{t("Tarkista jokaisen ehdotuksen alkuperämerkintä. Hyväksyntä tuottaa valitsemasi lopputuloksen; se ei vahvista ehdotuksen oikeellisuutta.")}</p>
            <div className="candidate-grid">{candidates.map((candidate, index) => <article className={`panel candidate-card ${candidate.is_selected ? "selected" : ""}`} key={candidate.id}>
              <p className="eyebrow">{t("Vaihtoehto")} {String.fromCharCode(65 + index)}{candidate.is_selected ? t(" · Valittu") : ""}</p>
              <h2>{candidate.title}</h2><p className="text-sm leading-6 text-slate-600">{candidate.summary}</p>
              <GenerationNotice mode={candidate.generation_mode} />
              {candidate.is_superseded && <p className="notice">{t("Lähdeaineisto on muuttunut. Tämä on aiempi ratkaisuehdotus; päivitä analyysi ennen uutta hyväksyntää.")}</p>}
              <div className="flex flex-wrap gap-2"><span className="system-tag">{t(solutionTypeLabels[candidate.solution_type])}</span>
                {candidate.is_selected && <span className="status-badge">{t("Toteutus:")} {t(implementationLabels[candidate.implementation_status])}</span>}</div>
              <div><h3 className="mb-2 text-sm">{t("Liiketoimintahyödyt")}</h3><ul>{candidate.benefits.map((benefit, i) => <li key={i}>{benefit}</li>)}</ul></div>
              <div><h3 className="mb-2 text-sm">{t("Riskit ja huomioitavaa")}</h3><ul>{candidate.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul></div>
              <details><summary>{t("Ratkaisukuvaus ja ehdotettu toimintatapa")}</summary><pre className="agenda mt-3">{candidate.architecture_spec}</pre></details>
              <button className="button-primary mt-auto" disabled={!!busy || !canApprove || candidate.is_superseded
                || (candidate.is_selected && project.delivery_mode === deliveryMode)}
                onClick={() => choose(candidate.id)}>
                {busy === candidate.id ? t("Valmistellaan…") : candidate.is_selected && project.delivery_mode === deliveryMode ? t("Valittu toimitukseen")
                  : selectedCandidate ? candidate.is_selected ? t("Muuta lopputulosta") : t("Vaihda tähän ratkaisuun")
                  : deliveryMode === "AGENTS" ? demo ? t("Hyväksy ja simuloi agenttitoteutus") : t("Hyväksy ja käynnistä agenttitoteutus")
                  : isWrittenOutput(deliveryMode) ? t(writtenOutputs[deliveryMode].action)
                    : deliveryMode === "PLAN" ? t("Hyväksy ja tuota toteutussuunnitelma") : t("Hyväksy ja vie promptipaketti")}</button>
            </article>)}</div>
          </div>
        </>}
    </section>}

    {stage === 3 && <section id="stage-3" role="tabpanel" aria-labelledby="tab-3" className="space-y-6">
      <div><p className="eyebrow">{t("Vaihe 3 · Valittu lopputulos")}</p><h2>{project.delivery_mode === "AGENTS" ? t("Agenttitoteutuksen eteneminen")
        : project.delivery_mode && isWrittenOutput(project.delivery_mode) ? t(writtenOutputs[project.delivery_mode].title)
          : project.delivery_mode === "PLAN" ? t("Toteutussuunnitelma") : t("Tuotokset")}</h2>
        <p className="subtitle">{project.status === "READY_FOR_REVIEW" ? t("Valittu lopputulos on valmis katselmoitavaksi. Tarkista tuotosten alkuperämerkinnät.")
          : polling ? t("Tila ja lokit päivittyvät automaattisesti 2 sekunnin välein.") : t("Valitse ratkaisu ja tarpeeseen sopiva tuotos. Koodausta tai agentteja ei tarvita kaikkiin ratkaisuihin.")}</p></div>
      {selectedCandidate && <button className="button-secondary" onClick={() => setStage(2)}>{t("Vertaa vaihtoehtoja tai muuta valintaa")}</button>}
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
        <Artifacts id={id} files={workspace.artifacts} activeDeliveryId={project.active_delivery_id} />}
      {candidates.filter((candidate) => candidate.is_selected).map((candidate) =>
        <div key={candidate.id}><p className="field-hint">{t("Ratkaisuehdotuksen alkuperä")}</p><GenerationNotice mode={candidate.generation_mode} />
          {candidate.is_superseded && <p className="notice">{t("Lähdeaineisto on muuttunut. Tämä on aiempi ratkaisuehdotus; päivitä analyysi ennen uutta hyväksyntää.")}</p>}
          <details className="mt-4"><summary>{t("Ratkaisun etenemisen seuranta")}</summary><div className="mt-3">
            <ImplementationTracker id={id} candidate={candidate}
              locked={project.status === "BUILDING"} onSaved={() => refresh()} /></div></details></div>)}
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
        <Artifacts id={id} files={workspace.artifacts} activeDeliveryId={project.active_delivery_id} />}
    </section>}
  </main>;
}
