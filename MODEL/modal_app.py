"""Modal deployment wrapper for the Doritos AI inference server.

Hosts MODEL/server.py as a serverless GPU FastAPI app on Modal. Defaults to the
official AWQ 4-bit quantized Qwen2-VL-2B-Instruct so cold starts and per-second
GPU cost are minimised.

The deployment is gated by a Bearer-token API key so a publicly routable URL
can't be used by random scrapers to run up GPU spend.

Setup
-----

    pip install modal
    modal token new                       # one-time auth

    # Create the API-key secret. Do this BEFORE the first deploy.
    # Pick any 32+ character random string (or use openssl rand -hex 32).
    modal secret create doritos-model-auth MODEL_API_KEY=<random-key>

    # Add the same key to the repo-root .env so the backend sends it:
    #   MODEL_API_KEY=<the-same-key>

    modal deploy MODEL/modal_app.py       # deploy
    modal serve MODEL/modal_app.py        # ephemeral dev URL with hot-reload

After `modal deploy`, Modal prints a public URL. Point the Express backend at it:

    QWEN_API_URL=https://<workspace>--doritos-ai-model-fastapi-app.modal.run/generate
    QWEN_STREAM_URL=https://<workspace>--doritos-ai-model-fastapi-app.modal.run/generate/stream
    EMBED_API_URL=https://<workspace>--doritos-ai-model-fastapi-app.modal.run/embed
    RERANK_API_URL=https://<workspace>--doritos-ai-model-fastapi-app.modal.run/rerank

Cost / efficiency knobs
-----------------------
- `gpu="T4"` (16 GB, ~$0.59/hr) is plenty for 2B-AWQ. Switch to `"A10G"` only if
  you measure latency that's actually a problem or plan to swap in 7B-AWQ.
- `min_containers=0` lets the app scale to zero and cost ~$0 when idle.
  Set `min_containers=1` during a demo to eliminate cold starts.
- `scaledown_window=300` keeps a container warm for 5 min after the last
  request, so back-to-back chat turns stay on a hot GPU.
- The Modal Volume mounted at `~/.cache/huggingface` persists model weights
  across cold starts so we never re-download Qwen2-VL or BGE.
"""

from pathlib import Path

import modal

APP_NAME = "doritos-ai-model"
MODEL_DIR = Path(__file__).resolve().parent

# Official AWQ 4-bit checkpoint. ~1.5 GB on disk, ~3 GB VRAM at runtime.
# Override via the MODEL_ID env var (e.g. for the unquantized 2B or a 7B-AWQ).
DEFAULT_MODEL_ID = "Qwen/Qwen2-VL-2B-Instruct-AWQ"

app = modal.App(APP_NAME)

# Persistent volume for HuggingFace cache. Survives container restarts so the
# VLM, embedder, and reranker download once and never again.
hf_cache = modal.Volume.from_name("doritos-hf-cache", create_if_missing=True)

# Container image: same Python deps as the local MODEL service, plus autoawq
# for the quantized model kernels.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(str(MODEL_DIR / "requirements.txt"))
    .pip_install("autoawq>=0.2.6")
    .add_local_dir(str(MODEL_DIR), "/app")
)


@app.function(
    image=image,
    gpu="T4",
    volumes={"/root/.cache/huggingface": hf_cache},
    secrets=[modal.Secret.from_name("doritos-model-auth")],
    min_containers=0,
    scaledown_window=300,
    timeout=600,
    max_containers=2,
)
@modal.asgi_app()
def fastapi_app():
    """Mounts the existing FastAPI app from server.py behind an API-key check.

    server.py uses a `lifespan` handler to load the VLM, embedder, and
    reranker, so all models load exactly once per cold start, before the
    first request is served.
    """
    import os
    import sys

    os.environ.setdefault("MODEL_ID", DEFAULT_MODEL_ID)
    sys.path.insert(0, "/app")
    from server import app as inner_app  # noqa: WPS433

    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "MODEL_API_KEY is missing. Create the Modal Secret with:\n"
            "  modal secret create doritos-model-auth MODEL_API_KEY=<random-key>"
        )

    inner_app.add_middleware(BearerAuthMiddleware, api_key=api_key)
    return inner_app


class BearerAuthMiddleware:
    """ASGI middleware that requires `Authorization: Bearer <api_key>`.

    Implemented at the ASGI layer (rather than as a FastAPI middleware) so
    streaming SSE responses pass through without buffering. The health probe
    at GET / stays public so external monitoring can ping it.
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
