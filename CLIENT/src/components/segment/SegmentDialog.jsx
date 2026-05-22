import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
  const [warming, setWarming] = useState(false); // GPU cold-start in progress

  // Warm the Modal GPU when the dialog opens. The backend's /warmup awaits
  // Modal's health probe — which answers only once the container is booted and
  // SAM2 is loaded — so the cold-start wait happens here, up front, while the
  // user is still aiming, instead of stalling their first click.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setWarming(true);
    fetch(`${API}/api/segment/warmup`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWarming(false); });
    return () => { cancelled = true; };
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

  // Draw the selection preview (natural-pixel space): scrim the whole image,
  // then punch out the selected region so the chosen object shows through
  // bright — a live preview of the cutout that will be sent.
  const draw = useCallback((liveBox) => {
    const canvas = canvasRef.current;
    if (!canvas || !natural) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (maskImgRef.current) {
      ctx.fillStyle = 'rgba(244, 237, 225, 0.82)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(maskImgRef.current, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
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
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD && !drag.moved) {
      drag.moved = true;
      maskImgRef.current = null; // a fresh box drag — drop the previous mask
    }
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
      // A box is a self-contained prompt. Drop any earlier points — SAM2
      // returns a broken, speckled mask when a box and stray points are sent
      // together (verified: score collapses from ~0.95 to ~0.60).
      const nextBox = toBox(drag.startNatural, end);
      setBox(nextBox);
      setPoints([]);
      runPredict([], nextBox);
    } else {
      // A point click is a point-mode prompt. Drop any box for the same reason.
      // Clicking on an existing marker removes it — lets the user undo a click.
      const unit = Math.max(natural.width, natural.height);
      const hitIdx = points.findIndex(
        (p) => Math.hypot(p.x - end.x, p.y - end.y) <= unit / 40
      );
      const nextPoints =
        hitIdx === -1
          ? [...points, { ...end, label: drag.shift ? 0 : 1 }]
          : points.filter((_, i) => i !== hitIdx);
      setPoints(nextPoints);
      setBox(null);
      runPredict(nextPoints, null);
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
            Click an object to select it, or drag a box around it.
            Click a dot again to remove it; Reset clears everything.
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
          {(warming || busy) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/30">
              <div className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-sm shadow">
                <Loader2 className="size-4 animate-spin" />
                <span>
                  {warming
                    ? 'Warming up the GPU — first use can take ~30s'
                    : 'Working…'}
                </span>
              </div>
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
