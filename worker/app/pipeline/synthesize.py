from app.config import Settings
from app.models import Agenda, SignalResult, Synthesis
from app.providers import structured


async def generate_agenda(settings: Settings, context: dict) -> str:
    if not settings.mock_ai:
        return (await structured(
            settings, Agenda,
            "Create a practical half-day workshop agenda with durations and clarifying questions "
            "grounded in the project and context documents. Do not generate prices or cost estimates.", context,
            language=context["project"].get("language", "fi"),
        )).agenda
    title = context["project"]["title"]
    systems = ", ".join(context["project"].get("target_systems") or []) or "nykyiset järjestelmät"
    documents = ", ".join(doc["filename"] for doc in context["documents"]) or "ei ennakkodokumentteja"
    workshop = context.get("workshop")
    if context["project"].get("language") == "en":
        return (
            f"# Workshop agenda: {workshop['title'] if workshop else title}\n\n"
            "SIMULATED preparation draft — review with the facilitator.\n\n"
            f"Goal: {context['project'].get('description') or 'Identify the main sources of friction.'}\n"
            f"Workshop focus: {(workshop or {}).get('notes') or 'Agree on the focus with participants.'}\n"
            f"Existing systems: {', '.join(context['project'].get('target_systems') or []) or 'Not specified'}\n"
            f"Context sources: {', '.join(doc['filename'] for doc in context['documents']) or 'None provided'}\n"
            f"Previously analyzed workshops: {len(context.get('previous_workshops', []))}\n\n"
            "09.00–09.30 Goals and success metrics. What should improve?\n"
            "09.30–10.15 Walk through the current process. Where is information copied manually?\n"
            "10.15–10.30 Break.\n"
            "10.30–11.15 Pain points and ownership. Where does work wait, and who owns the next step?\n"
            "11.15–12.00 Solution options, risks and scope. Could a process change suffice?\n"
            "12.00–12.30 Priorities and next steps. Who approves the pilot and measures outcomes?\n"
        )
    focus = (f"\nTyöpaja: {workshop['title']}\nTyöpajan tavoite: {workshop.get('notes') or 'Tarkenna tavoite yhdessä osallistujien kanssa.'}\n"
             if workshop else "")
    return (
        f"# Työpajarunko: {workshop['title'] if workshop else title}\n\nSIMULOITU valmistelurunko — tarkista fasilitoijan kanssa.\n"
        f"{focus}"
        f"Tavoite: {context['project'].get('description') or 'Tunnistaa työn tärkeimmät kitkat.'}\n"
        f"Järjestelmät: {systems}\nEnnakkomateriaali: {documents}\n"
        f"Aiemmat analysoidut työpajat: {len(context.get('previous_workshops', []))}\n\n"
        "09.00–09.30 Tavoitteet ja onnistumisen mittarit. Mitä haluamme parantaa?\n"
        "09.30–10.15 Nykyprosessin läpikäynti. Missä tieto siirtyy käsin?\n"
        "10.15–10.30 Tauko.\n10.30–11.15 Kipupisteet ja vastuut. Missä työ odottaa?\n"
        "11.15–12.00 Ratkaisuvaihtoehdot, riskit ja rajaukset.\n"
        "12.00–12.30 Priorisointi ja jatkotoimet. Kuka hyväksyy prototyypin?\n"
    )


