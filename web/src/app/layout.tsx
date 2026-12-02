import type { Metadata } from "next";
import Link from "next/link";
import { getI18n } from "@/lib/locale";
import { LanguageSwitcher, LocaleProvider } from "@/components/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "FRWDeployments",
  description: "From discovery to delivery – the FRWDeployments workspace",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, t } = await getI18n();
  return (
    <html
      lang={locale}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale}>
        <nav className="topbar" aria-label={t("Päänavigaatio")}>
          <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">F</span>FRW<span>Deployments</span></Link>
          <Link href="/" className="nav-link">{t("Projektit")}</Link>
          <span className="environment-tag">{t("MVP · Paikallinen työtila")}</span>
          <LanguageSwitcher />
        </nav>
        {children}
        <footer className="shell footer">{t("FRWDeployments · Ihminen päättää, tuotos tukee ratkaisua.")}</footer>
        </LocaleProvider>
      </body>
    </html>
  );
}
