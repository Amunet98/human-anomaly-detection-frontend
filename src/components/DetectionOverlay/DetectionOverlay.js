import { useEffect, useRef } from 'react';
import {
  objectFitMap,
  sourceBoxToCss,
  sourcePointToCss,
  sizeOverlayCanvas,
} from '../../lib/detect/viewport';
import { KEYPOINT_EDGES, KP_CONF_THRESHOLD } from '../../lib/detect/constants';

// Severity, not decoration: red reads as the thing you're meant to notice, and
// it's the portfolio's own accent. Amber and emerald are the two "nothing is
// wrong" states.
const CLASS_COLORS = {
  fall: { stroke: '#f87171', fill: '#dc2626', text: '#ffffff' },
  sit: { stroke: '#fbbf24', fill: '#b45309', text: '#ffffff' },
  squat: { stroke: '#a78bfa', fill: '#6d28d9', text: '#ffffff' },
  stand: { stroke: '#34d399', fill: '#047857', text: '#ffffff' },
};
const FALLBACK_COLOR = { stroke: '#94a3b8', fill: '#334155', text: '#ffffff' };

const FONT = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';

// Draws the pose skeleton the posture decision was actually made from. This is
// the difference between a label you have to trust and one you can check: if the
// system says FALL, the drawn torso is visibly horizontal.
//
// An edge is drawn only when BOTH endpoints clear KP_CONF_THRESHOLD, so an
// occluded limb leaves a gap rather than a confident-looking line running
// through whatever is behind the subject. Drawn under the brackets and at
// reduced alpha - it is corroboration, not the primary read.
function drawSkeleton(ctx, keypoints, map, color, { mirror, displayW }) {
  if (!keypoints || keypoints.length === 0) return;

  const pts = keypoints.map((k) =>
    k && k.confidence >= KP_CONF_THRESHOLD && k.x !== null
      ? sourcePointToCss(k, map, { mirror, displayW })
      : null,
  );

  ctx.save();
  ctx.globalAlpha *= 0.55;
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of KEYPOINT_EDGES) {
    const p = pts[a];
    const q = pts[b];
    if (!p || !q) continue;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();

  ctx.fillStyle = color.stroke;
  for (const p of pts) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Draws corner brackets rather than a closed rectangle - it reads as a
// surveillance system rather than as debug output, and it leaves the subject's
// edges visible instead of ringing them.
function drawBrackets(ctx, { x1, y1, x2, y2 }, color, emphasis) {
  const w = x2 - x1;
  const h = y2 - y1;
  // Bracket arms scale with the box but stay within sane bounds, so a small
  // distant detection doesn't become four solid corners.
  const arm = Math.max(8, Math.min(28, Math.min(w, h) * 0.28));

  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = emphasis ? 3 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  // top-left
  ctx.moveTo(x1, y1 + arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 + arm, y1);
  // top-right
  ctx.moveTo(x2 - arm, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + arm);
  // bottom-right
  ctx.moveTo(x2, y2 - arm); ctx.lineTo(x2, y2); ctx.lineTo(x2 - arm, y2);
  // bottom-left
  ctx.moveTo(x1 + arm, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - arm);
  ctx.stroke();

  // A faint wash inside a confirmed fall, so it's obvious at a glance which
  // box is the one that matters.
  if (emphasis) {
    ctx.fillStyle = color.stroke;
    ctx.globalAlpha *= 0.12;
    ctx.fillRect(x1, y1, w, h);
    ctx.globalAlpha /= 0.12;
  }
}

function drawLabel(ctx, box, text, color, cssW) {
  ctx.font = FONT;
  const padX = 6;
  const width = ctx.measureText(text).width + padX * 2;
  const height = 19;

  // Keep the chip on-screen: above the box normally, inside it when the box is
  // hard against the top edge, and never past the left or right edge.
  let x = box.x1;
  let y = box.y1 - height - 4;
  if (y < 0) y = Math.min(box.y1 + 4, box.y2 - height - 4);
  if (x + width > cssW) x = cssW - width;
  if (x < 0) x = 0;

  ctx.fillStyle = color.fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 4);
  ctx.fill();

  ctx.fillStyle = color.text;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + height / 2 + 0.5);
}

// Renders tracked detections over a <video> or <img>.
//
// `getTracks` is a function rather than a prop value on purpose: this redraws
// on requestAnimationFrame so the box smoother can ease between inference
// results, and re-rendering React at 60fps to push new boxes in would be
// wasteful. React owns the canvas element; the render loop owns its pixels.
export function DetectionOverlay({ hostRef, sourceRef, getTracks, mirror = false, fit = 'cover' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return undefined;

    let rafId = null;
    let sized = null;

    // Resizing resets the context, so it's done from a ResizeObserver rather
    // than every frame.
    const resize = () => {
      sized = sizeOverlayCanvas(canvas, host);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const render = () => {
      rafId = requestAnimationFrame(render);
      if (!sized) {
        resize();
        if (!sized) return;
      }
      const { ctx, cssW, cssH } = sized;
      ctx.clearRect(0, 0, cssW, cssH);

      const source = sourceRef.current;
      // videoWidth/naturalWidth are 0 until metadata loads; mapping against
      // them would divide by zero and scatter boxes across the frame.
      const sw = source?.videoWidth || source?.naturalWidth || 0;
      const sh = source?.videoHeight || source?.naturalHeight || 0;
      if (!sw || !sh) return;

      const map = objectFitMap(sw, sh, cssW, cssH, fit);
      for (const track of getTracks()) {
        const color = CLASS_COLORS[track.state] || FALLBACK_COLOR;
        const box = sourceBoxToCss(track.box, map, { mirror, displayW: cssW });

        ctx.globalAlpha = track.opacity ?? 1;
        drawSkeleton(ctx, track.keypoints, map, color, { mirror, displayW: cssW });
        drawBrackets(ctx, box, color, track.fallConfirmed);

        const pct = Math.round((track.confidence ?? 0) * 100);
        const label = track.fallConfirmed
          ? `#${track.id} FALL CONFIRMED ${pct}%`
          : `#${track.id} ${track.state.toUpperCase()} ${pct}%`;
        drawLabel(ctx, box, label, color, cssW);
        ctx.globalAlpha = 1;
      }
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [hostRef, sourceRef, getTracks, mirror, fit]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none rounded-2xl"
      aria-hidden="true"
    />
  );
}

export { CLASS_COLORS };
