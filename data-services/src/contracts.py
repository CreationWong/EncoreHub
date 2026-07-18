from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

CapabilityName = Literal["embed", "parse", "chunk"]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
DocumentText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000_000)
]
EmbeddingText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32_768)
]
Base64Content = Annotated[str, StringConstraints(min_length=1, max_length=16_777_216)]
JsonScalar = str | int | float | bool | None


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CapabilityUnavailable(ContractModel):
    status: Literal["not_implemented"] = "not_implemented"
    capability: CapabilityName
    detail: str = "Capability contract is defined but no implementation is enabled."


class EmbedRequest(ContractModel):
    texts: Annotated[list[EmbeddingText], Field(min_length=1, max_length=128)]
    model: ShortText | None = None
    normalize: bool = True


class EmbedResponse(ContractModel):
    model: ShortText
    dimensions: Annotated[int, Field(gt=0)]
    embeddings: list[list[float]]


class ParseRequest(ContractModel):
    filename: ShortText
    media_type: ShortText
    content_base64: Base64Content


class ParseResponse(ContractModel):
    text: str
    metadata: dict[str, JsonScalar] = Field(default_factory=dict)


class ChunkRequest(ContractModel):
    text: DocumentText
    chunk_size: Annotated[int, Field(ge=1, le=100_000)] = 1_000
    overlap: Annotated[int, Field(ge=0, le=99_999)] = 200

    @model_validator(mode="after")
    def validate_overlap(self) -> Self:
        if self.overlap >= self.chunk_size:
            raise ValueError("overlap must be smaller than chunk_size")
        return self


class Chunk(ContractModel):
    index: Annotated[int, Field(ge=0)]
    text: str
    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(ge=0)]


class ChunkResponse(ContractModel):
    chunks: list[Chunk]
