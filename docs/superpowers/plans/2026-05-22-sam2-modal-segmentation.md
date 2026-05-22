# SAM2 Object Segmentation on Modal GPU — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick an object in an uploaded image (click points and/or a drag-box); SAM2 on a Modal GPU returns the object cut out on a white background, and that cutout replaces the chat attachment.

**Architecture:** A new dedicated Modal app (`MODEL/modal_segment.py`) runs SAM2.1-hiera-tiny on a T4 GPU and exposes two stateless endpoints (`/segment/predict` → preview mask, `/segment/apply` → cutout). The Express backend proxies them under `/api/segment/*` (reading the upload from disk, base64-inlining it). A React `SegmentDialog` drives the interaction; the resulting cutout is saved to `uploads/` and reused as a normal attachment, so the chat send path is unchanged.

**Tech Stack:** Modal, SAM2 (`facebookresearch/sam2`), PyTorch, FastAPI, Pillow, numpy, Express, React 19, HTML canvas.

**Spec:** `docs/superpowers/specs/2026-05-22-sam2-modal-segmentation-design.md`

> **Conventions for every task:** commit messages are plain conventional-commit lines with **no** `Co-Authored-By` trailer. Every `git add` lists **explicit paths** — never `git add -A`/`.` — because `cv.tex`/`cv.pdf` in the repo root must never be committed. After each commit, `git push` (project convention: one push per commit).

---

## Task 1: Pure SAM2 cutout helpers

Pure numpy/Pillow image math, kept free of `modal`/`sam2` imports so it is unit-testable on its own.

**Files:**
- Create: `MODEL/segment_cutout.py`
- Test: `MODEL/test_segment_cutout.py`

- [ ] **Step 1: Write the failing test**

Create `MODEL/test_segment_cutout.py`:

```python
import unittest

import numpy as np

from segment_cutout import build_cutout, tight_bbox


class TightBboxTest(unittest.TestCase):
    def test_bounds_the_nonzero_region(self):
        mask = np.zeros((10, 10), dtype=bool)
        mask[2:5, 3:7] = True  # rows 2-4, cols 3-6
        self.assertEqual(tight_bbox(mask), (3, 2, 7, 5))

    def test_empty_mask_raises(self):
        with self.assertRaises(ValueError):
            tight_bbox(np.zeros((4, 4), dtype=bool))


class BuildCutoutTest(unittest.TestCase):
    def test_crops_to_bbox_and_keeps_object_pixels(self):
        image = np.zeros((10, 10, 3), dtype=np.uint8)
        image[:, :, 0] = 200  # solid colour
        mask = np.zeros((10, 10), dtype=bool)
        mask[4:8, 1:5] = True  # 4 rows x 4 cols

        cutout = build_cutout(image, mask)

        self.assertEqual(cutout.size, (4, 4))  # PIL size is (width, height)
        arr = np.array(cutout)
        self.assertTrue((arr[:, :, 0] == 200).all())

    def test_background_outside_mask_is_white(self):
        image = np.zeros((6, 6, 3), dtype=np.uint8)  # black image
        mask = np.zeros((6, 6), dtype=bool)
        mask[1:5, 1:5] = True
        mask[2, 2] = False  # a hole inside the bbox

        cutout = build_cutout(image, mask)
        arr = np.array(cutout)
        self.assertTrue((arr[1, 1] == 255).all())  # the hole is white
        self.assertTrue((arr[0, 0] == 0).all())    # a kept pixel stays black

    def test_mismatched_shapes_raise(self):
        with self.assertRaises(ValueError):
            build_cutout(
                np.zeros((4, 4, 3), dtype=np.uint8),
                np.zeros((5, 5), dtype=bool),
            )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd MODEL && python -m unittest test_segment_cutout -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'segment_cutout'`.
(If numpy/Pillow are missing locally: `pip install numpy pillow`.)

- [ ] **Step 3: Write the implementation**

Create `MODEL/segment_cutout.py`:

