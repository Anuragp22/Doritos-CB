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
