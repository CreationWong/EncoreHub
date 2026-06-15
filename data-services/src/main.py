"""
EncoreHub Data Services

Python backend for AI/ML data pipeline:
- Document ingestion & parsing (PDF, Word, Markdown, HTML)
- Embedding generation (local models + API-based)
- RAG pipeline (retrieval-augmented generation)
- Web scraping & content cleaning for search
- Conversation analysis & summarization
"""

from fastapi import FastAPI

app = FastAPI(
    title="EncoreHub Data Services",
    version="0.1.0",
    description="AI data pipeline for EncoreHub",
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "encorehub-data-services"}


# TODO: Register ingestion endpoints
# TODO: Register embedding endpoints
# TODO: Register RAG query endpoints
# TODO: Register web scraping endpoints
# TODO: Connect to Rust engine via gRPC client
