"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import { translate, type Locale } from "@/lib/translations";

const LanguageContext = createContext<Locale>("fi");
const subscribeTimeZone = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimeZone = () => "UTC";

export function useBrowserTimeZone() {
  // Match server markup during hydration before showing browser-local times.
  return useSyncExternalStore(subscribeTimeZone, browserTimeZone, serverTimeZone);
}

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LanguageContext value={locale}>{children}</LanguageContext>;
}

export function useI18n() {
  const locale = useContext(LanguageContext);
  const t = useCallback((text: string) => translate(locale, text), [locale]);
  return { locale, t };
}

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function change(next: Locale) {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/locale", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }),
      });
      if (!response.ok) throw new Error("Language preference could not be saved");
      window.location.reload();
    } catch (error) {
      console.error("Language switch failed", error); setError(true); setBusy(false);
    }
  }
  return <div className="language-control">
    <div className="language-switch" role="group" aria-label={t("Kieli")}>
      {(["fi", "en"] as const).map((value) => <button key={value} type="button" lang={value}
        aria-pressed={locale === value} disabled={busy || locale === value}
        onClick={() => void change(value)}>{value.toUpperCase()}</button>)}
    </div>
    {error && <span role="alert" className="text-xs text-red-700">{locale === "en" ? "Language switch failed." : "Kielenvaihto epäonnistui."}</span>}
  </div>;
}
