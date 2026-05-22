# SAM2 Object Segmentation on Modal GPU — Design

**Date:** 2026-05-22
**Status:** Approved (brainstorming) — pending implementation plan

## Problem

When a user attaches an image to a chat turn, the whole image is inlined and
sent to the vision model. There is no way to point the model at one object in a
busy photo. We want the user to **pick an object in the image and send only
that object** to the model.

## Goal

Integrate Meta's **SAM2** (Segment Anything Model 2) so a user can select an
object by clicking and/or dragging a box over an uploaded image. SAM2 returns a
precise mask; the selected object is cut out (background removed, cropped tight)
and that cutout replaces the attachment for the chat turn.

SAM2 runs on **GPU via Modal** — not on the CPU-only local host.

## Non-goals (v1)

- **No video segmentation.** SAM2's video predictor is out of scope.
- **One object per cutout.** Multi-object union compositing is a later extension.
- **The cutout is not persisted as reasoning/metadata.** It is just an uploaded
  image, indistinguishable from any other attachment once applied.
- **The local CPU stack cannot segment.** Segmentation requires the Modal
  deployment to be live and reachable. This was an explicit, accepted trade-off
  (the alternative — SAM2 on the CPU host — was rejected for being too slow).

**Assumption:** sending "only the object" is only useful if the configured
generation model is vision-capable. This feature changes *what image* is sent,
not *which model* receives it — wiring up or verifying the vision model is a
separate concern.

## Why Modal GPU (and what it simplifies)

Running SAM2 on a GPU rather than the CPU host removes two problems from the
design:

1. **No server-side state.** On CPU, `set_image()` (the image encode) takes
   2–8 s, which would force an encode-once / cache-predictor / decode-per-click
   architecture — and that cache breaks under Modal autoscaling. On a T4,
   `set_image()` is ~100 ms, so every request can encode+decode in one shot.
   The service is **stateless**: no `image_id`, no LRU, no cache-miss bugs.
2. **No local dependency conflict.** SAM2 requires `torch >= 2.5.1`; the local
   `MODEL` container is pinned to `torch 2.4.0`. Because SAM2 never runs in that
   container, `MODEL/Dockerfile` and `MODEL/requirements.txt` are untouched.

## Architecture

```
  Browser
    │  attach image  (existing POST /upload — unchanged)
    ▼
  CLIENT ── SegmentDialog ───────────┐
    │  click points / drag box       │  /api/segment/{status,warmup,predict,apply}
    ▼                                ▼
  BACKEND (Express)
    │  reads uploads/, base64-inlines the image
    │  forwards to Modal with Bearer MODEL_API_KEY
    │  apply: decodes cutout, writes uploads/<name>-cutout-<rand>.png
    │                                │
    │                                ▼
    │                  Modal GPU  —  MODEL/modal_segment.py
    │                  SAM2.1-hiera-tiny on a T4, scale-to-zero
    │                    POST /segment/predict → mask
    │                    POST /segment/apply   → cutout
    ▼
  cutout becomes the attachment → existing chat flow → vision model
```

The integration is deliberately shallow: `apply` returns a normal `/uploads/*`
URL, so **the chat send path needs zero changes** — the cutout is just another
uploaded image.

## Components

### 1. `MODEL/modal_segment.py` — dedicated Modal deployment (new file)

A standalone Modal app for SAM2, separate from `modal_app.py` so it stays
lightweight (no VLM, no LLaMA-Factory → fast cold starts, independent
scale-to-zero). It mirrors `modal_app.py`'s conventions.

- **Image:** `modal.Image.debian_slim(python_version="3.11")`, `apt_install("git")`,
  then `pip_install` of `torch` + `torchvision` (CUDA wheels), then
  `sam2` from `git+https://github.com/facebookresearch/sam2.git` (its optional
  CUDA extension build is skip-safe on a runtime image), then `fastapi`,
  `uvicorn`, `pillow`, `numpy`, `huggingface_hub`. Order matters: SAM2's
  `setup.py` imports `torch`, so torch is installed in an earlier layer.
- **App & volume:** `modal.App("doritos-ai-segment")` — a distinct app name so
  it deploys independently of `modal_app.py`'s `doritos-ai-model`. It reuses the
  existing `doritos-hf-cache` `Volume`
  (`Volume.from_name("doritos-hf-cache", create_if_missing=True)`) for the
  checkpoint cache.
- **Function:** `@app.function(gpu="T4", min_containers=0, scaledown_window=300,
  timeout=300, volumes={"/root/.cache/huggingface": hf_cache},
  secrets=[Secret.from_name("doritos-model-auth")])` exposing an
  `@modal.asgi_app()` FastAPI app.
- **Model loading & concurrency:** the SAM2.1-hiera-tiny model is built **once
  per container** in the FastAPI `lifespan` handler — weights pulled from the
  HuggingFace Hub (`facebook/sam2.1-hiera-tiny`) into the `Volume`, so cold
  starts re-download nothing. Each request then wraps a **fresh
  `SAM2ImagePredictor` around that shared model**: `set_image()`/`predict()`
  mutate predictor state, so a per-request predictor keeps concurrent requests
  from corrupting each other. Constructing a predictor over an already-loaded
  model is cheap.
