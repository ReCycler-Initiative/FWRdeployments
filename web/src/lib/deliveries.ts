import { writtenOutputModeSchema, type DeliveryMode, type WrittenOutputMode } from "./types";

export const writtenOutputs: Record<WrittenOutputMode, { title: string; action: string; filename: string }> = {
  REPORT: { title: "Selvitys", action: "Hyväksy ja laadi selvitys", filename: "report.md" },
  RECOMMENDATION: { title: "Suositus päätöksenteon tueksi", action: "Hyväksy ja laadi suositus", filename: "recommendation.md" },
  PROCESS: { title: "Toimintamalli tai prosessikuvaus", action: "Hyväksy ja laadi toimintamalli", filename: "operating-model.md" },
  GUIDE: { title: "Ohjeistus tai koulutusmateriaali", action: "Hyväksy ja laadi ohjeistus", filename: "guide.md" },
  EXPERIMENT: { title: "Kokeilusuunnitelma", action: "Hyväksy ja laadi kokeilusuunnitelma", filename: "experiment-plan.md" },
};

export function isWrittenOutput(mode: DeliveryMode): mode is WrittenOutputMode {
  return writtenOutputModeSchema.safeParse(mode).success;
}
