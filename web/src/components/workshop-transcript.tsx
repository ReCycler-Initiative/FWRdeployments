"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import type { Session, WorkshopTranscriptRecord } from "@/lib/types";
import { useI18n } from "./i18n";

export function WorkshopTranscript({ id, workshop, enabled, canAnalyze, onSaved }: {
  id: string; workshop: Session; enabled: boolean; canAnalyze: boolean; onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WorkshopTranscriptRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/projects/${id}`;
  const url = `${base}/workshops/${workshop.id}/transcripts`;
  const selected = workshop.transcripts.find((part) => part.id === editing);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      await onSaved();
      setEditing(null); setRemoving(null); setNotice(t(message));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("Transkription käsittely epäonnistui.");
      setError(t(message));
      try { await onSaved(); }
      catch (refreshError) { setError(`${message} ${refreshError instanceof Error ? refreshError.message : t("Työtilan päivitys epäonnistui.")}`); }
    } finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    void run(() => requestJson(selected ? `${url}/${selected.id}` : url, { method: selected ? "PUT" : "POST", body }, z.unknown()),
      "Transkriptio tallennettu työpajalle. Käynnistä analyysi erikseen päivittääksesi ratkaisuehdotukset.");
  }

  return <div className="mt-4 border-t border-slate-100 pt-4" role="group" aria-label={`${t("Transkriptio:")} ${workshop.title}`}>
    <p className="text-xs font-semibold">{workshop.transcripts.length
      ? `${t("Tallennetut transkriptiot:")} ${workshop.transcripts.length}`
      : t("Työpajalle ei ole tallennettu transkriptiota.")}</p>
    {workshop.transcripts.map((part) => <div key={part.id} className="mt-3 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold break-words">{part.title}</p>
      <p className="field-hint break-words">{part.filename}</p>
      <details className="mt-2"><summary>{t("Näytä transkriptio")}</summary>
        <textarea className="mt-3" readOnly rows={6} value={part.content} aria-label={`${t("Tallennettu transkriptio:")} ${part.title}`} /></details>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="button-secondary" disabled={!enabled || busy} aria-label={`${t("Korvaa transkriptio")}: ${part.title}`}
          onClick={() => { setEditing(part.id); setRemoving(null); }}>{t("Korvaa transkriptio")}</button>
        <button className="button-secondary" disabled={!enabled || busy} aria-label={`${t("Poista transkriptio")}: ${part.title}`}
          onClick={() => { setRemoving(part); setEditing(null); }}>{t("Poista transkriptio")}</button>
      </div>
    </div>)}
    {workshop.transcripts.length > 1 && <p className="notice mt-3">{t("Analyysi käsittelee kaikki tämän työpajan transkriptiot yhdessä. Aikaleimat ovat transkriptiokohtaisia. Useita transkriptioita ei kohdisteta yhden videon ääni- tai ilmesignaaleihin.")}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button className="button-secondary" disabled={!enabled || busy} onClick={() => { setEditing(editing === "add" ? null : "add"); setRemoving(null); }}>
        {t("Lisää transkriptio")}</button>
      {(workshop.video_path || workshop.transcripts.length > 0) && <button className="button-secondary" disabled={!canAnalyze || busy}
        onClick={() => void run(() => requestJson(`${base}/analyze`, postJson({ session_id: workshop.id }), z.unknown()), "Työpajan analyysi on käynnistetty.")}>
        {t("Analysoi työpaja")}</button>}
    </div>
    {editing && <form key={editing} className="mt-4 space-y-3" onSubmit={save}>
      {selected && <p className="notice">{t("Korvataan vain valittu transkriptio:")} {selected.title}. {t("Muut transkriptiot säilyvät.")}</p>}
      <p className="field-hint">{t("VTT/TXT, enintään 2 Mt. Tallennus ei käynnistä API-kutsuja. Aineiston muutos mitätöi aiemman analyysin ja ratkaisuehdotusten ajantasaisuuden; toimitukset säilyvät.")}</p>
      <label>{t("Transkription nimi")}<input name="title" maxLength={200} defaultValue={selected?.title ?? ""} placeholder={t("Tyhjä nimi käyttää tiedostonimeä")} disabled={busy || !enabled} /></label>
      <label>{t("Työpajan transkriptiotiedosto")}<input type="file" name="file" accept=".vtt,.txt" required disabled={busy || !enabled} /></label>
      <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy || !enabled}>{busy ? t("Tallennetaan…") : t("Tallenna transkriptio")}</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing(null)}>{t("Peruuta")}</button></div>
    </form>}
    {removing && <div className="notice mt-4" role="alert">
      <p className="font-semibold">{removing.title}</p>
      <p>{t("Poistetaanko tämä transkriptio? Muut transkriptiot sekä työpajan nimi, runko, kokouslinkki ja video säilyvät. Analyysi mitätöidään ja ratkaisuehdotukset merkitään vanhentuneiksi. Toimitustiedostoja ei poisteta.")}</p>
      <p className="mt-2">{t("Aiemmat toimitukset ja jo ladatut kopiot voivat yhä sisältää vanhaa aineistoa.")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="button-secondary" disabled={busy} onClick={() => setRemoving(null)}>{t("Peruuta")}</button>
        <button className="button-primary" disabled={!enabled || busy}
          onClick={() => void run(() => requestJson(`${url}/${removing.id}`, { method: "DELETE" }, z.unknown()), "Transkriptio on poistettu. Voit lisätä työpajalle oikean tiedoston.")}>{t("Vahvista poisto")}</button>
      </div>
    </div>}
    {!workshop.transcripts.length && workshop.transcript_vtt && <details className="mt-3"><summary>{t("Videosta generoitu litterointi")}</summary>
      <textarea className="mt-3" readOnly rows={6} value={workshop.transcript_vtt} aria-label={`${t("Tallennettu transkriptio:")} ${workshop.title}`} /></details>}
    {error && <p className="error-message mt-3" role="alert">{error}</p>}
    {workshop.pain_points_json && "error" in workshop.pain_points_json && <p className="error-message mt-3" role="alert">
      {t("Analyysi epäonnistui:")} {workshop.pain_points_json.error}</p>}
    {notice && <p className="notice mt-3" role="status">{notice}</p>}
  </div>;
}