- **Input orientation:** images are decoded with `PIL.ImageOps.exif_transpose`
  applied, so SAM2's pixel space matches the browser's auto-oriented `<img>`
  display — otherwise clicks on an EXIF-rotated phone photo would hit the wrong
  pixels.
- **Auth:** reuses the existing `BearerAuthMiddleware` pattern and the
  `doritos-model-auth` secret (`MODEL_API_KEY`). `GET /` stays public as a
  health probe / warm-up target.
- **Cutout helper:** a pure function `build_cutout(image, mask, bbox)` —
  composites the masked object onto a **white background**, converts to RGB,
  crops to the mask's tight bounding box. Pure and unit-testable.

Endpoints (stateless — each call gets the full image):

**`POST /segment/predict`** — live mask preview.
Request:
```json
{
  "image_b64": "<base64 PNG/JPEG of the original image>",
  "points": [[x, y], ...],
  "labels": [1, 0, ...],
  "box": [x0, y0, x1, y1]
}
```
- Coordinates are in the **original image's pixel space**.
- `labels`: `1` = include point, `0` = exclude point. Same length as `points`.
- `box` is optional; `points`/`labels` may be empty. At least one of a point or
  a box must be present, else `400`.
- SAM2 runs with `multimask_output=True` only for the single-positive-point /
  no-box / no-negative case (ambiguity resolution); otherwise `False`. The
  highest-confidence mask is selected.

Response:
```json
{
  "mask_png": "<base64 RGBA PNG: accent color where selected, transparent elsewhere, full original-image size>",
  "bbox": [x0, y0, x1, y1],
  "score": 0.97
}
```

**`POST /segment/apply`** — final cutout. Same request shape. Response:
```json
{ "cutout_png": "<base64 PNG, RGB, object on white background, cropped to bbox>" }
```

> **Note:** the exact SAM2 API (`from_pretrained` signature, how to get the
> underlying model for a per-request predictor, the precise `predict` kwargs) is
> version-sensitive — it gets pinned at implementation time against the `sam2`
> commit the Modal image installs. The architecture above holds regardless.

### 2. Express backend — segmentation proxy routes

New `requireAuth` routes in `BACKEND/index.js`. They resolve the upload to a
file, base64-inline it (Modal cannot reach back into the local network — the
same reasoning as the existing `imageUrlToInline`), and forward to Modal with
the Bearer key.

- **`GET /api/segment/status`** → `{ "enabled": <boolean> }` — `true` when
  `SEGMENT_API_URL` is set. The client uses this to show/hide the feature.
- **`POST /api/segment/warmup`** → fires `GET /` at the Modal URL
  fire-and-forget (short timeout, result ignored) to boot a cold container.
  Returns `{ "ok": true }`.
- **`POST /api/segment/predict`** — body `{ imageUrl, points, labels, box }`.
  `imageUrl` is an existing `/uploads/*` URL. Inlines the file, forwards to
  Modal `/segment/predict`, returns Modal's `{ mask_png, bbox, score }`.
- **`POST /api/segment/apply`** — body `{ imageUrl, points, labels, box }`.
  Forwards to Modal `/segment/apply`, decodes `cutout_png`, writes it to
  `uploads/<originalname>-cutout-<rand>.png`, returns `{ fileUrl }`.

If `SEGMENT_API_URL` is unset, `status` reports `enabled: false` and the
predict/apply/warmup routes return `503`.

### 3. Frontend — `SegmentDialog` component (new file)

A new `CLIENT/src/components/segment/SegmentDialog.jsx` built on the existing
`Dialog` primitive (the same one the webcam capture uses).

- **Entry point:** in `NewPrompt.jsx`, the image-preview block in
  `streamingTurn` gains a **"Select object"** button (only rendered when
  `/api/segment/status` reports `enabled`). Clicking it opens `SegmentDialog`
  with the **original** image URL.
- **The original image is preserved.** `img.dbData` keeps `originalPath`
  alongside `filePath`; the dialog always operates on `originalPath`, so the
  user can re-open and re-segment even after applying. A "revert to original"
  affordance restores `filePath = originalPath`.
- **Canvas:** the image is drawn on a canvas (or an `<img>` with an overlaid
  `<canvas>` for the mask). Click coordinates are mapped from displayed pixels
  to the image's natural pixels before sending; the returned `mask_png` is
  natural-size and scaled back down for display.
- **Interaction (both prompt types):**
  - A click (movement below a threshold) adds a **positive point**;
    **Shift+click** adds a **negative point**.
  - A click-drag sets the **box**.
  - Each interaction triggers `POST /api/segment/predict` with the accumulated
    `points` / `labels` / `box`; the returned mask is drawn as a
    semi-transparent colored overlay.
  - Rapid interactions are sequenced: an in-flight `predict` is aborted (its
    response discarded) when a newer one starts, so a stale mask never
    overwrites a fresh one — the same `AbortController` pattern `NewPrompt`
    already uses for streaming.
