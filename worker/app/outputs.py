import json

from app.config import Settings
from app.models import GeneratedOutput, OutputSection, OutputType, WrittenOutput
from app.providers import structured


OUTPUTS = {
    "REPORT": ("Selvitys", "Report",
               "Define the investigation question, summarize supplied evidence, identify gaps and propose further information gathering."),
    "RECOMMENDATION": ("Suositus päätöksenteon tueksi", "Decision recommendation",
                       "Compare the supplied alternatives and doing nothing, define decision criteria, explain the recommendation and its conditions."),
    "PROCESS": ("Toimintamalli tai prosessikuvaus", "Operating model or process description",
                "Describe triggers, steps, roles, handovers, exceptions and review measures using existing tools where possible."),
    "GUIDE": ("Ohjeistus tai koulutusmateriaali", "Guidance or training material",
              "Specify audience, learning goals, prerequisites, practical steps, examples and a comprehension checklist."),
    "EXPERIMENT": ("Kokeilusuunnitelma", "Experiment plan",
                   "Define a testable hypothesis, scope, baseline collection, measures, success and stop criteria, safeguards and a review decision."),
}


def sources_for(context: dict) -> list[dict]:
    project = context["project"]
    sources = [{"id": f"project:{project['id']}", "title": project["title"],
                "text": project.get("description") or project["title"]}]
    for document in context["documents"]:
        if document.get("content_text"):
            sources.append({
                "id": f"document:{document['id']}", "title": document["filename"],
                "text": document["content_text"], "url": document.get("source_url"),
                "revision": document.get("source_revision"),
            })
    for workshop in context["workshops"]:
        parts = workshop.get("transcripts") or []
        transcript = "" if parts else workshop.get("transcript_vtt") or ""
        if (str(workshop.get("video_path") or "").lower().endswith(".mp4")
                and not workshop.get("transcript_path") and workshop.get("analysis_mode") == "mock"):
            transcript = ""
        text = "\n\n".join(value for value in (workshop.get("notes"), transcript) if value)
        if text:
            sources.append({"id": f"workshop:{workshop['id']}", "title": workshop["title"], "text": text})
        for part in parts:
            sources.append({"id": f"transcript:{part['id']}", "title": f"{workshop['title']} / {part['title']}",
                            "text": part["content"]})
    return sources


