from typing import Any

import httpx
import pytest

from src.main import app

CAPABILITY_CASES: list[tuple[str, dict[str, object], str]] = [
    ("/embed", {"texts": ["first", "second"]}, "embed"),
    (
        "/parse",
        {
            "filename": "notes.md",
            "media_type": "text/markdown",
            "content_base64": "IyBOb3Rlcw==",
        },
        "parse",
    ),
    (
        "/chunk",
        {"text": "A contract-only document", "chunk_size": 1000, "overlap": 200},
        "chunk",
    ),
]


async def test_health_check() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "encorehub-data-services",
    }


@pytest.mark.parametrize(("path", "payload", "capability"), CAPABILITY_CASES)
async def test_declared_capabilities_return_structured_not_implemented(
    path: str,
    payload: dict[str, object],
    capability: str,
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(path, json=payload)

    assert response.status_code == 501
    assert response.json() == {
        "status": "not_implemented",
        "capability": capability,
        "detail": "Capability contract is defined but no implementation is enabled.",
    }


async def test_capability_openapi_declares_request_success_and_unavailable_models() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/openapi.json")

    assert response.status_code == 200
    paths: dict[str, Any] = response.json()["paths"]
    expected_models = {
        "/embed": ("EmbedRequest", "EmbedResponse"),
        "/parse": ("ParseRequest", "ParseResponse"),
        "/chunk": ("ChunkRequest", "ChunkResponse"),
    }
    for path, (request_model, response_model) in expected_models.items():
        operation = paths[path]["post"]
        request_ref = operation["requestBody"]["content"]["application/json"]["schema"]["$ref"]
        success_ref = operation["responses"]["200"]["content"]["application/json"]["schema"][
            "$ref"
        ]
        unavailable_ref = operation["responses"]["501"]["content"]["application/json"][
            "schema"
        ]["$ref"]
        assert request_ref.endswith(f"/{request_model}")
        assert success_ref.endswith(f"/{response_model}")
        assert unavailable_ref.endswith("/CapabilityUnavailable")


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/embed", {"texts": []}),
        (
            "/parse",
            {"filename": "empty.md", "media_type": "text/markdown", "content_base64": ""},
        ),
        ("/chunk", {"text": "invalid overlap", "chunk_size": 100, "overlap": 100}),
    ],
)
async def test_capability_contracts_reject_invalid_requests(
    path: str, payload: dict[str, object]
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(path, json=payload)

    assert response.status_code == 422
