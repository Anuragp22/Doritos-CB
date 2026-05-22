"""Modal deployment for the embedding + reranking service (CPU).

Runs MODEL/server.py with ENABLE_GENERATION=false on a CPU container, so only
the BGE embedder and reranker load — no Qwen2-VL VLM, no GPU. This is what the
hosted demo points EMBED_API_URL / RERANK_API_URL at.

Kept separate from modal_app.py (the GPU VLM deployment): that one loads the
VLM and would waste GPU credit on what is a pure CPU workload.

Setup
-----
    pip install modal
    modal token new                          # one-time auth
    modal secret create doritos-model-auth MODEL_API_KEY=<random-key>

    modal deploy MODEL/modal_embed.py        # deploy
    modal serve  MODEL/modal_embed.py        # ephemeral dev URL, hot reload

After `modal deploy`, Modal prints a public URL. Point the backend at it:

    EMBED_API_URL=https://<workspace>--doritos-ai-embed-fastapi-app.modal.run/embed
    RERANK_API_URL=https://<workspace>--doritos-ai-embed-fastapi-app.modal.run/rerank

Cost: CPU only; min_containers=0 scales to zero (~$0 idle); scaledown_window
keeps a container warm 5 min so back-to-back retrievals stay hot.
"""

from pathlib import Path

import modal

APP_NAME = "doritos-ai-embed"
MODEL_DIR = Path(__file__).resolve().parent

app = modal.App(APP_NAME)

# Reuse the HF cache volume so the BGE checkpoints download once and persist
# across cold starts.
hf_cache = modal.Volume.from_name("doritos-hf-cache", create_if_missing=True)

# CPU image: only the packages server.py imports. ENABLE_GENERATION=false is
# set here so server.py reads it at import time and skips loading the VLM.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({"ENABLE_GENERATION": "false"})
    .pip_install(
        "torch",
        "transformers>=4.45",
        "sentence-transformers>=3.0",
        "qwen-vl-utils[decord]>=0.0.8",
        "fastapi[standard]>=0.110",
        "pillow>=10",
    )
    .add_local_dir(str(MODEL_DIR), "/app")
)


class BearerAuthMiddleware:
    """ASGI middleware requiring `Authorization: Bearer <api_key>`.

    Mirrors the middleware in modal_app.py / modal_segment.py. GET / stays
    public as a health / warm-up probe.
    """

    def __init__(self, app, api_key: str):
        self.app = app
        self._expected = f"Bearer {api_key}".encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope["path"] == "/" and scope["method"] == "GET":
            await self.app(scope, receive, send)
            return
        for name, value in scope["headers"]:
            if name == b"authorization" and value == self._expected:
                await self.app(scope, receive, send)
                return
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b'{"error":"Invalid or missing API key"}',
            }
        )


@app.function(
    image=image,
    cpu=2.0,
    memory=2048,
    volumes={"/root/.cache/huggingface": hf_cache},
    secrets=[modal.Secret.from_name("doritos-model-auth")],
    min_containers=0,
    scaledown_window=300,
    timeout=300,
    max_containers=2,
)
@modal.asgi_app()
def fastapi_app():
    """Mount server.py's FastAPI app behind the API-key check.

    server.py uses a `lifespan` handler to load models. With
    ENABLE_GENERATION=false (set on the image) it loads only the embedder and
    reranker, on CPU, exactly once per cold start.
    """
    import os
    import sys

    sys.path.insert(0, "/app")
    from server import app as inner_app  # noqa: WPS433

    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "MODEL_API_KEY is missing. Create the Modal secret with:\n"
            "  modal secret create doritos-model-auth MODEL_API_KEY=<random-key>"
        )

    inner_app.add_middleware(BearerAuthMiddleware, api_key=api_key)
    return inner_app
