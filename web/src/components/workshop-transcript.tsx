"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import type { Session } from "@/lib/types";
import { useI18n } from "./i18n";

export function WorkshopTranscript({ id, workshop, enabled, canAnalyze, onSaved }: {
  id: string; workshop: Session; enabled: boolean; canAnalyze: boolean; onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/projects/${id}`;
  const url = `${base}/workshops/${workshop.id}/transcript`;
  const hasTranscript = !!(workshop.transcript_path || workshop.transcript_vtt);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      await onSaved();
      setEditing(false); setRemoving(false); setNotice(t(message));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("Transkription käsittely epäonnistui.");
      setError(message);
      try { await onSaved(); }
      catch (refreshError) { setError(`${message} ${refreshError instanceof Error ? refreshError.message : t("Työtilan päivitys epäonnistui.")}`); }
    } finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    void run(() => requestJson(url, { method: "POST", body }, z.unknown()),
      "Transkriptio tallennettu työpajalle. Käynnistä analyysi erikseen päivittääksesi ratkaisuehdotukset.");
  }

  return <div className="mt-4 border-t border-slate-100 pt-4" role="group" aria-label={`${t("Transkriptio:")} ${workshop.title}`}>
    <p className="text-xs font-semibold">{hasTranscript
      ? `${t("Tallennettu transkriptio:")} ${workshop.transcript_filename ?? t("Työpajan litterointi")}`
      : t("Työpajalle ei ole tallennettu transkriptiota.")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className="button-secondary" disabled={!enabled || busy} onClick={() => { setEditing(!editing); setRemoving(false); }}>
        {hasTranscript ? t("Vaihda transkriptio") : t("Lisää transkriptio")}</button>
      {hasTranscript && <button className="button-secondary" disabled={!enabled || busy}
        onClick={() => { setRemoving(true); setEditing(false); }}>{t("Poista transkriptio")}</button>}
      {(workshop.video_path || workshop.transcript_path) && <button className="button-secondary" disabled={!canAnalyze || busy}
        onClick={() => void run(() => requestJson(`${base}/analyze`, postJson({ session_id: workshop.id }), z.unknown()), "Työpajan analyysi on käynnistetty.")}>
        {t("Analysoi työpaja")}</button>}
    </div>
    {editing && <form className="mt-4 space-y-3" onSubmit={save}>
      <p className="field-hint">{t("VTT/TXT, enintään 2 Mt. Tallennus ei käynnistä API-kutsuja. Aineiston muutos mitätöi aiemman analyysin ja ratkaisuehdotusten ajantasaisuuden; toimitukset säilyvät.")}</p>
      <label>{t("Työpajan transkriptiotiedosto")}<input type="file" name="file" accept=".vtt,.txt" required disabled={busy || !enabled} /></label>
      <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy || !enabled}>{busy ? t("Tallennetaan…") : t("Tallenna transkriptio")}</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing(false)}>{t("Peruuta")}</button></div>
    </form>}
    {removing && <div className="notice mt-4" role="alert">
      <p>{t("Poistetaanko transkriptio? Työpajan nimi, runko, kokouslinkki ja mahdollinen video säilyvät. Aiempi analyysi poistuu ja ratkaisuehdotukset merkitään vanhentuneiksi. Toimitustiedostoja ei poisteta.")}</p>
      <p className="mt-2">{t("Aiemmat toimitukset ja jo ladatut kopiot voivat yhä sisältää vanhaa aineistoa.")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="button-secondary" disabled={busy} onClick={() => setRemoving(false)}>{t("Peruuta")}</button>
        <button className="button-primary" disabled={!enabled || busy}
          onClick={() => void run(() => requestJson(url, { method: "DELETE" }, z.unknown()), "Transkriptio on poistettu. Voit lisätä työpajalle oikean tiedoston.")}>{t("Vahvista poisto")}</button>
      </div>
    </div>}
    {workshop.transcript_vtt && <details className="mt-3"><summary>{t("Näytä transkriptio")}</summary>
      <textarea className="mt-3" readOnly rows={6} value={workshop.transcript_vtt} aria-label={`${t("Tallennettu transkriptio:")} ${workshop.title}`} /></details>}
    {error && <p className="error-message mt-3" role="alert">{error}</p>}
    {workshop.pain_points_json && "error" in workshop.pain_points_json && <p className="error-message mt-3" role="alert">
      {t("Analyysi epäonnistui:")} {workshop.pain_points_json.error}</p>}
    {notice && <p className="notice mt-3" role="status">{notice}</p>}
  </div>;
}
