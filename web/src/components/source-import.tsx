"use client";

import { useI18n } from "@/components/i18n";


import { useState, type FormEvent } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";

export function SourceImport({ id, enabled, onSaved }: {
  id: string; enabled: boolean; onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();

  const [mode, setMode] = useState<"file" | "github">("file");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError(null); setNotice(null);
    try {
      const options = mode === "file" ? { method: "POST", body: data } : postJson({
        url: data.get("url"), ref: data.get("ref") || undefined, token: data.get("token") || undefined,
      });
      const tokenField = form.querySelector<HTMLInputElement>('input[name="token"]');
      if (tokenField) tokenField.value = "";
      await requestJson(`/api/projects/${id}/context/${mode}`, options, z.unknown());
      await onSaved();
      form.reset();
      setNotice(t("Lähde on tuotu. Generoi päivitetty työpajarunko tai jatka seuraavaan työpajaan."));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Lähteen tuonti epäonnistui."));
    } finally { setBusy(false); }
  }

  return <section className="panel space-y-5">
    <div><p className="eyebrow">{t("Dokumentit ja repositoriot")}</p><h2>{t("Tuo taustamateriaalia lähteistä")}</h2></div>
    <div className="flex gap-2" aria-label={t("Lähteen tyyppi")}>
      <button className={mode === "file" ? "button-primary" : "button-secondary"} disabled={busy} onClick={() => setMode("file")}>{t("Tiedostot")}</button>
      <button className={mode === "github" ? "button-primary" : "button-secondary"} disabled={busy} onClick={() => setMode("github")}>{t("GitHub-repositorio")}</button>
    </div>
    <form key={mode} method="post" onSubmit={submit} className="space-y-4">
      {mode === "file" ? <>
        <label>{t("Taustamateriaalitiedosto")}<input name="file" type="file" accept=".txt,.md,.csv,.json,.vtt,.pdf,.docx" required disabled={!enabled || busy} /></label>
        <p className="field-hint">{t("TXT, Markdown, CSV, JSON, VTT, PDF tai DOCX · enintään 10 Mt / 100 000 merkkiä. Skannattu PDF tarvitsee OCR:n ennen tuontia.")}</p>
      </> : <>
        <label>{t("GitHub-repositorion osoite")}<input name="url" type="url" placeholder="https://github.com/organisaatio/repo" required maxLength={300} disabled={!enabled || busy} /></label>
        <label>{t("Haara tai commit (valinnainen)")}<input name="ref" placeholder={t("Oletushaara, ellei määritetty")} maxLength={200} disabled={!enabled || busy} /></label>
        <label>{t("GitHub access token (yksityinen repo)")}<input name="token" type="password" autoComplete="off" maxLength={1000} placeholder="Fine-grained token: Contents read-only" disabled={!enabled || busy} /></label>
        <p className="field-hint">{t("Token lähetetään vain oman palvelimen kautta GitHub API:lle. Sitä ei tallenneta kantaan, selaimeen, prompteihin tai lokeihin. Repo tuodaan commit-snapshotina: enintään 20 tekstitiedostoa / 190 000 merkkiä, ei jatkuvaa synkronointia.")}</p>
      </>}
      <button className="button-primary" disabled={!enabled || busy}>{busy ? t("Tuodaan lähdettä…") : mode === "file" ? t("Tuo tiedosto") : t("Tuo GitHub-lähde")}</button>
      {!enabled && <p className="field-hint">{t("Lähteiden muokkaus on lukittu analyysin ja toteutuksen ajaksi.")}</p>}
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
