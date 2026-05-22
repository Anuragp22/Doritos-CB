"""Modal deployment for SAM2 object segmentation.

Runs SAM2.1-hiera-tiny on a Modal GPU and exposes two stateless endpoints that
take an image plus point/box prompts. Kept separate from modal_app.py (the
VLM/embeddings deployment) so it stays lightweight and cold-starts fast.

Setup
-----
    pip install modal
    modal token new                          # one-time auth
    modal secret create doritos-model-auth MODEL_API_KEY=<random-key>

    modal deploy MODEL/modal_segment.py      # deploy
    modal serve  MODEL/modal_segment.py      # ephemeral dev URL, hot reload

After `modal deploy`, Modal prints a public URL. Put it in the repo-root .env:

    SEGMENT_API_URL=https://<workspace>--doritos-ai-segment-web.modal.run

Cost: gpu="T4" (~$0.59/hr); min_containers=0 scales to zero (~$0 idle);
scaledown_window keeps a container warm 5 min. Set min_containers=1 for a demo.
"""

from pathlib import Path

import modal

APP_NAME = "doritos-ai-segment"
MODEL_DIR = Path(__file__).resolve().parent
SAM2_HF_ID = "facebook/sam2.1-hiera-tiny"  # 38.9M params
HIGHLIGHT_RGB = (194, 94, 44)  # app accent; the preview-mask tint

app = modal.App(APP_NAME)

# Reuse the HF cache volume from modal_app.py so the checkpoint downloads once.
hf_cache = modal.Volume.from_name("doritos-hf-cache", create_if_missing=True)

# Lightweight image: torch + sam2 + the FastAPI bits. No VLM, no LLaMA-Factory.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .env({"SAM2_BUILD_ALLOW_ERRORS": "1"})  # skip the optional CUDA ext build
    .pip_install("torch", "torchvision")
    .pip_install("git+https://github.com/facebookresearch/sam2.git")
    .pip_install("fastapi[standard]", "pillow", "numpy", "huggingface_hub")
    .add_local_file(str(MODEL_DIR / "segment_cutout.py"), "/app/segment_cutout.py")
)


class BearerAuthMiddleware:
    """ASGI middleware requiring `Authorization: Bearer <api_key>`.

    Mirrors the middleware in modal_app.py. GET / stays public as a health /
    warm-up probe.
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
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({
            "type": "http.response.body",
            "body": b'{"error":"Invalid or missing API key"}',
        })


@app.function(
    image=image,
    gpu="T4",
    volumes={"/root/.cache/huggingface": hf_cache},
    secrets=[modal.Secret.from_name("doritos-model-auth")],
    min_containers=0,
    scaledown_window=300,
    timeout=300,
    max_containers=2,
)
@modal.asgi_app()
def web():
    """Build the segmentation FastAPI app. Runs once per container start, so
    the SAM2 model loads exactly once before the first request is served."""
    import base64
    import io
    import os
    import sys

    import numpy as np
    import torch
    from fastapi import FastAPI, HTTPException
    from PIL import Image
    from pydantic import BaseModel

    sys.path.insert(0, "/app")
    from segment_cutout import build_cutout, load_image, tight_bbox

    from sam2.sam2_image_predictor import SAM2ImagePredictor

    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "MODEL_API_KEY is missing. Create the Modal secret with:\n"
            "  modal secret create doritos-model-auth MODEL_API_KEY=<random-key>"
        )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading {SAM2_HF_ID} on {device}...")
    # Load the model once per container. Each request wraps its own predictor
    # around this shared model — set_image()/predict() mutate predictor state,
    # so one shared predictor is unsafe under concurrent requests.
    sam2_model = SAM2ImagePredictor.from_pretrained(SAM2_HF_ID, device=device).model
    print("SAM2 ready.")

    class SegmentRequest(BaseModel):
        image_b64: str
        points: list[list[float]] = []
        labels: list[int] = []
        box: list[float] | None = None

    def decode_image(image_b64: str) -> Image.Image:
        payload = image_b64
        if payload.startswith("data:") and "," in payload:
            payload = payload.split(",", 1)[1]
        try:
            raw = base64.b64decode(payload)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Bad base64 image: {exc}")
        return load_image(raw)

    def run_sam2(req: SegmentRequest):
        if not req.points and req.box is None:
            raise HTTPException(400, "Provide at least one point or a box.")
        if len(req.points) != len(req.labels):
            raise HTTPException(400, "points and labels must be equal length.")

        image_np = np.array(decode_image(req.image_b64))  # (H, W, 3) uint8 RGB
        predictor = SAM2ImagePredictor(sam2_model)
        predictor.set_image(image_np)

        coords = np.array(req.points, dtype=np.float32) if req.points else None
        labels = np.array(req.labels, dtype=np.int32) if req.labels else None
        box = np.array(req.box, dtype=np.float32) if req.box is not None else None
        # multimask only helps resolve a single ambiguous point.
        single = coords is not None and len(req.points) == 1 and box is None

        with torch.inference_mode():
            masks, scores, _ = predictor.predict(
                point_coords=coords,
                point_labels=labels,
                box=box,
                multimask_output=single,
            )
        best = int(np.argmax(scores))
        return image_np, masks[best].astype(bool), float(scores[best])

    fastapi_app = FastAPI(title="Doritos AI Segmentation")

    @fastapi_app.get("/")
    def health():
        return {"status": "running", "device": device, "model": SAM2_HF_ID}

    @fastapi_app.post("/segment/predict")
    def segment_predict(req: SegmentRequest):
        _, mask, score = run_sam2(req)
        x0, y0, x1, y1 = tight_bbox(mask)
        rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
        rgba[mask] = (*HIGHLIGHT_RGB, 255)  # accent where selected, else clear
        buf = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
        return {
            "mask_png": base64.b64encode(buf.getvalue()).decode(),
            "bbox": [x0, y0, x1, y1],
            "score": score,
        }

    @fastapi_app.post("/segment/apply")
    def segment_apply(req: SegmentRequest):
        image_np, mask, _ = run_sam2(req)
        buf = io.BytesIO()
        build_cutout(image_np, mask).save(buf, format="PNG")
        return {"cutout_png": base64.b64encode(buf.getvalue()).decode()}

    fastapi_app.add_middleware(BearerAuthMiddleware, api_key=api_key)
    return fastapi_app
