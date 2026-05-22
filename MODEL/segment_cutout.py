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
