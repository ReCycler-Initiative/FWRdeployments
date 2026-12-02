import { getI18n } from "@/lib/locale";
import Link from "next/link";
import { listProjects } from "@/lib/db";
import { ProjectForm } from "@/components/project-form";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { t, locale } = await getI18n();

  const projects = await listProjects();
  return <main className="shell">
    <header className="page-heading">
      <div><p className="eyebrow">{t("Ongelmasta toteutukseen")}</p><h1>{t("Projektityötilat")}</h1>
        <p className="subtitle">{t("Valmistele työpaja. Arvioi ratkaisut. Käynnistä toteutus.")}</p></div>
      <span className="count-label">{projects.length}  {t("projektia")}</span>
    </header>
    <div className="dashboard-grid">
      <section aria-label={t("Projektit")} className="space-y-4">
        {projects.length === 0 && <div className="panel empty-state">
          <div className="empty-icon" aria-hidden="true">+</div>
          <h2>{t("Ensimmäinen ratkaisu alkaa tavoitteesta")}</h2>
          <p>{t("Luo projektityötila ja kokoa nykytilan taustamateriaalit.")}</p>
        </div>}
        {projects.map((project) => <Link key={project.id} href={`/projects/${project.id}`} className="panel project-card">
          <div className="flex items-start justify-between gap-3">
            <h2>{project.title}</h2><span aria-hidden="true">↗</span>
          </div>
          <p className="mt-3 line-clamp-3 text-sm text-slate-600">{project.description}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {project.target_systems.map((system, index) => <span className="system-tag" key={`${system}-${index}`}>{system}</span>)}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={project.status} />
            <time className="text-xs text-slate-500" dateTime={project.created_at}>
              {new Intl.DateTimeFormat(locale === "fi" ? "fi-FI" : "en-GB", { dateStyle: "medium" }).format(new Date(project.created_at))}
            </time>
          </div>
        </Link>)}
      </section>
      <ProjectForm />
    </div>
  </main>;
}
