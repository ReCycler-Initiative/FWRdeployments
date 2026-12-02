"use client";

import { useI18n } from "@/components/i18n";


import { useState } from "react";
import { z } from "zod";
import { requestJson } from "@/lib/client-api";
import type { Artifact } from "@/lib/types";

export function Artifacts({ id, files }: { id: string; files: Artifact[] }) {
  const { t } = useI18n();

  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = (file: string) => `/api/projects/${id}/artifacts?path=${encodeURIComponent(file)}`;

  async function show(file: string) {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const result = await requestJson(url(file), {}, z.object({ content: z.string() }));
      setPreview({ path: file, content: result.content });
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Esikatselu epäonnistui."));
    } finally { setBusy(false); }
  }

  return <section className="panel">
    <p className="eyebrow">{t("Toteutuksen tuotokset")}</p><h2>{t("Artefaktit ja esikatselu")}</h2>
    <p className="subtitle mb-5">{t("Generoitua koodia ei suoriteta automaattisesti. Katselmoi tiedostot ennen käyttöä.")}</p>
    {!files.length && <p className="notice">{t("Artefaktit ilmestyvät tähän agenttien valmistuessa.")}</p>}
    <div className="artifact-list">{files.map((file) => <div className="artifact-row" key={file.path}>
      <button type="button" onClick={() => void show(file.path)} disabled={busy}>{file.path}<span className="ml-2 text-slate-400">{Math.ceil(file.size / 1024)}  {t("kt")}</span></button>
      <a href={`${url(file.path)}&download=1`}>{t("Lataa")}</a>
    </div>)}</div>
    {busy && <p className="subtitle" role="status">{t("Ladataan esikatselua…")}</p>}
    {error && <p className="error-message mt-4" role="alert">{error}</p>}
    {preview && <div className="mt-5"><h3>{preview.path}</h3>
      {/\.html?$/i.test(preview.path) && <div className="mt-4">
        <p className="field-hint mb-3">{t("Staattinen prototyyppicanvas: ei JavaScriptiä, verkkoyhteyksiä tai lomakkeiden lähetyksiä.")}</p>
        <iframe title={t("Ratkaisuprototyypin staattinen katselmointi")} sandbox="" referrerPolicy="no-referrer"
          className="prototype-preview"
          srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none';">${preview.content}`} />
      </div>}
      <details className="mt-3" open={!/\.html?$/i.test(preview.path)}><summary>{t("Tiedoston lähdekoodi")}</summary><pre className="agent-log">{preview.content}</pre></details>
    </div>}
  </section>;
}
