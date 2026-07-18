"""Contract-only HTTP surface for optional EncoreHub data capabilities."""

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse

from src.contracts import (
    CapabilityName,
    CapabilityUnavailable,
    ChunkRequest,
    ChunkResponse,
    EmbedRequest,
    EmbedResponse,
    ParseRequest,
    ParseResponse,
)

app = FastAPI(
    title="EncoreHub Data Services",
    version="0.1.0",
    description="AI data pipeline for EncoreHub",
)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "encorehub-data-services"}


def capability_unavailable(capability: CapabilityName) -> JSONResponse:
    payload = CapabilityUnavailable(capability=capability)
    return JSONResponse(status_code=status.HTTP_501_NOT_IMPLEMENTED, content=payload.model_dump())


@app.post(
    "/embed",
    response_model=EmbedResponse,
    responses={status.HTTP_501_NOT_IMPLEMENTED: {"model": CapabilityUnavailable}},
)
async def embed_contract(_: EmbedRequest) -> JSONResponse:
    return capability_unavailable("embed")


@app.post(
    "/parse",
    response_model=ParseResponse,
    responses={status.HTTP_501_NOT_IMPLEMENTED: {"model": CapabilityUnavailable}},
)
async def parse_contract(_: ParseRequest) -> JSONResponse:
    return capability_unavailable("parse")


@app.post(
    "/chunk",
    response_model=ChunkResponse,
    responses={status.HTTP_501_NOT_IMPLEMENTED: {"model": CapabilityUnavailable}},
)
async def chunk_contract(_: ChunkRequest) -> JSONResponse:
    return capability_unavailable("chunk")