async def synthesize(settings: Settings, context: dict, transcript: str, signal_result: SignalResult) -> Synthesis:
    if not settings.mock_ai:
        return await structured(
            settings, Synthesis,
            "Return exactly three solution candidates with string-array benefits/risks and concrete "
            "architecture specifications. Do not generate prices, budgets or cost estimates. "
            "Classify each solution_type as TECHNICAL, PROCESS or HYBRID. Consider a non-code "
            "process change when it solves the need: an agent farm is never mandatory. "
            "Return a Mermaid flowchart of the current process. Pain-point quotes must be verbatim transcript evidence, "
            "with timestamps; emotions are tentative signal-based interpretations. Explicitly "
            "state uncertainty and signal limitations in descriptions. Do not invent quotes. "
            "Previous analytical findings are unverified: ignore simulated findings and use original "
            "transcripts/documents as evidence, not previous AI conclusions. "
            "Consider all previous workshops when proposing solutions. For plain TXT input "
            "explicitly label timestamps as estimated; never pretend audio or face signals exist.",
            {**context, "transcript_vtt": transcript, "signal_fusion": signal_result.model_dump()},
            language=context["project"].get("language", "fi"),
        )
    if context["project"].get("language") == "en":
        return Synthesis(
            pain_points=[
                {"timestamp_seconds": 12, "emotion": "SIMULATED frustration", "intensity": 0.78,
                 "quote": "[SIMULATED QUOTE] We copy customer feedback into three systems manually.",
                 "description": "SIMULATED duplicate data entry; not observed in the recording."},
                {"timestamp_seconds": 47, "emotion": "SIMULATED hesitation", "intensity": 0.61,
                 "quote": "[SIMULATED QUOTE] I do not know who owns the next step.",
                 "description": "SIMULATED unclear ownership; not a measured emotional state."},
            ],
            current_state_mermaid=(
                'flowchart LR\n A["SIMULATED: feedback arrives"] --> B["Manual entry"]\n'
                ' B --> C["Copy to systems"]\n C --> D["Find owner"]\n D --> E["Reply to customer"]'
            ),
            candidates=[
                {"title": title + " (simulated option)", "summary": summary, "solution_type": kind,
                 "benefits": benefits, "risks": risks,
                 "architecture_spec": "SIMULATED estimate, not an implemented solution. " + architecture}
                for title, summary, kind, benefits, risks, architecture in [
                    ("Process improvement without new code", "Agree on owners, a shared queue and response targets.",
                     "PROCESS", ["Clear ownership", "Fast pilot without development"],
                     ["Adoption requires commitment", "Some manual work remains"],
                     "Receive feedback → assign owner → shared progress tracking → customer reply. Use existing tools; no agent farm required."),
                    ("Integration service", "Synchronize feedback across existing systems.",
                     "TECHNICAL", ["Consistent information", "Clear audit trail"],
                     ["API dependencies", "Maintenance required"],
                     "FastAPI service, idempotent event queue, system adapters and audit table."),
                    ("Shared feedback workspace", "Combine an operational process with a shared portal and reporting.",
                     "HYBRID", ["Unified user experience", "Measurable handling time"],
                     ["Larger scope", "Change management"],
                     "Next.js portal, FastAPI, PostgreSQL, OIDC authentication and an operational dashboard."),
                ]
            ],
        )
    return Synthesis(
        pain_points=[
            {"timestamp_seconds": 12, "emotion": "SIMULOITU turhautuminen", "intensity": 0.78,
             "quote": "[SIMULOITU LAINAUS] Kopioimme asiakaspalautteen käsin kolmeen järjestelmään.",
             "description": "SIMULOITU kipupiste: päällekkäinen tiedonsyöttö, ei havaittu tallenteesta."},
            {"timestamp_seconds": 47, "emotion": "SIMULOITU epäröinti", "intensity": 0.61,
             "quote": "[SIMULOITU LAINAUS] En tiedä, kuka vastaa seuraavasta käsittelyvaiheesta.",
             "description": "SIMULOITU kipupiste: epäselvä vastuunjako, ei mitattu tunnetila."},
        ],
        current_state_mermaid=(
            'flowchart LR\n A["SIMULOITU: palaute saapuu"] --> B["Manuaalinen kirjaus"]\n'
            ' B --> C["Kopiointi järjestelmiin"]\n C --> D["Vastuuhenkilön etsintä"]\n'
            ' D --> E["Asiakkaalle vastaaminen"]'
        ),
        candidates=[
            {"title": f"{title} (simuloitu vaihtoehto)", "summary": summary,
             "solution_type": kind,
             "benefits": benefits, "risks": risks,
             "architecture_spec": "SIMULOITU arvio, ei valmis toteutus. " + architecture}
            for title, summary, kind, benefits, risks, architecture in [
                ("Prosessin selkeytys ilman uutta koodia", "Sovi vastuut, yhteinen käsittelyjono ja palvelulupaus nykyisillä työkaluilla.",
                 "PROCESS", ["Selkeä omistajuus", "Nopea pilotti ilman ohjelmistokehitystä"], ["Toimintatapojen sitoutuminen", "Käsityö ei poistu kokonaan"],
                 "Palautteen vastaanotto → vastuuhenkilö → yhteinen tilaseuranta → asiakkaalle vastaaminen. Käytä nykyisiä työkaluja; ei agenttifarmia tai uutta sovellusta."),
                ("Integraatiopalvelu", "Synkronoi palaute nykyisiin järjestelmiin.",
                 "TECHNICAL", ["Tieto yhdessä paikassa", "Selkeä auditointijälki"], ["API-riippuvuudet", "Ylläpitotarve"],
                 "FastAPI-palvelu, idempotentti tapahtumajono, järjestelmäadapterit ja auditointitaulu."),
                ("Oma palautetyötila", "Rakenna yhteinen käsittelyportaali ja raportointi.",
                 "HYBRID", ["Yhtenäinen käyttökokemus", "Mitattava käsittelyaika"], ["Laajempi kokonaisuus", "Muutosjohtaminen"],
                 "Next.js-portaali, FastAPI, PostgreSQL, OIDC-kirjautuminen ja seurantanäkymä."),
            ]
        ],
    )
