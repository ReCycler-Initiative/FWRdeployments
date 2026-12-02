import "server-only";
import { cookies } from "next/headers";
import { translate, type Locale } from "./translations";

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get("frw_locale")?.value === "en" ? "en" : "fi";
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: (text: string) => translate(locale, text) };
}
