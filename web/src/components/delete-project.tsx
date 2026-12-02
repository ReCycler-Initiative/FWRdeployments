"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { postJson, requestJson } from "@/lib/client-api";
import { useI18n } from "./i18n";

export function DeleteProject({ id, title, disabled }: { id: string; title: string; disabled: boolean }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  async function remove() {
    setDeleting(true); setError(null);
    try {
      await requestJson(`/api/projects/${id}`, {
        ...postJson({ confirmed: true }), method: "DELETE",
      }, z.object({ deleted: z.literal(true) }));
      // Fetch a fresh dashboard instead of reusing a cached card for the deleted project.
      window.location.replace("/");
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Projektin poistaminen epäonnistui."));
      setDeleting(false);
    }
  }

  return <>
    <button className="button-secondary button-danger" disabled={disabled || deleting}
      onClick={() => { setError(null); setOpen(true); }}>{t("Poista projekti")}</button>
    <dialog ref={dialog} className="panel selection-dialog" aria-labelledby="project-delete-title"
      onCancel={(event) => { if (deleting) event.preventDefault(); else setOpen(false); }}>
      <div className="space-y-5">
        <h2 id="project-delete-title">{t("Oletko varma, että haluat poistaa projektin?")}</h2>
        <p className="break-words font-semibold">{title}</p>
        <p className="error-message">{t("Projekti, työpajat, transkriptiot, taustamateriaalit, ratkaisuehdotukset ja kaikki palveluun tallennetut toimitustiedostot poistetaan pysyvästi. Toimintoa ei voi perua.")}</p>
        <p className="field-hint">{t("Jo ladattuja kopioita tai ulkoisten palvelujen, kuten GitHubin, tietoja ei poisteta.")}</p>
        {disabled && <p className="notice">{t("Poisto ei ole käytettävissä käsittelyn aikana.")}</p>}
        {error && <p className="error-message" role="alert">{t(error)}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="button-secondary" disabled={deleting} onClick={() => setOpen(false)}>{t("Peruuta")}</button>
          <button type="button" className="button-primary button-danger" disabled={disabled || deleting}
            onClick={() => void remove()}>{deleting ? t("Poistetaan…") : t("Kyllä, poista projekti pysyvästi")}</button>
        </div>
      </div>
    </dialog>
  </>;
}
