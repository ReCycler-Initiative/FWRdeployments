"use client";

import { useI18n } from "@/components/i18n";


import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { postJson, requestJson } from "@/lib/client-api";
import { projectSchema } from "@/lib/types";

export function ProjectForm() {
  const { t, locale } = useI18n();

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const project = await requestJson("/api/projects", postJson({
        title: data.get("title"),
        language: data.get("language"),
        description: data.get("description"),
        target_systems: String(data.get("systems") ?? "").split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      }), projectSchema);
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Projektin luonti epäonnistui."));
      setBusy(false);
    }
  }

  return <form method="post" onSubmit={submit} className="panel space-y-5">
    <div><p className="eyebrow">{t("Uusi työtila")}</p><h2>{t("Luo uusi FRWDeployments-projekti")}</h2></div>
    <label>{t("Projektin otsikko")} <input name="title" required maxLength={200} placeholder={t("Esim. asiakaspalautteiden käsittelyn tehostaminen")} />
    </label>
    <label>{t("Projektin sisältökieli")}<select name="language" defaultValue={locale}>
      <option value="fi">Suomi</option><option value="en">English</option>
    </select><span className="field-hint">{t("Uudet rungot, analyysit ja vientipromptit tehdään tällä kielellä. Lähdeaineisto säilyy alkuperäisenä.")}</span></label>
    <label>{t("Tavoitekuvaus")} <textarea name="description" required maxLength={10000} rows={4} placeholder={t("Mikä ongelma ratkaistaan ja miltä onnistuminen näyttää?")} />
    </label>
    <label>{t("Nykyiset järjestelmät")} <textarea name="systems" rows={2} placeholder={t("Esim. Teams, Excel, CRM")} />
      <span className="field-hint">{t("Erottele järjestelmät pilkuilla tai rivinvaihdoilla.")}</span>
    </label>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="button-primary w-full" disabled={busy} type="submit">
      {busy ? t("Luodaan projektia…") : t("Luo projekti")}
    </button>
  </form>;
}
