import { getI18n } from "@/lib/locale";
import Link from "next/link";

export default async function NotFound() {
  const { t } = await getI18n();

  return <main className="shell"><section className="panel"><h1>{t("Projektia ei löytynyt")}</h1>
    <p className="subtitle">{t("Tarkista projektin osoite tai palaa projektien listaan.")}</p>
    <Link href="/" className="button-primary mt-5">{t("Kaikki projektit")}</Link>
  </section></main>;
}
