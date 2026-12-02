"use client";

import { useI18n } from "@/components/i18n";


import { useEffect, useState } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import type { Workspace } from "@/lib/types";
import { Artifacts } from "./artifacts";
import { implementationLabels, solutionTypeLabels } from "./implementation-tracker";

export function SolutionCanvas({ workspace, refinement, onRefinementChange }: {
  workspace: Workspace; refinement: string; onRefinementChange: (value: string) => void;
}) {
  const { t } = useI18n();

  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [target, setTarget] = useState<"copilot" | "claude" | "plan">("copilot");
  const [draftRefinement, setDraftRefinement] = useState(refinement);
  const [promptResult, setPromptResult] = useState({ key: "", text: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"architecture" | "prompt" | "artifacts">("architecture");
  const candidate = workspace.candidates.find((candidate) => candidate.id === candidateId)
    ?? workspace.candidates.find((candidate) => candidate.is_selected) ?? workspace.candidates[0];
  const project = workspace.project;
  const promptKey = `${project.id}/${candidate?.id}/${candidate?.is_selected}/${target}/${workspace.sessions.length}/${workspace.documents.length}/${refinement}`;
  const prompt = promptResult.key === promptKey ? promptResult.text : "";

  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    void requestJson(`/api/projects/${project.id}/prompts`,
      { ...postJson({ candidate_id: candidate.id, target, refinement }), signal: controller.signal }, z.object({ prompt: z.string() }))
      .then((result) => { setPromptResult({ key: promptKey, text: result.prompt }); setError(null); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t("Promptin luonti epäonnistui."));
      });
    return () => controller.abort();
  }, [project.id, candidate, target, promptKey, refinement, t]);

  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setNotice(t("Toteutusprompti on kopioitu.")); }
    catch (error) { setError(error instanceof Error ? error.message : t("Kopiointi epäonnistui. Valitse ja kopioi prompti tekstikentästä.")); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = target === "plan" ? "frw-implementation-plan.md" : `frw-${target}-implementation-prompt.md`;
    link.click(); URL.revokeObjectURL(url);
  }

  if (!candidate) return null;
  return <section className="panel solution-canvas">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="eyebrow">{t("Live canvas · Fasilitoitu Forward Deployment")}</p><h2>{t("Ratkaisun katselmointi ja toteutuspromptit")}</h2>
        <p className="subtitle">{t("Elävä ratkaisuluonnos ja syntyvät tuotokset. Koodi ei käynnisty automaattisesti.")}</p></div>
      <span className="system-tag">{project.status === "BUILDING" ? t("● Päivittyy 2 s välein") : project.status === "READY_FOR_REVIEW" ? t("Valmis katselmointiin") : t("Ratkaisuluonnos")}</span>
    </div>
    <label className="mt-5">{t("Katselmoitava kandidaatti")}<select value={candidate.id} onChange={(event) => { setCandidateId(event.target.value); setNotice(null); }}>
      {workspace.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}{candidate.is_selected ? t(" · Hyväksytty") : ""}</option>)}
    </select></label>
    <div className="canvas-board mt-6">
      <article className="canvas-node"><p className="eyebrow">{t("Lähtötilanne")}</p><h3>{project.title}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-500">{project.description}</p>
        <p className="mt-3 text-xs text-slate-500">{workspace.sessions.length}  {t("työpajaa ·")} {workspace.documents.length}  {t("taustalähdettä")}</p>
      </article>
      <article className="canvas-node canvas-focus"><p className="eyebrow">{t("Ratkaisu")}</p><h3>{candidate.title}</h3>
        <p className="mt-2 text-xs text-blue-700">{t(solutionTypeLabels[candidate.solution_type])}</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">{candidate.summary}</p>
        <button className="button-secondary mt-4" onClick={() => setView("architecture")}>{t("Katselmoi arkkitehtuuri")}</button>
      </article>
      <article className="canvas-node"><p className="eyebrow">{t("Toteutuspolku")}</p><h3>{candidate.is_selected ? t("Hyväksytty toteutukseen") : t("Odottaa ihmisen hyväksyntää")}</h3>
      {candidate.is_selected && <p className="mt-2 text-sm font-semibold">{t("Ratkaisun toteutus:")} {t(implementationLabels[candidate.implementation_status])}</p>}
        <p className="mt-3 text-sm leading-6 text-slate-500">{project.delivery_mode === "AGENTS" ? t("Arkkitehti → Koodaus → Data → QA")
          : project.delivery_mode === "PLAN" ? t("Toteutussuunnitelma – ei automaattista koodausta")
          : t("Promptit ja live-artefaktit voivat riittää ilman agenttifarmia.")}</p>
        <p className="mt-2 text-xs text-slate-500">{project.delivery_mode === "AGENTS" ? `${workspace.tasks.filter((task) => task.status === "completed").length}/4 ${t("agenttia valmiina")} · ` : ""}{workspace.artifacts.length}  {t("artefaktia")}</p>
        <button className="button-secondary mt-4" onClick={() => setView("artifacts")}>{t("Avaa syntyvät tuotokset")}</button>
      </article>
    </div>
    <div className="mt-5 flex flex-wrap gap-2" aria-label={t("Canvaksen katselmointikohde")}>
      <button className={view === "architecture" ? "button-primary" : "button-secondary"} onClick={() => setView("architecture")}>{t("Arkkitehtuuri")}</button>
      <button className={view === "prompt" ? "button-primary" : "button-secondary"} onClick={() => setView("prompt")}>{t("Promptit ja toteutussuunnitelma")}</button>
      <button className={view === "artifacts" ? "button-primary" : "button-secondary"} onClick={() => setView("artifacts")}>{t("Live-artefaktit ja prototyyppi")}</button>
    </div>
    {view === "architecture" && <pre className="agenda mt-5">{candidate.architecture_spec}</pre>}
    {view === "prompt" && <div className="mt-5 space-y-4">
      <p className="notice">{t("Prompti kokoaa fasilitoinnin, työpajahistorian, lähteet ja ratkaisuspeksin. Tarkista salassapito ja työkalun käyttöoikeudet ennen promptin siirtämistä ulkoiseen AI-palveluun.")}</p>
      <p className="field-hint">{t("MVP-mockhienosäätö: ei ChatGPT API -kutsuja eikä API-avaimen tarvetta. Mallipohja kokoaa fasilitoinnin tulokset ja omat tarkennuksesi.")}</p>
      <label>{t("Promptin tai suunnitelman tarkennukset")}<textarea rows={3} maxLength={5000} value={draftRefinement}
        placeholder={t("Esim. rajaa ensimmäinen pilotti ilman integraatioita; käytä nykyistä CRM:ää; keskity prosessimuutokseen.")}
        onChange={(event) => setDraftRefinement(event.target.value)} /></label>
      <button className="button-secondary" onClick={() => { onRefinementChange(draftRefinement); setNotice(t("Mockhienosäätö on päivitetty. Tarkennukset liitetään myös hyväksynnässä tallennettavaan toimitukseen.")); }}>{t("Hienosäädä luonnos (mock)")}</button>
      <div className="flex flex-wrap gap-2">
        <button className={target === "copilot" ? "button-primary" : "button-secondary"} onClick={() => { setTarget("copilot"); setNotice(null); }}>GitHub Copilot</button>
        <button className={target === "claude" ? "button-primary" : "button-secondary"} onClick={() => { setTarget("claude"); setNotice(null); }}>Claude</button>
        <button className={target === "plan" ? "button-primary" : "button-secondary"} onClick={() => { setTarget("plan"); setNotice(null); }}>{t("Toteutussuunnitelma")}</button>
        <button className="button-secondary" disabled={!prompt} onClick={() => void copy()}>{t("Kopioi prompti")}</button>
        <button className="button-secondary" disabled={!prompt} onClick={download}>{t("Lataa prompti")}</button>
      </div>
      <label>{t("Toteutusprompti")}<textarea value={prompt} readOnly rows={16} aria-label={t("Toteutusprompti")} /></label>
    </div>}
    {view === "artifacts" && <div className="mt-5">{candidate.is_selected
      ? <Artifacts id={project.id} files={workspace.artifacts} />
      : <p className="notice">{t("Tälle kandidaatille ei ole toteutusartefakteja. Hyväksy se ensin tai valitse jo hyväksytty ratkaisu.")}</p>}</div>}
    {error && <p className="error-message mt-4" role="alert">{error}</p>}
    {notice && <p className="notice mt-4" role="status">{notice}</p>}
  </section>;
}
