"use client";

import { useI18n } from "@/components/i18n";


import { useEffect, useId, useState } from "react";

export function MermaidDiagram({ chart }: { chart: string }) {
  const { t } = useI18n();

  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", suppressErrorRendering: true });
        const result = await mermaid.render(`chart${id}`, chart);
        if (!cancelled) { setSvg(result.svg); setError(null); }
      } catch (error) {
        if (!cancelled) {
          setSvg("");
          setError(error instanceof Error ? error.message : t("Prosessikaavion renderöinti epäonnistui."));
        }
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [chart, id, t]);

  return <div>
    {error && <p className="error-message" role="alert">{t("Kaavion renderöinti epäonnistui:")} {error}</p>}
    {svg && <div className="diagram" role="img" aria-label={t("Nykytilan prosessikaavio")} dangerouslySetInnerHTML={{ __html: svg }} />}
    {!svg && !error && <p className="subtitle" role="status">{t("Piirretään prosessikaaviota…")}</p>}
    <details className="mt-4"><summary>{t("Mermaid-lähdekoodi")}</summary><pre className="agent-log">{chart}</pre></details>
  </div>;
}
