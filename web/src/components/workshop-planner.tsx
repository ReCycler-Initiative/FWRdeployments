"use client";

import { useBrowserTimeZone, useI18n } from "@/components/i18n";


import { useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import type { GenerationMode, Session } from "@/lib/types";
import { GenerationNotice } from "./ai-notice";
import { WorkshopTranscript } from "./workshop-transcript";

export function AgendaContent({ text }: { text: string }) {

  return <div className="agenda-layout">{text.split("\n").filter((line) => line.trim()).map((line, index) => {
    if (line.startsWith("#")) return <h3 key={index} className="text-base">{line.replace(/^#+\s*/, "")}</h3>;
    const time = line.match(/^(\d{2}[.:]\d{2}[–-]\d{2}[.:]\d{2})\s+(.*)$/);
    if (time) return <div className="agenda-slot" key={index}><time>{time[1]}</time><p>{time[2]}</p></div>;
    return <p className={/SIMULOITU|SIMULATED/.test(line) ? "mock-caption" : "text-sm leading-6 text-slate-500"} key={index}>{line}</p>;
  })}</div>;
}

export function WorkshopPlanner({ id, workshops, enabled, mode, transcriptEnabled, canAnalyze, onSaved }: {
  id: string; workshops: Session[]; enabled: boolean; mode: GenerationMode | null;
  transcriptEnabled: boolean; canAnalyze: boolean; onSaved: () => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const timeZone = useBrowserTimeZone();

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/projects/${id}`;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("new"); setError(null);
    try {
      const date = String(data.get("scheduled_at") ?? "");
      const result = await requestJson(`${base}/workshops`, postJson({
        title: data.get("title"), notes: data.get("notes"),
        scheduled_at: date ? new Date(date).toISOString() : null, meeting_url: data.get("meeting_url"),
      }), z.object({ id: z.string() }));
      await onSaved(); setOpenId(result.id); setCreating(false); setNotice(t("Työpaja on suunniteltu. Generoi sille oma runko."));
    } catch (error) { setError(error instanceof Error ? error.message : t("Työpajan luonti epäonnistui.")); }
    finally { setBusy(null); }
  }
  async function agenda(sessionId: string) {
    setBusy(sessionId); setError(null); setNotice(null);
    try {
      await requestJson(`${base}/agenda`, postJson({ session_id: sessionId }), z.object({ agenda: z.string() }));
      await onSaved(); setOpenId(sessionId); setNotice(t("Työpajakohtainen runko ja kysymykset on tallennettu."));
    } catch (error) { setError(error instanceof Error ? error.message : t("Rungon generointi epäonnistui.")); }
    finally { setBusy(null); }
  }
  return <section className="panel workshop-planner">
    <div className="flex items-start justify-between gap-4">
      <div><p className="eyebrow">{t("Fasilitaattorin työpöytä")}</p><h2>{t("Työpajat ja omat työpajarungot")}</h2>
        <p className="subtitle">{t("Yksi projekti, useita keskusteluja. Jokaisella työpajalla on oma tavoite ja runko.")}</p></div>
      <span className="count-label">{workshops.length}</span>
    </div>
    <div className="notetaker-roadmap mt-5"><span className="roadmap-icon" aria-hidden="true">◉</span>
      <div><p className="text-sm font-semibold">FRWDeployment Notetaker <span className="future-badge">{t("Tulossa")}</span></p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{t("Tulevaisuudessa notetaker liittyy sovittuihin työpajoihin. MVP:ssä kokouslinkki on vain suunnittelutieto: tallenna palaveri itse ja lisää aineisto valitulle työpajalle Työpaja-vaiheessa.")}</p></div>
    </div>
    <button className="button-primary mt-5" disabled={!enabled || !!busy} onClick={() => setCreating(!creating)}>
      {creating ? t("Sulje uuden työpajan lomake") : t("+ Suunnittele työpaja")}</button>
    {creating && <form method="post" className="workshop-create mt-5 space-y-4" onSubmit={create}>
      <label>{t("Työpajan nimi")}<input name="title" required maxLength={200} placeholder={`${t("Työpaja")} ${workshops.length + 1} – ${t("nykytilan kartoitus")}`} /></label>
      <label>{t("Työpajan tavoite ja kysymykset")}<textarea name="notes" rows={3} maxLength={10000} placeholder={t("Mitä juuri tässä työpajassa selvitetään? Ketkä osallistuvat?")} /></label>
      <label>{t("Ajankohta (valinnainen)")}<input name="scheduled_at" type="datetime-local" /></label>
      <label>{t("Kokouslinkki (valinnainen)")}<input name="meeting_url" type="url" maxLength={1000} placeholder="https://teams.microsoft.com/..." /></label>
      <button className="button-primary" disabled={!!busy}>{busy === "new" ? t("Tallennetaan…") : t("Tallenna työpaja")}</button>
    </form>}
    {error && <p className="error-message mt-4" role="alert">{error}</p>}
    {notice && <p className="notice mt-4" role="status">{notice}</p>}
    <div className="workshop-stack">
      {workshops.length === 0 && <div className="workshop-empty"><p className="text-sm font-semibold">{t("Hyvä työpaja alkaa oikeista kysymyksistä.")}</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">{t("Suunnittele ensimmäinen keskustelu. Demotilassa runko on esimerkki; aineistopohjainen AI-runko edellyttää OpenAI API:n käyttöönottoa.")}</p></div>}
      {[...workshops].reverse().map((workshop, index) => <article className={`workshop-card ${openId === workshop.id ? "workshop-card-open" : ""}`} key={workshop.id}>
        <div className="flex items-start gap-3"><span className="workshop-index">{String(index + 1).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1"><h3>{workshop.title}</h3>
            <p className="mt-1 text-xs text-slate-500">{workshop.scheduled_at
              ? new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(workshop.scheduled_at)) : t("Ajankohta sovitaan")}
              {" · "}{workshop.processed_at ? t("Analysoitu") : workshop.video_path || workshop.transcripts.length ? t("Aineisto lisätty") : workshop.agenda ? t("Runko valmis") : t("Suunnittelussa")}</p>
          </div></div>
        {workshop.notes && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{workshop.notes}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {!workshop.video_path && !workshop.transcripts.length && <button className="button-secondary" disabled={!enabled || !!busy} onClick={() => void agenda(workshop.id)}>
            {busy === workshop.id ? t("Generoidaan…") : mode === "mock" ? t("Generoi esimerkkirunko") : workshop.agenda ? t("Generoi runko uudelleen") : t("Generoi tämän työpajan runko")}</button>}
          {workshop.agenda && <button className="button-secondary" onClick={() => setOpenId(openId === workshop.id ? null : workshop.id)}>
            {openId === workshop.id ? t("Sulje työpajarunko") : t("Avaa työpajarunko")}</button>}
          {workshop.meeting_url && <a className="button-secondary" href={workshop.meeting_url} target="_blank" rel="noopener noreferrer">{t("Kokouslinkki ↗")}</a>}
        </div>
        {workshop.agenda && <GenerationNotice mode={workshop.agenda_mode} />}
        {openId === workshop.id && workshop.agenda && <div className="mt-5 border-t border-slate-100 pt-5"><AgendaContent text={workshop.agenda} /></div>}
        <WorkshopTranscript id={id} workshop={workshop} enabled={transcriptEnabled && !busy} canAnalyze={canAnalyze && !busy} onSaved={onSaved} />
      </article>)}
    </div>
  </section>;
}