async def generate_output(
    settings: Settings, context: dict, output_type: OutputType, refinement: str,
) -> GeneratedOutput:
    en = context["project"].get("language") == "en"

    def tr(fi: str, english: str) -> str:
        return english if en else fi

    candidate = context["candidate"]
    sources = sources_for(context)
    data = {
        "project": context["project"], "candidate": candidate,
        "alternatives": context["alternatives"], "sources": sources, "refinement": refinement,
        "decision": context.get("decision"),
    }
    if len(json.dumps(data, ensure_ascii=False, default=str)) > 200000:
        raise ValueError("Output source material exceeds 200000 characters; reduce the supplied material.")
    if settings.mock_ai:
        excerpts = "\n\n".join(
            f"[{source['id']}] {source['title']}\n"
            + "\n".join(f"> {line}" for line in source["text"][:1200].splitlines())
            + (tr("\n[Ote lyhennetty.]", "\n[Excerpt shortened.]") if len(source["text"]) > 1200 else "")
            for source in sources
        )
        proposals = {
            "REPORT": tr(
                "Selvitä tavoitteen nykytila, käytettävissä oleva näyttö ja puuttuvat tiedot. "
                "Sovi tiedonkeruusta, vastuista ja johtopäätösten katselmoinnista. Tämä ei ole valmis tutkimustulos.",
                "Investigate the current situation, available evidence and missing information. "
                "Agree on information gathering, ownership and review. This is not a completed research finding."),
            "RECOMMENDATION": tr(
                "Vertaa valittua ehdotusta muihin vaihtoehtoihin ja nykytilassa jatkamiseen. "
                "Sovi arviointiperusteet ja varmista hyödyt ennen päätöstä.",
                "Compare the selected proposal against alternatives and keeping the current approach. "
                "Agree on decision criteria and validate benefits before deciding.")
                + "\n\n" + "\n".join(f"- {item['title']}: {item.get('summary') or ''}"
                                     for item in context["alternatives"]),
            "PROCESS": tr(
                "1. Sovi työn käynnistävä tapahtuma ja vastuurooli.\n"
                "2. Kuvaa työvaiheet, luovutukset ja poikkeustilanteet nykyisillä välineillä.\n"
                "3. Nimeä hyväksyjä ja seuraa toimivuutta. Vastuuhenkilöt ovat vielä sopimatta.",
                "1. Agree on the trigger and accountable role.\n"
                "2. Describe steps, handovers and exceptions using existing tools.\n"
                "3. Assign a reviewer and monitor effectiveness. Actual owners are not yet agreed."),
            "GUIDE": tr(
                "1. Määrittele kohderyhmä ja oppimistavoite.\n2. Käy tavoitetilanne läpi käytännön esimerkillä.\n"
                "3. Harjoittele toimintatapa ja poikkeustilanteet.\n4. Tarkista ymmärrys ja sovi ohjeen ylläpidosta.",
                "1. Define the audience and learning objective.\n2. Walk through a practical example.\n"
                "3. Practice the approach and exception handling.\n4. Check understanding and assign guidance ownership."),
            "EXPERIMENT": tr(
                "Hypoteesi: valittu ehdotus edistää projektin tavoitetta.\n"
                "Kerää lähtötaso ennen kokeilua. Sovi rajaus, mittarit, onnistumisraja, keskeytysehdot ja vastuuhenkilö. "
                "Arvioi tulokset ennen laajentamista. Mittaustuloksia tai tavoitelukuja ei ole vielä varmennettu.",
                "Hypothesis: the selected proposal advances the project goal.\n"
                "Collect a baseline first. Agree on scope, measures, success threshold, stop criteria and owner. "
                "Review results before expanding. No measured results or target values have been verified."),
        }
        draft = WrittenOutput(sections=[
            OutputSection(heading=tr("Tavoite ja rajaus", "Goal and scope"),
                          body=f"{context['project']['title']}\n{candidate['title']}\n{candidate.get('summary') or ''}",
                          kind="proposal", source_ids=[]),
            OutputSection(heading=tr("Otteet toimitetusta aineistosta", "Excerpts from supplied material"),
                          body=excerpts, kind="evidence", source_ids=[source["id"] for source in sources]),
            OutputSection(heading=OUTPUTS[output_type][1 if en else 0], body=proposals[output_type],
                          kind="proposal", source_ids=[]),
            OutputSection(heading=tr("Avoimet kysymykset ja tarkistukset", "Open questions and verification"),
                          body="\n".join(candidate.get("risks") or []) + "\n" + (refinement or tr(
                              "Sovi puuttuvan tiedon hankkimisesta ja hyväksymiskriteereistä. Ulkoisia lähteitä ei ole varmennettu.",
                              "Agree on collecting missing information and acceptance criteria. External sources have not been verified.")),
                          kind="uncertainty", source_ids=[]),
        ])
    else:
        draft = await structured(
            settings, WrittenOutput,
            f"Produce a substantive {output_type} deliverable, not an instruction prompt to another agent. "
            + OUTPUTS[output_type][2]
            + " Software development is optional, never the default. Do not generate code, prices or claim execution. "
            "Distinguish source-reported evidence, proposals and uncertainty using section kinds. "
            "Every evidence section must cite supplied source_ids; never invent citations or external research. "
            "Use original supplied material, not simulated or unverified candidate claims as facts. "
            "Candidate benefits, risks and alternatives are proposals with recorded provenance, not verified evidence. "
            "Do not invent owners, deadlines, measurements or results; mark missing information explicitly. "
            "Finish with review criteria and next decisions. All content is a draft for human review.",
            data, language=context["project"].get("language", "fi"),
        )
    known = {source["id"] for source in sources}
    for section in draft.sections:
        if set(section.source_ids) - known or (section.kind == "evidence" and not section.source_ids):
            raise ValueError("Output contains missing or unknown source references")
    labels = {
        "evidence": tr("Aineistossa esitetty tieto, ei riippumattomasti varmennettu", "Source-reported information, not independently verified"),
        "proposal": tr("Ehdotus tai tulkinta", "Proposal or interpretation"),
        "uncertainty": tr("Epävarmuus tai avoin kysymys", "Uncertainty or open question"),
    }
    warning = tr("DEMOLUONNOS: paikallinen mallipohja, ei AI-selvitys.", "DEMO DRAFT: local template, not an AI investigation.") if settings.mock_ai else tr(
        "AI-LUONNOS: tarkista lähteet ja johtopäätökset ennen käyttöä.",
        "AI DRAFT: verify sources and conclusions before use.")
    sections = "\n\n".join(
        f"## {section.heading}\n\n{labels[section.kind]}\n\n{section.body}\n\n"
        + (tr("Lähdeviitteet: ", "Source references: ") + ", ".join(section.source_ids) if section.source_ids else "")
        for section in draft.sections
    )
    appendix = "\n".join(
        f"- [{source['id']}] {source['title']}"
        + (f" — {source['url']}" if source.get("url") else "")
        + (f" @ {source['revision']}" if source.get("revision") else "")
        for source in sources
    )
    decision = context.get("decision")
    decision_text = (
        "\n\n## " + tr("Vahvistettu päätös", "Confirmed decision") + "\n\n"
        + tr("Perustelu: ", "Rationale: ") + decision["decision_rationale"] + "\n\n"
        + tr("Seuraava teko ja onnistumiskriteeri: ", "Next action and success criterion: ") + decision["hypothesis"]
    ) if decision else ""
    return GeneratedOutput(
        generation_mode="mock" if settings.mock_ai else "ai",
        source_ids=[source["id"] for source in sources],
        content=f"# {OUTPUTS[output_type][1 if en else 0]}: {candidate['title']}\n\n{warning}\n\n"
        + tr("Tietopohja: toimitettu projektiaineisto. Ei ulkoista tiedonhakua tai riippumatonta lähdevarmennusta.",
             "Evidence basis: supplied project material. No external research or independent source verification.")
        + "\n" + tr("Ratkaisuehdotuksen alkuperä: ", "Candidate provenance: ")
        + (candidate.get("generation_mode") or tr("tuntematon", "unknown"))
        + tr(". Ehdotusta ei ole varmennettu faktaksi.\n\n", ". The proposal is not verified as fact.\n\n")
        + decision_text + "\n\n" + sections + "\n\n## " + tr("Toimitetut lähteet", "Supplied sources") + "\n\n" + appendix,
    )
