from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyzeRequest(StrictModel):
    session_id: UUID


class BuildRequest(StrictModel):
    candidate_id: UUID
    expected_delivery_id: UUID | None = None
    refinement: str = Field(default="", max_length=5000)


OutputType = Literal["REPORT", "RECOMMENDATION", "PROCESS", "GUIDE", "EXPERIMENT"]


class OutputRequest(StrictModel):
    candidate_id: UUID
    output_type: OutputType
    refinement: str = Field(default="", max_length=5000)


class OutputSection(StrictModel):
    heading: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=100000)
    kind: Literal["evidence", "proposal", "uncertainty"]
    source_ids: list[str]


class WrittenOutput(StrictModel):
    sections: list[OutputSection] = Field(min_length=2, max_length=12)


class GeneratedOutput(StrictModel):
    content: str = Field(min_length=20, max_length=250000)
    generation_mode: Literal["mock", "ai"]
    external_research: Literal[False] = False
    source_ids: list[str]


class PainPoint(StrictModel):
    transcript_id: UUID | None = None
    timestamp_seconds: float = Field(ge=0, allow_inf_nan=False)
    emotion: str = Field(min_length=1)
    intensity: float = Field(ge=0, le=1, allow_inf_nan=False)
    quote: str = Field(min_length=1)
    description: str = Field(min_length=1)


class Candidate(StrictModel):
    solution_type: Literal["TECHNICAL", "PROCESS", "HYBRID"] = "TECHNICAL"
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    benefits: list[str] = Field(min_length=1)
    risks: list[str] = Field(min_length=1)
    architecture_spec: str = Field(min_length=1)


class Synthesis(StrictModel):
    pain_points: list[PainPoint] = Field(min_length=1)
    current_state_mermaid: str
    candidates: list[Candidate] = Field(min_length=3, max_length=3)

    @field_validator("current_state_mermaid")
    @classmethod
    def flowchart(cls, value: str) -> str:
        if not value.strip().startswith(("flowchart ", "graph ")):
            raise ValueError("Expected a Mermaid flowchart, without Markdown fences")
        return value


class Agenda(StrictModel):
    agenda: str = Field(min_length=20)


class Signal(StrictModel):
    timestamp_seconds: float = Field(ge=0, allow_inf_nan=False)
    emotion: str = Field(min_length=1)
    intensity: float = Field(ge=0, le=1, allow_inf_nan=False)
    audio_observation: str = Field(min_length=1)
    microexpression_observation: str = Field(min_length=1)


class SignalResult(StrictModel):
    signals: list[Signal]
    baseline_method: str = Field(min_length=1)
    limitations: str = Field(min_length=1)


class Artifact(StrictModel):
    path: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=200000)


class RoleOutput(StrictModel):
    role: Literal["architect", "coder", "data", "qa"]
    summary: str = Field(min_length=1)
    artifacts: list[Artifact] = Field(min_length=1, max_length=12)
