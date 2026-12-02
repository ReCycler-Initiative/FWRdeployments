"use client";

import { useI18n } from "@/components/i18n";


export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useI18n();

  return <main className="shell"><section className="panel">
    <h1>{t("Työtilaa ei voitu ladata")}</h1>
    <p className="subtitle">{t("Tarkista tietokantapalvelun tila ja palvelinlokit. Tallennetut tiedot säilyvät.")}</p>
    <button className="button-primary mt-5" onClick={reset}>{t("Yritä uudelleen")}</button>
  </section></main>;
}