```python
"""Pure image-cutout helpers for SAM2 segmentation.

Deliberately free of `modal` and `sam2` imports so it can be unit-tested with
only numpy and Pillow installed.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps


def load_image(raw: bytes) -> Image.Image:
    """Decode image bytes to an RGB PIL image with EXIF orientation applied.

    Browsers auto-orient images via EXIF when rendering <img>, so SAM2 must see
    the same orientation or click coordinates will not line up.
    """
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def tight_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    """Return (x0, y0, x1, y1) bounding the truthy pixels of `mask`.

    x1/y1 are exclusive (suitable for array slicing and PIL crop). Raises
    ValueError when the mask has no truthy pixels.
    """
    ys, xs = np.where(mask)
    if xs.size == 0:
        raise ValueError("mask is empty")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def build_cutout(image: np.ndarray, mask: np.ndarray) -> Image.Image:
    """Composite the masked object onto white, cropped to the mask's bbox.

    `image` is an (H, W, 3) uint8 RGB array; `mask` is an (H, W) boolean array
    of the same height and width. Returns an RGB PIL image.
    """
    if image.shape[:2] != mask.shape:
        raise ValueError(
            f"image {image.shape[:2]} and mask {mask.shape} differ in size"
        )
    white = np.full_like(image, 255)
    composited = np.where(mask[:, :, None], image, white)
    x0, y0, x1, y1 = tight_bbox(mask)
    cropped = composited[y0:y1, x0:x1]
    return Image.fromarray(cropped.astype(np.uint8), mode="RGB")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd MODEL && python -m unittest test_segment_cutout -v`
Expected: PASS — 4 tests OK.

- [ ] **Step 5: Commit**

```bash
git add MODEL/segment_cutout.py MODEL/test_segment_cutout.py
git commit -m "feat(model): pure SAM2 cutout helpers"
git push
```

---

## Task 2: SAM2 segmentation Modal GPU app

The Modal deployment. Not classic TDD — verified by deploying and hitting the health endpoint.

**Files:**
- Create: `MODEL/modal_segment.py`

- [ ] **Step 1: Confirm Modal CLI and the auth secret exist**

Run:
```bash
pip install modal
modal token new        # one-time; opens a browser to authenticate
modal secret list      # check whether "doritos-model-auth" is listed
```
If `doritos-model-auth` is **not** listed, create it (pick any 32+ char random string):
```bash
modal secret create doritos-model-auth MODEL_API_KEY=<random-key>
```
Expected: `doritos-model-auth` appears in `modal secret list`.

- [ ] **Step 2: Write the Modal app**

Create `MODEL/modal_segment.py`:

```python
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
```

> **API caveat:** `SAM2ImagePredictor.from_pretrained(...)`, `.model`, the
> `SAM2ImagePredictor(sam2_model)` constructor, and the `predict(...)` kwargs
> are version-sensitive. If `modal serve` reports an `AttributeError` or a bad
> signature, check the installed `sam2` API (`python -c "import sam2,
> inspect; from sam2.sam2_image_predictor import SAM2ImagePredictor;
> print(inspect.signature(SAM2ImagePredictor.predict))"`) and adjust. The
> architecture is unaffected.

- [ ] **Step 3: Smoke-test with `modal serve`**

Run: `modal serve MODEL/modal_segment.py`
Modal prints an ephemeral URL ending in `-web.modal.run`. In another terminal:
```bash
curl https://<printed-url>/
```
Expected: the first call takes ~20–40 s (cold start downloads SAM2), then
returns `{"status":"running","device":"cuda","model":"facebook/sam2.1-hiera-tiny"}`.
Stop `modal serve` with Ctrl+C.

- [ ] **Step 4: Deploy**

Run: `modal deploy MODEL/modal_segment.py`
Expected: Modal prints a stable URL like
`https://<workspace>--doritos-ai-segment-web.modal.run`. **Copy it — Task 8
puts it in `.env` as `SEGMENT_API_URL`.**

- [ ] **Step 5: Commit**

```bash
git add MODEL/modal_segment.py
git commit -m "feat(model): SAM2 segmentation Modal GPU app"
git push
```

---

## Task 3: Backend segmentation lib helpers

Pure helpers for the segment routes, tested with `node --test`.

**Files:**
- Create: `BACKEND/lib/segment.js`
- Test: `BACKEND/lib/segment.test.js`

- [ ] **Step 1: Write the failing test**

Create `BACKEND/lib/segment.test.js`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { cutoutFilename, decodeBase64Png, segmentEnabled } from './segment.js';

