"""Modal deployment wrapper for the Doritos AI inference server.

Hosts MODEL/server.py as a serverless GPU FastAPI app on Modal. Defaults to the
official AWQ 4-bit quantized Qwen2-VL-2B-Instruct so cold starts and per-second
GPU cost are minimised.

Usage
-----

    pip install modal
    modal token new                       # one-time auth
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
    min_containers=0,
    scaledown_window=300,
    timeout=600,
    max_containers=2,
)
@modal.asgi_app()
def fastapi_app():
    """Mounts the existing FastAPI app from server.py.

    server.py uses a `lifespan` handler to load the VLM, embedder, and
    reranker, so all models load exactly once per cold start, before the
    first request is served.
    """
    import os
    import sys

    os.environ.setdefault("MODEL_ID", DEFAULT_MODEL_ID)
    sys.path.insert(0, "/app")
    from server import app as inner_app  # noqa: WPS433

    return inner_app
