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
