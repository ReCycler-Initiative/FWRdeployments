from uuid import UUID

import httpx

from app.config import Settings
from app.models import SignalResult
from app.paths import project_file


async def signals(
    settings: Settings, project_id: UUID, session: dict, transcript: str, language: str = "fi",
) -> SignalResult:
    if settings.mock_ai:
        if language == "en":
            return SignalResult(
                signals=[
                    {"timestamp_seconds": 12, "emotion": "SIMULATED frustration", "intensity": 0.78,
                     "audio_observation": "SIMULATED change in voice; not measured",
                     "microexpression_observation": "SIMULATED frown; not measured"},
                    {"timestamp_seconds": 47, "emotion": "SIMULATED hesitation", "intensity": 0.61,
                     "audio_observation": "SIMULATED pause; not measured",
                     "microexpression_observation": "SIMULATED expression change; not measured"},
                ],
                baseline_method="SIMULATED example calibration, not measured from video",
                limitations="All signals and quotes are fictional demonstration values.",
            )
        return SignalResult(
            signals=[
                {"timestamp_seconds": 12, "emotion": "SIMULOITU turhautuminen", "intensity": 0.78,
                 "audio_observation": "SIMULOITU äänenpainon muutos; ei mitattu",
                 "microexpression_observation": "SIMULOITU kulmien kurtistus; ei mitattu"},
                {"timestamp_seconds": 47, "emotion": "SIMULOITU epäröinti", "intensity": 0.61,
                 "audio_observation": "SIMULOITU puhetauko; ei mitattu",
                 "microexpression_observation": "SIMULOITU ilmeen muutos; ei mitattu"},
            ],
            baseline_method="SIMULOITU esimerkkikalibrointi, ei videosta mitattu",
            limitations="Kaikki signaalit ja lainaukset ovat kuvitteellisia demoarvoja.",
        )
    if not session.get("video_path") or not session["video_path"].lower().endswith(".mp4"):
        if language == "en":
            return SignalResult(
                signals=[],
                baseline_method="Transcript only: audio and facial baselines cannot be measured.",
                limitations="Audio and microexpression signals are unavailable from text. "
                             "TXT timestamps are estimates, not measured values.",
            )
        return SignalResult(
            signals=[],
            baseline_method="Pelkkä litterointi: äänen tai kasvojen perustasoa ei voida mitata.",
            limitations="Äänenpaino- ja mikroilmesignaaleja ei ole saatavilla tekstiaineistosta. "
                         "TXT-aikaleimat ovat vain tekstikohtaisia arvioita, eivät mitattuja.",
        )
    if not settings.signals_api_url:
        raise ValueError("Real video signal analysis requires SIGNALS_API_URL; mock fallback is disabled")
    if not session.get("video_path"):
        raise ValueError("Real audio/microexpression fusion requires workshop video")
    video = project_file(settings.media_dir, project_id, session["video_path"])
    headers = {}
    if settings.signals_api_key.get_secret_value():
        headers["Authorization"] = "Bearer " + settings.signals_api_key.get_secret_value()
    async with httpx.AsyncClient(timeout=settings.provider_timeout_seconds) as client:
        with video.open("rb") as file:
            response = await client.post(
                settings.signals_api_url, headers=headers,
                data={"transcript_vtt": transcript, "language": language},
                files={"video": (video.name, file, "video/mp4")},
            )
        response.raise_for_status()
        return SignalResult.model_validate(response.json())
