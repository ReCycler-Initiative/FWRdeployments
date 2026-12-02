"use client";

import { useI18n } from "@/components/i18n";


import { useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import type { SolutionCandidate } from "@/lib/types";

export const implementationLabels = {
  NOT_STARTED: "Ei aloitettu", IN_PROGRESS: "Työn alla", BLOCKED: "Estynyt",
  IN_REVIEW: "Katselmoinnissa", COMPLETED: "Valmis",
};
export const solutionTypeLabels = { TECHNICAL: "Tekninen ratkaisu", PROCESS: "Prosessimuutos", HYBRID: "Prosessi ja teknologia" };

export function ImplementationTracker({ id, candidate, locked, onSaved }: {
  id: string; candidate: SolutionCandidate; locked: boolean; onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson(`/api/projects/${id}/implementation`, {
        ...postJson({
          candidate_id: candidate.id, implementation_status: data.get("status"),
          implementation_notes: data.get("notes"), implementation_url: data.get("url"),
        }), method: "PATCH",
      }, z.unknown());
      await onSaved();
      setNotice(t("Ratkaisun eteneminen on päivitetty. Tuotoksen valmistuminen säilyy erillisenä tietona."));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Toteutustilan päivitys epäonnistui."));
    } finally { setBusy(false); }
  }
  return <section className="panel space-y-5">
    <div><p className="eyebrow">{t("Ratkaisun etenemisen seuranta")}</p><h2>{candidate.title}</h2>
      <p className="subtitle">{t("Seuraa selvityksen hyväksyntää, toimintatavan muutosta tai muuta jatkotyötä käsin. Valmis luonnos ei vielä osoita, että tavoiteltu hyöty on toteutunut.")}</p></div>
    <div className="flex flex-wrap gap-2"><span className="system-tag">{t(solutionTypeLabels[candidate.solution_type])}</span>
      <span className="status-badge">{t(implementationLabels[candidate.implementation_status])}</span></div>
    <form method="post" className="space-y-4" onSubmit={submit} key={`${candidate.id}/${candidate.implementation_updated_at}`}>
      <label>{t("Ratkaisun tila")}<select name="status" defaultValue={candidate.implementation_status} disabled={locked || busy}>
        {Object.entries(implementationLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select></label>
      <label>{t("Linkki tuotokseen tai jatkotyöhön")}<input name="url" type="url" defaultValue={candidate.implementation_url ?? ""} placeholder="https://..." maxLength={1000} disabled={locked || busy} /></label>
      <label>{t("Edistyminen, esteet ja seuraavat askeleet")}<textarea name="notes" rows={4} maxLength={10000} defaultValue={candidate.implementation_notes} disabled={locked || busy} /></label>
      <button className="button-primary" disabled={locked || busy}>{busy ? t("Tallennetaan…") : t("Päivitä ratkaisun tila")}</button>
      <p className="field-hint">{locked ? t("Agentit päivittävät tilaa ketjun aikana. Manuaalinen katselmointi onnistuu sen jälkeen.") : t("Manuaalinen seuranta: GitHub-linkki ei vielä synkronoi issueiden tai PR:ien tilaa automaattisesti.")}</p>
    </form>
    {candidate.implementation_url && <a className="button-secondary" href={candidate.implementation_url} target="_blank" rel="noopener noreferrer">{t("Avaa tuotos tai jatkotyö ↗")}</a>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
