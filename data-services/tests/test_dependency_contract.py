import tomllib
from pathlib import Path


def test_runtime_dependencies_are_framework_only() -> None:
    project_root = Path(__file__).resolve().parents[1]
    pyproject = tomllib.loads((project_root / "pyproject.toml").read_text(encoding="utf-8"))

    assert pyproject["project"]["dependencies"] == ["fastapi>=0.115", "uvicorn>=0.32"]
    assert "httpx>=0.28" in pyproject["dependency-groups"]["dev"]


def test_lock_excludes_unimplemented_capability_stacks() -> None:
    project_root = Path(__file__).resolve().parents[1]
    lock = tomllib.loads((project_root / "uv.lock").read_text(encoding="utf-8"))
    locked_names = {package["name"] for package in lock["package"]}

    excluded = {
        "celery",
        "grpcio",
        "grpcio-tools",
        "llama-index-core",
        "numpy",
        "pandas",
        "pymupdf",
        "redis",
        "sentence-transformers",
        "torch",
    }
    assert locked_names.isdisjoint(excluded)