test('segmentEnabled reflects SEGMENT_API_URL', () => {
  const original = process.env.SEGMENT_API_URL;
  delete process.env.SEGMENT_API_URL;
  assert.equal(segmentEnabled(), false);
  process.env.SEGMENT_API_URL = 'https://example.modal.run';
  assert.equal(segmentEnabled(), true);
  if (original === undefined) delete process.env.SEGMENT_API_URL;
  else process.env.SEGMENT_API_URL = original;
});

test('cutoutFilename keeps the base name and ends in .png', () => {
  assert.match(cutoutFilename('beach photo.jpg'),
    /^beach_photo-cutout-[a-f0-9]{12}\.png$/);
});

test('cutoutFilename is unique across calls', () => {
  assert.notEqual(cutoutFilename('a.png'), cutoutFilename('a.png'));
});

test('cutoutFilename tolerates a missing name', () => {
  assert.match(cutoutFilename(undefined), /^image-cutout-[a-f0-9]{12}\.png$/);
});

test('decodeBase64Png strips a data: URI prefix', () => {
  const raw = Buffer.from('hello');
  assert.deepEqual(
    decodeBase64Png(`data:image/png;base64,${raw.toString('base64')}`), raw);
  assert.deepEqual(decodeBase64Png(raw.toString('base64')), raw);
});

