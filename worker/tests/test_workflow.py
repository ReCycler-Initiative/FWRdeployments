import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock, patch

from app.agents.chain import ROLES, mock_output, run_chain
from app.config import Settings
from app.ingest import extract_text
from app.models import OutputSection, RoleOutput, Synthesis, WrittenOutput
from app.outputs import OUTPUTS, generate_output
from app.paths import artifact_file
from app.pipeline.signals import signals
from app.pipeline.synthesize import generate_agenda, synthesize
from app.pipeline.transcribe import transcribe
from app.providers import require_openai


class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(database_url="postgresql://unused", mock_ai=True)
        self.context = {
            "project": {"title": "Palautetyötila", "description": "Vähemmän käsityötä",
                        "target_systems": ["CRM"]},
            "documents": [{"filename": "Prosessi", "content_text": "Kopiointi käsin"}],
            "previous_workshops": [{"title": "Työpaja 1"}],
        }

    def output_context(self, language="fi"):
        candidate = {"id": uuid4(), "title": "Omistajuuden selvitys", "summary": "Selvitä käsityön syyt",
                     "generation_mode": "mock", "risks": ["Vastuu on vielä avoin"]}
        return {
            "project": {**self.context["project"], "id": uuid4(), "language": language},
            "candidate": candidate, "alternatives": [candidate],
            "decision": {"decision_rationale": "Vastuu varmistettiin asiakkaalta.",
                         "hypothesis": "Nimeä omistaja ja mittaa siirtoaika."},
            "documents": [{"id": uuid4(), "filename": "Nykytila", "content_text": "Kopiointi vie kaksi tuntia."}],
            "workshops": [
                {"id": uuid4(), "title": "Työpaja 1", "transcript_vtt": "Omistaja pitää nimetä.", "notes": ""},
                {"id": uuid4(), "title": "Videodemo", "video_path": "/media/demo.mp4", "analysis_mode": "mock",
                 "transcript_vtt": "DO NOT TREAT MOCK VIDEO TRANSCRIPTION AS SOURCE"},
            ],
        }

    async def test_non_code_demo_outputs_preserve_sources_and_distinguish_outcomes(self):
        for language in ("fi", "en"):
            context = self.output_context(language)
            for output_type, labels in OUTPUTS.items():
                with self.subTest(language=language, output_type=output_type):
                    with patch("app.outputs.structured", new_callable=AsyncMock) as provider:
                        result = await generate_output(self.settings, context, output_type, "Varmista roolit")
                    provider.assert_not_awaited()
                    self.assertEqual(result.generation_mode, "mock")
                    self.assertFalse(result.external_research)
                    self.assertIn(labels[1 if language == "en" else 0], result.content)
                    self.assertIn("DEMO DRAFT" if language == "en" else "DEMOLUONNOS", result.content)
                    self.assertIn("Kopiointi vie kaksi tuntia.", result.content)
                    self.assertIn("Omistaja pitää nimetä.", result.content)
                    self.assertIn("Varmista roolit", result.content)
                    self.assertIn(context["decision"]["hypothesis"], result.content)
                    self.assertNotIn("DO NOT TREAT MOCK VIDEO", result.content)
                    self.assertIn(f"document:{context['documents'][0]['id']}", result.source_ids)

    async def test_real_non_code_output_uses_original_material_and_validates_references(self):
        context = self.output_context("en")
        source_id = f"document:{context['documents'][0]['id']}"
        draft = WrittenOutput(sections=[
            OutputSection(heading="Source report", body="The supplied document reports manual work.",
                          kind="evidence", source_ids=[source_id]),
            OutputSection(heading="Open question", body="Confirm the baseline with the owner.",
                          kind="uncertainty", source_ids=[]),
        ])
        settings = self.settings.model_copy(update={"mock_ai": False})
        with patch("app.outputs.structured", new_callable=AsyncMock, return_value=draft) as provider:
            result = await generate_output(settings, context, "REPORT", "Check the baseline")
        self.assertEqual(result.generation_mode, "ai")
        self.assertFalse(result.external_research)
        self.assertIn("AI DRAFT", result.content)
        self.assertIn("Candidate provenance: mock", result.content)
        self.assertIn("No external research", result.content)
        self.assertEqual(provider.call_args.kwargs["language"], "en")
        self.assertEqual(provider.call_args.args[3]["decision"], context["decision"])
        self.assertEqual(provider.call_args.args[3]["sources"][1]["text"], "Kopiointi vie kaksi tuntia.")
        self.assertIn("not an instruction prompt", provider.call_args.args[2])
        draft.sections[0].source_ids = ["invented-source"]
        with patch("app.outputs.structured", new_callable=AsyncMock, return_value=draft):
            with self.assertRaisesRegex(ValueError, "unknown source"):
                await generate_output(settings, context, "REPORT", "")
        draft.sections[0].source_ids = []
        with patch("app.outputs.structured", new_callable=AsyncMock, return_value=draft):
            with self.assertRaisesRegex(ValueError, "missing or unknown source"):
                await generate_output(settings, context, "REPORT", "")

    async def test_output_provider_failure_has_no_demo_fallback(self):
        settings = self.settings.model_copy(update={"mock_ai": False})
        with patch("app.outputs.structured", new_callable=AsyncMock, side_effect=ValueError("Provider failed")):
            with self.assertRaisesRegex(ValueError, "Provider failed"):
                await generate_output(settings, self.output_context(), "GUIDE", "")

    async def test_agenda_and_analysis_shapes(self):
        agenda = await generate_agenda(self.settings, self.context)
        self.assertIn("Palautetyötila", agenda)
        self.assertIn("Aiemmat analysoidut työpajat: 1", agenda)
        workshop_agenda = await generate_agenda(self.settings, {
            **self.context, "workshop": {"title": "Pilotin validointi", "notes": "Varmista vastuuhenkilöt"},
        })
        self.assertIn("Pilotin validointi", workshop_agenda)
        self.assertIn("Varmista vastuuhenkilöt", workshop_agenda)
        transcript = await transcribe(self.settings, uuid4(), {"transcript_vtt": "oma litterointi"})
        self.assertEqual(transcript, "oma litterointi")
        observations = await signals(self.settings, uuid4(), {}, transcript)
        result = await synthesize(self.settings, self.context, transcript, observations)
        self.assertEqual(len(result.candidates), 3)
        self.assertTrue(all("SIMULOITU" in point.quote for point in result.pain_points))
        self.assertTrue(all("estimated_cost" not in candidate.model_dump() for candidate in result.candidates))

    async def test_real_synthesis_passes_actual_transcript_and_requests_no_prices(self):
        transcript = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nTilauksen hyväksyntä kestää viikon."
        settings = self.settings.model_copy(update={"mock_ai": False})
        observations = await signals(settings, uuid4(), {"video_path": "/media/workshop.vtt"}, transcript)
        expected = await synthesize(self.settings, self.context, transcript, observations)
        payload = expected.model_dump()
        payload["current_state_mermaid"] = 'graph TD;\n A["Current state"] --> B["Review"];'

        async def response(_settings, model, *_args, **_kwargs):
            return model.model_validate(payload)

        with patch("app.pipeline.synthesize.structured", new_callable=AsyncMock, side_effect=response) as provider:
            result = await synthesize(settings, self.context, transcript, observations)
        self.assertEqual(result.model_dump(), payload)
        provider.assert_awaited_once()
        args = provider.call_args.args
        self.assertIn("Do not generate prices", args[2])
        self.assertEqual(args[3]["transcript_vtt"], transcript)
        self.assertEqual(args[3]["documents"], self.context["documents"])
        self.assertEqual(args[3]["signal_fusion"]["signals"], [])

    async def test_synthesis_recognizes_flowchart_aliases_but_rejects_fences_and_other_diagrams(self):
        observations = await signals(self.settings, uuid4(), {}, "Original workshop evidence")
        payload = (await synthesize(self.settings, self.context, "Original workshop evidence", observations)).model_dump()
        for chart in ("flowchart LR\n A --> B", "graph LR\n A --> B", "graph TD; A --> B;"):
            with self.subTest(chart=chart):
                result = Synthesis.model_validate({**payload, "current_state_mermaid": chart})
                self.assertEqual(result.current_state_mermaid, chart)
        for chart in ("```mermaid\n graph TD; A --> B;\n```", "sequenceDiagram\n A->>B: Hello", "graphical TD"):
            with self.subTest(chart=chart):
                with self.assertRaisesRegex(ValueError, "Expected a Mermaid flowchart"):
                    Synthesis.model_validate({**payload, "current_state_mermaid": chart})

    async def test_multiple_active_transcripts_reach_real_synthesis_once_with_local_source_ids(self):
        parts = [
            {"id": uuid4(), "title": "Morning", "filename": "morning.vtt",
             "content": "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nFIRST ORIGINAL SOURCE"},
            {"id": uuid4(), "title": "Afternoon", "filename": "afternoon.txt",
             "content": "SECOND ORIGINAL SOURCE"},
        ]
        settings = self.settings.model_copy(update={"mock_ai": False})
        session = {"video_path": "/media/workshop.mp4", "transcripts": parts,
                   "transcript_vtt": "STALE OR REPLACED CACHE"}
        transcript = await transcribe(settings, uuid4(), session)
        self.assertNotIn("STALE", transcript)
        for part in parts:
            self.assertEqual(transcript.count(part["content"]), 1)
            self.assertIn(str(part["id"]), transcript)
            self.assertIn(part["title"], transcript)
        with patch("app.pipeline.signals.httpx.AsyncClient") as video_provider:
            observations = await signals(settings, uuid4(), session, transcript)
        video_provider.assert_not_called()
        self.assertEqual(observations.signals, [])
        expected = await synthesize(self.settings, self.context, transcript, observations)
        for point, part in zip(expected.pain_points, parts):
            point.transcript_id = part["id"]
        context = {**self.context, "analysis_transcripts": [
            {key: part[key] for key in ("id", "title", "filename")} for part in parts
        ]}
        with patch("app.pipeline.synthesize.structured", new_callable=AsyncMock, return_value=expected) as provider:
            await synthesize(settings, context, transcript, observations)
        data = provider.call_args.args[3]
        self.assertEqual(data["transcript_vtt"], transcript)
        self.assertEqual(data["analysis_transcripts"], context["analysis_transcripts"])
        self.assertIn("local clock", provider.call_args.args[2])
        expected.pain_points[0].transcript_id = uuid4()
        with patch("app.pipeline.synthesize.structured", new_callable=AsyncMock, return_value=expected):
            with self.assertRaisesRegex(ValueError, "active transcript"):
                await synthesize(settings, context, transcript, observations)

    async def test_written_outputs_cite_each_active_transcript_without_aggregate_duplicates(self):
        context = self.output_context("en")
        parts = [{"id": uuid4(), "title": "Part one", "content": "FIRST SAVED SOURCE"},
                 {"id": uuid4(), "title": "Part two", "content": "SECOND SAVED SOURCE"}]
        context["workshops"][0].update(transcripts=parts, transcript_vtt="OLD AGGREGATE CACHE")
        source_ids = [f"transcript:{part['id']}" for part in parts]
        draft = WrittenOutput(sections=[
            OutputSection(heading="Evidence", body="Two supplied transcripts inform this draft.",
                          kind="evidence", source_ids=source_ids),
            OutputSection(heading="Review", body="Check these sources with the participants.",
                          kind="uncertainty", source_ids=[]),
        ])
        settings = self.settings.model_copy(update={"mock_ai": False})
        with patch("app.outputs.structured", new_callable=AsyncMock, return_value=draft) as provider:
            result = await generate_output(settings, context, "REPORT", "")
        sources = provider.call_args.args[3]["sources"]
        for part, source_id in zip(parts, source_ids):
            matches = [source for source in sources if source["id"] == source_id]
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]["text"], part["content"])
            self.assertIn(source_id, result.source_ids)
        self.assertFalse(any("OLD AGGREGATE" in source["text"] for source in sources))

    async def test_real_text_mode_has_no_invented_measured_signals(self):
        settings = self.settings.model_copy(update={"mock_ai": False})
        result = await signals(settings, uuid4(), {"video_path": "/media/workshop.txt"}, "teksti")
        self.assertEqual(result.signals, [])
        self.assertIn("ei voida mitata", result.baseline_method)
        with self.assertRaisesRegex(ValueError, "OPENAI_API_KEY"):
            require_openai(settings)
        with self.assertRaisesRegex(ValueError, "SIGNALS_API_URL"):
            await signals(settings, uuid4(), {"video_path": "/media/workshop.mp4"}, "teksti")

    async def test_english_generation_preserves_original_material(self):
        context = {
            **self.context,
            "project": {**self.context["project"], "language": "en"},
            "workshop": {"title": "Pilot review", "notes": "Verify ownership"},
        }
        agenda = await generate_agenda(self.settings, context)
        self.assertIn("# Workshop agenda: Pilot review", agenda)
        self.assertIn("Verify ownership", agenda)
        self.assertIn("Previously analyzed workshops: 1", agenda)
        self.assertIn("Vähemmän käsityötä", agenda, "User content must not be rewritten")
        original = "Alkuperäinen litterointi säilyy."
        self.assertEqual(await transcribe(self.settings, uuid4(), {"transcript_vtt": original}, "en"), original)
        transcript = await transcribe(self.settings, uuid4(), {}, "en")
        self.assertIn("SIMULATED QUOTE", transcript)
        observations = await signals(self.settings, uuid4(), {}, transcript, "en")
        result = await synthesize(self.settings, context, transcript, observations)
        self.assertEqual({candidate.solution_type for candidate in result.candidates}, {"PROCESS", "TECHNICAL", "HYBRID"})
        self.assertTrue(all("estimated_cost" not in candidate.model_dump() for candidate in result.candidates))
        self.assertTrue(all("SIMULATED" in point.quote for point in result.pain_points))
        self.assertIn("Manual entry", result.current_state_mermaid)
        for role in ROLES:
            output = mock_output(role, "en")
            self.assertIn("SIMULATED", output.summary)
            self.assertNotIn("SIMULOITU", "".join(artifact.content for artifact in output.artifacts))
        self.assertIn('lang="en"', mock_output("coder", "en").artifacts[1].content)

    async def test_mock_chain_emits_four_roles_and_reviewable_artifacts(self):
        seen = []

        async def started(role):
            seen.append((role, "running"))

        async def finished(role, output, paths):
            self.assertIsInstance(output, RoleOutput)
            self.assertTrue(all(Path(path).is_file() for path in paths))
            seen.append((role, "completed"))

        with tempfile.TemporaryDirectory() as directory:
            await run_chain(self.settings, self.context, Path(directory), started, finished)
            self.assertTrue((Path(directory) / "coder" / "prototype.html").is_file())
        self.assertEqual(seen, [(role, status) for role in ROLES for status in ("running", "completed")])

    async def test_agent_provider_receives_confirmed_action_and_output_scope(self):
        context = {**self.output_context("en"), "refinement": "Limit implementation to one team."}
        settings = self.settings.model_copy(update={"mock_ai": False})
        with tempfile.TemporaryDirectory() as directory:
            with patch("app.agents.chain.structured", new_callable=AsyncMock,
                       side_effect=[mock_output(role, "en") for role in ROLES]) as provider:
                await run_chain(settings, context, Path(directory), AsyncMock(), AsyncMock())
        self.assertEqual(provider.await_count, 4)
        for call in provider.await_args_list:
            self.assertEqual(call.args[3]["project"]["decision"], context["decision"])
            self.assertEqual(call.args[3]["project"]["refinement"], context["refinement"])

    def test_artifact_path_and_text_ingestion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for value in ("../escape.py", "/absolute.py", "x\\escape.py"):
                with self.assertRaises(ValueError):
                    artifact_file(root, value)
            text = root / "context.md"
            text.write_text("Nykyprosessi: käsityö", encoding="utf-8")
            self.assertIn("käsityö", extract_text(text))
            text.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "ei löytynyt tekstiä"):
                extract_text(text)


if __name__ == "__main__":
    unittest.main()
