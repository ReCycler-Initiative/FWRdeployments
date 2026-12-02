import asyncio
from uuid import UUID, uuid4

from openai import AsyncOpenAI

from app.config import Settings
from app.paths import project_file
from app.providers import require_openai


def vtt_time(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"


async def transcribe(settings: Settings, project_id: UUID, session: dict, language: str = "fi") -> str:
    parts = session.get("transcripts") or []
    if parts:
        if len(parts) == 1:
            return parts[0]["content"]
        return "\n\n".join(
            f"### Transcript: {part['title']} [{part['id']}]\n{part['content']}"
            for part in parts
        )
    if session.get("transcript_vtt"):
        return session["transcript_vtt"]
    if settings.mock_ai:
        if language == "en":
            return (
                "WEBVTT\n\n00:00:12.000 --> 00:00:18.000\n"
                "[SIMULATED QUOTE] We copy customer feedback into three systems manually.\n\n"
                "00:00:47.000 --> 00:00:54.000\n"
                "[SIMULATED QUOTE] I do not know who owns the next step.\n"
            )
        return (
            "WEBVTT\n\n00:00:12.000 --> 00:00:18.000\n"
            "[SIMULOITU LAINAUS] Kopioimme asiakaspalautteen käsin kolmeen järjestelmään.\n\n"
            "00:00:47.000 --> 00:00:54.000\n"
            "[SIMULOITU LAINAUS] En tiedä, kuka vastaa seuraavasta käsittelyvaiheesta.\n"
        )
    require_openai(settings)
    if not session.get("video_path"):
        raise ValueError("Whisper requires workshop video or an uploaded VTT transcript")
    video = project_file(settings.media_dir, project_id, session["video_path"])
    audio = video.parent / f".whisper-{uuid4()}.mp3"
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
            "-b:a", "48k", str(audio),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(
            process.communicate(), timeout=settings.provider_timeout_seconds
        )
        if process.returncode:
            raise ValueError("ffmpeg audio extraction failed: " + stderr.decode(errors="replace")[:500])
        if audio.stat().st_size > 24 * 1024 * 1024:
            raise ValueError("Extracted audio exceeds Whisper's upload limit; split workshop recording")
        async with AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(),
            timeout=settings.provider_timeout_seconds, max_retries=1,
        ) as client:
            with audio.open("rb") as file:
                result = await client.audio.transcriptions.create(
                    model=settings.whisper_model, file=file, language=language,
                    response_format="verbose_json", timestamp_granularities=["segment"],
                )
        if not result.segments:
            raise ValueError("Whisper returned no timestamped speech")
        return "WEBVTT\n\n" + "\n\n".join(
            f"{vtt_time(segment.start)} --> {vtt_time(segment.end)}\n{segment.text.strip()}"
            for segment in result.segments
        )
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        audio.unlink(missing_ok=True)
