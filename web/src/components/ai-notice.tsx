"use client";

import { useI18n } from "./i18n";
import type { AiCapabilities, GenerationMode } from "@/lib/types";

export function AiModeNotice({ ai }: { ai: AiCapabilities }) {
  const { t } = useI18n();
  if (ai.status === "unavailable") {
    return <p className="error-message mb-5" role="alert">{t("AI-palvelun tilaa ei voitu tarkistaa. Tarkista workerin yhteys ja päivitä sivu. Tulosten alkuperämerkinnät säilyvät erillään palvelun tilasta.")}</p>;
  }
  return <aside className={`ai-mode-notice mb-5 ${ai.mode === "mock" ? "demo-notice" : ""}`} aria-label={t("AI-palvelun tila")}>
    <strong>{ai.mode === "mock" ? t("Demotila – OpenAI API ei ole käytössä")
      : ai.openai_configured ? t("OpenAI API on määritetty – tuotokset vaativat katselmoinnin")
      : t("AI-generointi ei ole käytettävissä – OpenAI API -avain puuttuu")}</strong>
    <p>{ai.mode === "mock"
      ? t("Tässä tilassa generoitavat työpajarungot, kipupistekartat, prosessikaaviot, ratkaisuehdotukset ja agenttituotokset ovat simuloituja esimerkkejä, eivät aineistopohjaisia AI-tuloksia.")
      : t("AI-palvelun asetukset eivät takaa onnistunutta analyysiä. Tarkista aina tulosten lähteet ja johtopäätökset.")}</p>
    {(ai.mode === "mock" || !ai.openai_configured) && <p>{t("Aineistopohjainen generointi edellyttää ylläpitäjältä OPENAI_API_KEY-avainta, MOCK_AI=false-asetusta ja worker-kontin uudelleenluontia. Älä syötä avainta aineistoihin. Vanhat esimerkkitulokset eivät muutu automaattisesti.")}</p>}
    <p>{t("Prompttien ja suunnitelmien paikallinen koostaminen toimii ilman API-avainta. Demoaineistosta tehty vienti on silti esimerkki.")}</p>
  </aside>;
}

export function GenerationNotice({ mode }: { mode: GenerationMode | null }) {
  const { t } = useI18n();
  return <p className={`generation-notice ${mode === "mock" ? "demo-notice" : ""}`}>
    {mode === "mock"
      ? t("Esimerkkisisältö – simuloitu, ei aineistopohjainen AI-tulos. API:n käyttöönotto ei muuta tätä aiemmin tuotettua tulosta.")
      : mode === "ai" ? t("AI-generoitu luonnos – tarkista lähteet, lainaukset ja johtopäätökset. Ei valmis tai testattu toteutus.")
      : t("Alkuperää ei ole tallennettu – tätä tulosta ei ole varmennettu aineistopohjaiseksi AI-tuotokseksi.")}
  </p>;
}