test('decodeBase64Png rejects an empty payload', () => {
  assert.throws(() => decodeBase64Png(''));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd BACKEND && node --test lib/segment.test.js`
Expected: FAIL — cannot find module `./segment.js`.

- [ ] **Step 3: Write the implementation**

Create `BACKEND/lib/segment.js`:

```javascript
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// True when the SAM2 Modal deployment is configured. The segment routes and
// the client's "Select object" button are both gated on this.
export function segmentEnabled() {
  return Boolean(process.env.SEGMENT_API_URL);
}

// Collision-resistant filename for a saved cutout: keeps the original image's
// base name and always ends in .png (cutouts are PNG).
export function cutoutFilename(originalName) {
  const name = originalName || 'image';
  const base = path.basename(name, path.extname(name));
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'image';
  return `${safe}-cutout-${randomBytes(6).toString('hex')}.png`;
}

// Decode a base64 PNG payload (with or without a data: URI prefix) to a Buffer.
export function decodeBase64Png(payload) {
  if (typeof payload !== 'string' || !payload) {
    throw new Error('cutout payload is empty');
  }
  const comma = payload.indexOf(',');
  const b64 = payload.startsWith('data:') && comma !== -1
    ? payload.slice(comma + 1)
    : payload;
  return Buffer.from(b64, 'base64');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd BACKEND && node --test lib/segment.test.js`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add BACKEND/lib/segment.js BACKEND/lib/segment.test.js
git commit -m "feat(backend): segmentation lib helpers"
git push
```

---

## Task 4: Backend segmentation proxy routes

Add four `/api/segment/*` routes to `BACKEND/index.js`. They reuse the existing
`imageUrlToInline` helper (already in the file, ~line 254) and `requireAuth`.

**Files:**
- Modify: `BACKEND/index.js`

- [ ] **Step 1: Add the import**

In `BACKEND/index.js`, immediately after the existing line
`import { enqueueIngest } from './lib/ingest.js';` add:

```javascript
import { segmentEnabled, cutoutFilename, decodeBase64Png } from './lib/segment.js';
```

- [ ] **Step 2: Add the segmentation routes**

In `BACKEND/index.js`, find the `/api/generate` route handler (it ends with a
closing `});`). Immediately **after** it, and **before** the multer error
handler `app.use((err, req, res, next) => { ... })`, insert:

```javascript
// ─── SAM2 segmentation ────────────────────────────────────────────────
// Proxies to the SAM2 Modal GPU deployment. When SEGMENT_API_URL is unset the
// feature reports disabled and the client hides the "Select object" button.

async function callSegment(endpointPath, body) {
  const base = process.env.SEGMENT_API_URL.replace(/\/$/, '');
  const res = await fetch(`${base}${endpointPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MODEL_API_KEY || ''}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Segmentation service ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

// Resolve a /uploads/* URL to an inlined data: URI, or null if it cannot.
async function inlineUploadOrNull(imageUrl) {
  if (!imageUrl) return null;
  const inline = await imageUrlToInline(imageUrl);
  return inline && inline.startsWith('data:') ? inline : null;
}

app.get('/api/segment/status', requireAuth, (req, res) => {
  res.json({ enabled: segmentEnabled() });
});

app.post('/api/segment/warmup', requireAuth, (req, res) => {
  if (!segmentEnabled()) {
    return res.status(503).json({ error: 'Segmentation is not configured' });
  }
  const base = process.env.SEGMENT_API_URL.replace(/\/$/, '');
  // Fire-and-forget: boots a cold Modal container while the user aims.
  fetch(`${base}/`, { signal: AbortSignal.timeout(2000) }).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/segment/predict', requireAuth, async (req, res) => {
  if (!segmentEnabled()) {
    return res.status(503).json({ error: 'Segmentation is not configured' });
  }
  try {
    const { imageUrl, points = [], labels = [], box = null } = req.body;
    const inline = await inlineUploadOrNull(imageUrl);
    if (!inline) {
      return res.status(400).json({ error: 'imageUrl did not resolve to an image' });
    }
    const result = await callSegment('/segment/predict', {
      image_b64: inline, points, labels, box,
    });
    res.json(result);
  } catch (err) {
    console.error('Segment predict error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/segment/apply', requireAuth, async (req, res) => {
  if (!segmentEnabled()) {
    return res.status(503).json({ error: 'Segmentation is not configured' });
  }
  try {
    const { imageUrl, points = [], labels = [], box = null } = req.body;
    const inline = await inlineUploadOrNull(imageUrl);
    if (!inline) {
      return res.status(400).json({ error: 'imageUrl did not resolve to an image' });
    }
    const { cutout_png } = await callSegment('/segment/apply', {
      image_b64: inline, points, labels, box,
    });
    const filename = cutoutFilename(imageUrl);
    await fs.writeFile(
      path.join(__dirname, 'uploads', filename),
      decodeBase64Png(cutout_png),
    );
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
    res.json({ fileUrl });
  } catch (err) {
    console.error('Segment apply error:', err.message);
    res.status(502).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify the backend starts and the disabled path works**

Run (with `SEGMENT_API_URL` NOT set in `BACKEND/.env`):
```bash
cd BACKEND && npm start
```
Expected: the server starts with no errors. The route is wired — without an
auth cookie `GET /api/segment/status` returns `401` (proves `requireAuth` is
attached); the full enabled path is verified end-to-end in Task 8. Stop the
server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add BACKEND/index.js
git commit -m "feat(backend): SAM2 segmentation proxy routes"
git push
```

---

## Task 5: Frontend coordinate helpers

Pure functions mapping pointer positions to image-pixel space. `CLIENT` is an
ESM package (`"type": "module"`), so `node --test` runs the test directly — no
test-runner dependency needed.

**Files:**
- Create: `CLIENT/src/components/segment/coords.js`
- Test: `CLIENT/src/components/segment/coords.test.js`

- [ ] **Step 1: Write the failing test**

Create `CLIENT/src/components/segment/coords.test.js`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { toBox, toNaturalPoint } from './coords.js';

test('toNaturalPoint scales display pixels to natural pixels', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const natural = { width: 1000, height: 500 };
  assert.deepEqual(toNaturalPoint(50, 50, rect, natural), { x: 500, y: 250 });
});

test('toNaturalPoint accounts for the element offset', () => {
  const rect = { left: 20, top: 10, width: 100, height: 100 };
  const natural = { width: 200, height: 200 };
  assert.deepEqual(toNaturalPoint(70, 60, rect, natural), { x: 100, y: 100 });
});

test('toNaturalPoint clamps to the image bounds', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const natural = { width: 1000, height: 500 };
  assert.deepEqual(toNaturalPoint(200, -10, rect, natural), { x: 999, y: 0 });
});

test('toBox normalises a drag into x0<x1, y0<y1', () => {
  assert.deepEqual(toBox({ x: 80, y: 90 }, { x: 10, y: 20 }), [10, 20, 80, 90]);
  assert.deepEqual(toBox({ x: 5, y: 5 }, { x: 25, y: 35 }), [5, 5, 25, 35]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd CLIENT && node --test src/components/segment/coords.test.js`
Expected: FAIL — cannot find module `./coords.js`.

- [ ] **Step 3: Write the implementation**

Create `CLIENT/src/components/segment/coords.js`:

```javascript
function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

// Map a pointer position (clientX/clientY) to the image's natural pixel
// coordinates. `rect` is the image element's getBoundingClientRect(); `natural`
// is { width, height } from naturalWidth/naturalHeight.
export function toNaturalPoint(clientX, clientY, rect, natural) {
  const x = ((clientX - rect.left) / rect.width) * natural.width;
  const y = ((clientY - rect.top) / rect.height) * natural.height;
  return {
    x: clamp(Math.round(x), 0, natural.width - 1),
    y: clamp(Math.round(y), 0, natural.height - 1),
  };
}

// Normalise two natural-space points from a drag into [x0, y0, x1, y1] with
// x0 < x1 and y0 < y1.
export function toBox(a, b) {
  return [
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd CLIENT && node --test src/components/segment/coords.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add CLIENT/src/components/segment/coords.js CLIENT/src/components/segment/coords.test.js
git commit -m "feat(client): segmentation coordinate helpers"
git push
```

---

## Task 6: SegmentDialog object-selection UI

The interactive dialog: an image with an overlay canvas for click/box prompts
and a live mask preview. Verified manually in Task 8.

**Files:**
- Create: `CLIENT/src/components/segment/SegmentDialog.jsx`

- [ ] **Step 1: Write the component**

Create `CLIENT/src/components/segment/SegmentDialog.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toBox, toNaturalPoint } from './coords';

const API = import.meta.env.VITE_API_URL;
const HIGHLIGHT = 'rgb(194, 94, 44)'; // app accent — matches the Modal mask tint
const DRAG_THRESHOLD = 6; // px of movement that turns a click into a box drag

// Draw the selection box and point markers onto the overlay canvas, in the
// image's natural-pixel coordinate space.
function paintShapes(ctx, natural, points, box) {
  const unit = Math.max(natural.width, natural.height);
  if (box) {
    ctx.lineWidth = unit / 300;
    ctx.strokeStyle = HIGHLIGHT;
    ctx.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  }
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, unit / 90, 0, Math.PI * 2);
    ctx.fillStyle = p.label === 1 ? HIGHLIGHT : '#ffffff';
    ctx.fill();
    ctx.lineWidth = unit / 400;
    ctx.strokeStyle = p.label === 1 ? '#ffffff' : HIGHLIGHT;
    ctx.stroke();
  }
}

export default function SegmentDialog({ open, onOpenChange, imageUrl, onApply }) {
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);       // { startClient, startNatural, shift, moved }
  const predictAbort = useRef(null);
  const maskImgRef = useRef(null);    // loaded HTMLImageElement of the mask

  const [natural, setNatural] = useState(null); // { width, height }
  const [points, setPoints] = useState([]);     // [{ x, y, label }]
  const [box, setBox] = useState(null);         // [x0,y0,x1,y1] | null
  const [maskUrl, setMaskUrl] = useState(null); // data: URL of the RGBA mask
  const [busy, setBusy] = useState(false);

  // Warm the Modal container the moment the dialog opens.
  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/segment/warmup`, { method: 'POST', credentials: 'include' })
      .catch(() => {});
  }, [open]);

  // Reset all selection state when the dialog opens or the image changes.
  useEffect(() => {
    if (!open) return;
    setPoints([]);
    setBox(null);
    setMaskUrl(null);
    setNatural(null);
    maskImgRef.current = null;
  }, [open, imageUrl]);

  // Draw the mask + shapes onto the canvas (natural-pixel space).
  const draw = useCallback((liveBox) => {
    const canvas = canvasRef.current;
    if (!canvas || !natural) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (maskImgRef.current) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(maskImgRef.current, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    paintShapes(ctx, natural, points, liveBox ?? box);
  }, [natural, points, box]);

  useEffect(() => { draw(); }, [draw]);

  // Load the mask PNG into a ref so draw() can paint it synchronously.
  useEffect(() => {
    if (!maskUrl) { maskImgRef.current = null; draw(); return; }
    const m = new Image();
    m.onload = () => { maskImgRef.current = m; draw(); };
    m.src = maskUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskUrl]);

  const runPredict = useCallback(async (nextPoints, nextBox) => {
    if (nextPoints.length === 0 && !nextBox) { setMaskUrl(null); return; }
    predictAbort.current?.abort();
    const ctl = new AbortController();
    predictAbort.current = ctl;
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/segment/predict`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({
          imageUrl,
          points: nextPoints.map((p) => [p.x, p.y]),
          labels: nextPoints.map((p) => p.label),
          box: nextBox,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Prediction failed');
      setMaskUrl(`data:image/png;base64,${data.mask_png}`);
    } catch (err) {
      if (err.name !== 'AbortError') toast.error(err.message);
    } finally {
      if (predictAbort.current === ctl) setBusy(false);
    }
  }, [imageUrl]);

  const onPointerDown = (e) => {
    if (!natural) return;
    const rect = imgRef.current.getBoundingClientRect();
    dragRef.current = {
      startClient: { x: e.clientX, y: e.clientY },
      startNatural: toNaturalPoint(e.clientX, e.clientY, rect, natural),
      shift: e.shiftKey,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !natural) return;
    const dx = e.clientX - drag.startClient.x;
    const dy = e.clientY - drag.startClient.y;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) drag.moved = true;
    if (drag.moved) {
      const rect = imgRef.current.getBoundingClientRect();
      const now = toNaturalPoint(e.clientX, e.clientY, rect, natural);
      draw(toBox(drag.startNatural, now));
    }
  };

  const onPointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !natural) return;
    const rect = imgRef.current.getBoundingClientRect();
    const end = toNaturalPoint(e.clientX, e.clientY, rect, natural);
    if (drag.moved) {
      const nextBox = toBox(drag.startNatural, end);
      setBox(nextBox);
      runPredict(points, nextBox);
    } else {
      const nextPoints = [...points, { ...end, label: drag.shift ? 0 : 1 }];
      setPoints(nextPoints);
      runPredict(nextPoints, box);
    }
  };

  const reset = () => {
    predictAbort.current?.abort();
    setPoints([]);
    setBox(null);
    setMaskUrl(null);
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/segment/apply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          points: points.map((p) => [p.x, p.y]),
          labels: points.map((p) => p.label),
          box,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cutout failed');
      onApply(data.fileUrl);
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const hasSelection = points.length > 0 || Boolean(box);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select an object</DialogTitle>
          <DialogDescription>
            Click the object to select it, or drag a box around it.
            Shift-click to exclude a region.
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-lg border">
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Segment source"
            className="block w-full select-none"
            draggable={false}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
          />
          {natural && (
            <canvas
              ref={canvasRef}
              width={natural.width}
              height={natural.height}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 text-sm">
              Working…
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={reset}
                  disabled={busy || !hasSelection}>
            Reset
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}
                  disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={busy || !maskUrl}>
            Use selection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd CLIENT && npm run build`
Expected: the Vite build succeeds with no errors referencing `SegmentDialog`
or `coords`. (The component is not yet rendered anywhere — Task 7 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add CLIENT/src/components/segment/SegmentDialog.jsx
git commit -m "feat(client): SegmentDialog object-selection UI"
git push
```

---

## Task 7: Wire SegmentDialog into the composer

Add the "Select object" button to the image preview, render `SegmentDialog`,
and keep the original image so the cutout is revertible.

**Files:**
- Modify: `CLIENT/src/components/upload/upload.jsx`
- Modify: `CLIENT/src/components/newPrompt/NewPrompt.jsx`
- Modify: `CLIENT/src/Routes/ChatPage/chatPage.css`

- [ ] **Step 1: Record the original image path on upload**

In `CLIENT/src/components/upload/upload.jsx`, inside `sendFile`'s success
branch, change:

```javascript
      setImg((prev) => ({
        ...prev,
        isLoading: false,
        dbData: { filePath: data.fileUrl },
      }));
```

to:

```javascript
      setImg((prev) => ({
        ...prev,
        isLoading: false,
        dbData: { filePath: data.fileUrl, originalPath: data.fileUrl },
      }));
```

- [ ] **Step 2: Update the imports in NewPrompt.jsx**

In `CLIENT/src/components/newPrompt/NewPrompt.jsx`, change the lucide import:

```javascript
import { ArrowUp, Square } from 'lucide-react';
```

to:

```javascript
import { ArrowUp, Square, Scissors, Undo2 } from 'lucide-react';
```

And add, after the existing `import Upload from '@/components/upload/upload';`:

```javascript
import SegmentDialog from '@/components/segment/SegmentDialog';
```

- [ ] **Step 3: Add segmentation state and the status check**

In `NewPrompt.jsx`, inside `useNewPrompt`, after the existing
`const [img, setImg] = useState(...)` line, add:

```javascript
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [segmentEnabled, setSegmentEnabled] = useState(false);
```

Then, after the existing `useEffect(() => () => controllerRef.current?.abort(), []);`
line, add:

```javascript
  useEffect(() => {
    fetch(`${API}/api/segment/status`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setSegmentEnabled(Boolean(d.enabled)))
      .catch(() => setSegmentEnabled(false));
  }, []);
```

- [ ] **Step 4: Render the button and the dialog**

In `NewPrompt.jsx`, inside the `streamingTurn` JSX, replace this block:

```jsx
      {img.dbData?.filePath && (
        <div className="dispatch-turn--user">
          <img
            src={img.dbData.filePath}
            alt="Uploaded preview"
            className="dispatch-pending-image"
          />
        </div>
      )}
```

with:

```jsx
      {img.dbData?.filePath && (
        <div className="dispatch-turn--user">
          <div className="dispatch-pending">
            <img
              src={img.dbData.filePath}
              alt="Uploaded preview"
              className="dispatch-pending-image"
            />
            {segmentEnabled && (
              <div className="dispatch-pending-tools">
                <button type="button" onClick={() => setSegmentOpen(true)}>
                  <Scissors className="size-3.5" /> Select object
                </button>
                {img.dbData.originalPath &&
                  img.dbData.filePath !== img.dbData.originalPath && (
                    <button
                      type="button"
                      onClick={() =>
                        setImg((prev) => ({
                          ...prev,
                          dbData: {
                            ...prev.dbData,
                            filePath: prev.dbData.originalPath,
                          },
                        }))
                      }
                    >
                      <Undo2 className="size-3.5" /> Revert
                    </button>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
      {img.dbData?.originalPath && (
        <SegmentDialog
          open={segmentOpen}
          onOpenChange={setSegmentOpen}
          imageUrl={img.dbData.originalPath}
          onApply={(cutoutUrl) =>
            setImg((prev) => ({
              ...prev,
              dbData: { ...prev.dbData, filePath: cutoutUrl },
            }))
          }
        />
      )}
```

- [ ] **Step 5: Add the styles**

Append to `CLIENT/src/Routes/ChatPage/chatPage.css`:

```css
/* Image preview tools (SAM2 object selection) */
.dispatch-pending {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.dispatch-pending-tools {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}
.dispatch-pending-tools button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: var(--ink-muted);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  transition: background-color 120ms ease, color 120ms ease;
}
.dispatch-pending-tools button:hover {
  background: rgba(26, 34, 56, 0.06);
  color: var(--ink);
}
```

- [ ] **Step 6: Verify it builds**

Run: `cd CLIENT && npm run build`
Expected: the Vite build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add CLIENT/src/components/upload/upload.jsx CLIENT/src/components/newPrompt/NewPrompt.jsx CLIENT/src/Routes/ChatPage/chatPage.css
git commit -m "feat(client): wire SegmentDialog into the composer"
git push
```

---

## Task 8: Configuration, docs, and end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document the env var**

In `.env.example`, find the existing model-related entries (near `EMBED_API_URL`
/ `MODEL_API_KEY`). Add:

```
# SAM2 object segmentation (Modal GPU). Blank = feature disabled.
# Paste the URL printed by `modal deploy MODEL/modal_segment.py`.
SEGMENT_API_URL=
```

If `MODEL_API_KEY` is not already present in `.env.example`, also add:

```
# Bearer key for the Modal deployments (segmentation + model). Must match the
# MODEL_API_KEY in the `doritos-model-auth` Modal secret.
MODEL_API_KEY=
```

- [ ] **Step 2: Document the feature in the README**

In `README.md`, add this subsection immediately before the `## Project layout`
section:

```markdown
### Optional: object segmentation (SAM2)

Attaching an image and selecting just one object uses **SAM2** on a Modal GPU.
It is optional — with `SEGMENT_API_URL` blank the app runs normally and the
"Select object" button is hidden.

```powershell
pip install modal
modal token new
# one-time, if not already created for the model deploy:
modal secret create doritos-model-auth MODEL_API_KEY=<random-key>

modal deploy MODEL/modal_segment.py
```

Paste the printed URL into `SEGMENT_API_URL` in `.env`, and set the same
`MODEL_API_KEY` there. The GPU is a T4 (~$0.59/hr) and scales to zero when
idle, so it costs roughly nothing between sessions.
```

- [ ] **Step 3: Commit the docs**

```bash
git add .env.example README.md
git commit -m "docs: document SAM2 segmentation setup"
git push
```

- [ ] **Step 4: Configure and start the full stack**

Ensure `.env` (repo root) has `SEGMENT_API_URL` set to the Modal URL from
Task 2 Step 4 and `MODEL_API_KEY` set to the value in the `doritos-model-auth`
secret. Then:

```bash
docker compose up -d --build backend client
```

- [ ] **Step 5: Verify the enabled path end-to-end**

1. Open the app, sign in, open a chat.
2. Attach an image with a clear object — the **"Select object"** button appears
   under the preview.
3. Click it → the dialog opens and fires the warm-up ping.
4. Click on the object → within ~1 s on a warm container an accent-tinted mask
   overlays it. (The first click after a cold start may take 15–40 s.)
5. Drag a box around a different object → the mask refines to it.
6. Shift-click a region inside the mask → that region is excluded.
7. Click **Use selection** → the dialog closes and the preview swaps to the
   tight cutout (the object on a white background).
8. A **Revert** button is now shown; clicking it restores the original image.
9. Send the turn → the model's answer concerns the selected object only.

- [ ] **Step 6: Verify the disabled path**

1. Blank out `SEGMENT_API_URL` in `.env` and run `docker compose up -d backend`.
2. Reload the app and attach an image → the "Select object" button is **absent**.
3. Restore `SEGMENT_API_URL` and `docker compose up -d backend` again.

- [ ] **Step 7: Run the full test suite**

```bash
cd MODEL && python -m unittest test_segment_cutout -v
cd ../BACKEND && npm test
cd ../CLIENT && node --test src/components/segment/coords.test.js
```
Expected: all tests pass.

---

## Self-Review

**Spec coverage:**
- `modal_segment.py` dedicated Modal app, T4, scale-to-zero, HF-cache volume, Bearer auth → Task 2.
- Stateless `/segment/predict` (RGBA mask) and `/segment/apply` (white-bg cutout) → Task 2.
- Per-request predictor over a shared model (concurrency) → Task 2, Step 2.
- EXIF orientation handling → Task 1 (`load_image`).
- Express `/api/segment/{status,warmup,predict,apply}`; `apply` saves to `uploads/` and returns a file URL → Task 4.
- Feature disabled when `SEGMENT_API_URL` is unset → Tasks 4, 7, 8.
- `SegmentDialog` with click + box + Shift-exclude, live mask, warm-up on open → Task 6.
- Stale-prediction abort → Task 6 (`predictAbort`).
- "Select object" button + original-image preservation + revert → Task 7.
- Config + README → Task 8.
- Local CPU stack / `MODEL/Dockerfile` untouched → confirmed: no task modifies them.

**Placeholder scan:** no TBD/TODO; every code step contains complete code.

**Type consistency:** request shape `{ image_b64, points, labels, box }` (Modal)
and `{ imageUrl, points, labels, box }` (Express) are consistent across Tasks
2/4/6. `tight_bbox`/`build_cutout`/`load_image` exported by Task 1 are imported
by Task 2. `segmentEnabled`/`cutoutFilename`/`decodeBase64Png` exported by Task
3 are imported by Task 4. `toNaturalPoint`/`toBox` exported by Task 5 are
imported by Task 6. `mask_png`/`cutout_png`/`fileUrl` response keys match
between Modal, Express, and the client.
