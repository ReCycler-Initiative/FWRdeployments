"use client";

import { useI18n } from "./i18n";
import type { ProjectStatus } from "@/lib/types";

export const statusLabels: Record<ProjectStatus, string> = {
  PREPARATION: "Valmistelu",
  WORKSHOP_UPLOADED: "Työpaja-aineisto lisätty",
  CANDIDATES_READY: "Ratkaisut arvioitavana",
  BUILDING: "Toteutus käynnissä",
  READY_FOR_REVIEW: "Valmis katselmointiin",
};

export const statusStages: Record<ProjectStatus, number> = {
  PREPARATION: 0,
  WORKSHOP_UPLOADED: 1,
  CANDIDATES_READY: 2,
  BUILDING: 3,
  READY_FOR_REVIEW: 3,
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useI18n();
  return <span className={`status-badge status-${status.toLowerCase()}`} title={status}>
    <span aria-hidden="true" className="status-dot" />{t(statusLabels[status])}
  </span>;
}