- **Controls:** **Use selection** (calls `apply`, disabled until a mask
  exists), **Reset** (clears points/box/mask), **Cancel**.
- **On open:** fires `POST /api/segment/warmup` so the Modal container boots
  while the user is still aiming.
- **On apply:** `setImg` updates `dbData.filePath` to the cutout URL; the dialog
  closes; the composer preview now shows the cutout.
- **Loading states:** "Analysing…" during `predict`, "Cutting out…" during
  `apply`. Failures surface as a `toast` and leave the dialog open.

### 4. Configuration

- **`.env.example`** gains:
  ```
  # SAM2 object segmentation (Modal GPU). Blank = feature disabled.
  SEGMENT_API_URL=
  ```
  `MODEL_API_KEY` (already present for the Modal model deploy) is reused for the
  Bearer auth, and the existing `doritos-model-auth` Modal secret carries it.
- **`README.md`** gains a short "Object segmentation (SAM2)" subsection:
  `modal deploy MODEL/modal_segment.py`, then paste the printed URL into
  `SEGMENT_API_URL`. Note the T4 cost (~$0.59/hr, scales to zero) and that the
  feature is optional — the app runs fine with `SEGMENT_API_URL` blank.

## Data flow

1. User attaches an image — existing `POST /upload`, unchanged.
2. Client checks `GET /api/segment/status` once; if enabled, shows "Select object".
3. User opens `SegmentDialog` → `POST /api/segment/warmup` boots Modal.
4. User clicks / drags → `POST /api/segment/predict` → mask overlay.
5. User clicks **Use selection** → `POST /api/segment/apply` → backend saves the
   cutout to `uploads/` → returns `{ fileUrl }`.
6. `img.dbData.filePath` becomes the cutout URL.
7. User sends — the existing chat path inlines the cutout and sends it to the
   vision model.

## Error handling

- **Modal not configured** (`SEGMENT_API_URL` blank): `status` → `enabled:false`;
  the button never renders. predict/apply/warmup → `503`.
- **Modal unreachable / errors:** backend returns `502`; the dialog shows a
  toast and stays open so the user can retry.
- **Bad request** (no point and no box): Modal returns `400`, surfaced as a
  toast; the dialog stays open.
- **Cold start latency:** the warm-up ping on dialog open hides most of it. The
  first `predict` after a long idle may still wait ~15–40 s — covered by the
  "Analysing…" state.
- **Image size:** the backend rejects images above a fixed cap (10 MB) before
  base64-inlining, to keep request bodies bounded.

## Cost & cold start

- T4 GPU ≈ $0.59/hr; `min_containers=0` → ~$0 when idle. A segmentation session
  is a few seconds of GPU time.
- `scaledown_window=300` keeps the container warm for 5 min between sessions.
- For a live demo, set `min_containers=1` to eliminate cold starts entirely.

## Testing

- **Modal (`modal_segment.py`):** unit-test the pure `build_cutout` helper with
  a synthetic image + mask (numpy) — assert the output is RGB, white outside the
  mask, and cropped to the bbox. The GPU endpoints are smoke-tested manually via
  `modal serve`.
- **Backend:** the testable pure pieces — the `SEGMENT_API_URL`
  enabled/disabled logic and the cutout-save helper (base64 → file in
  `uploads/`) — get `node --test` unit tests, matching the existing
  `lib/*.test.js` style. Full Express route behavior is covered by the
  verification pass below rather than by a new integration-test harness.
- **Frontend:** unit-test the pure display↔natural coordinate-mapping function.
  The canvas interaction itself is verified manually.

## Verification

1. `modal deploy MODEL/modal_segment.py`; paste the URL into `SEGMENT_API_URL`.
2. `docker compose up -d --build backend client`.
3. Attach an image — the "Select object" button appears.
4. Open the dialog → warm-up fires → click an object → the mask overlays within
   ~1 s on a warm container → drag a box → the mask refines.
5. Shift+click a region inside the mask → that region is excluded.
6. **Use selection** → the attachment swaps to the tight cutout (object on a
   white background).
7. Send the turn → the vision model's answer is about the selected object only.
8. Unset `SEGMENT_API_URL` and restart the backend → the button disappears.
9. After 5 min idle, the first click triggers a cold start (~15–40 s); confirm
   the warm-up on dialog open masks most of that wait.

## Trade-offs (accepted)

- Segmentation depends on the Modal deployment being live and on internet
  access; the local stack alone cannot segment.
- Cold starts add latency to the first interaction after an idle period.
- The image travels to Modal as base64 in a request body (capped at 10 MB).

## Future extensions (out of scope)

- Multi-object selection (union of several masks into one cutout).
- Folding `/segment/*` into `server.py` so it rides the existing `modal_app.py`
  deploy, if the full model server moves to Modal anyway.
- Transparent-background cutouts as an option alongside white-background.
