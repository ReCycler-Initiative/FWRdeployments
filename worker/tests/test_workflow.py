import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock, patch

from app.agents.chain import ROLES, mock_output, run_chain
from app.config import Settings
from app.ingest import extract_text
from app.models import RoleOutput
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
        with patch("app.pipeline.synthesize.structured", new_callable=AsyncMock, return_value=expected) as provider:
            result = await synthesize(settings, self.context, transcript, observations)
        self.assertIs(result, expected)
        provider.assert_awaited_once()
        args = provider.call_args.args
        self.assertIn("Do not generate prices", args[2])
        self.assertEqual(args[3]["transcript_vtt"], transcript)
        self.assertEqual(args[3]["documents"], self.context["documents"])
        self.assertEqual(args[3]["signal_fusion"]["signals"], [])

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
