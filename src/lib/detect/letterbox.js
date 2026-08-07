import { INPUT_SIZE, PAD_RGB } from './constants.js';

// Aspect-preserving resize into INPUT_SIZE x INPUT_SIZE with centred grey
// padding - ultralytics' own preprocessing, and a direct port of the server's
// inference.js:59-90.
//
// The rounding here is load-bearing and deliberately matches the server
// exactly: Math.round on the scaled dimensions, then Math.floor on the pad.
// Getting it wrong shifts every box by a pixel or two relative to /analyze.
export function computeLetterbox(sourceW, sourceH) {
  const scale = Math.min(INPUT_SIZE / sourceW, INPUT_SIZE / sourceH);
  const newW = Math.round(sourceW * scale);
  const newH = Math.round(sourceH * scale);
  const padLeft = Math.floor((INPUT_SIZE - newW) / 2);
  const padTop = Math.floor((INPUT_SIZE - newH) / 2);
  return { scale, newW, newH, padLeft, padTop };
}

// Paints `source` (a video, image, or ImageBitmap) letterboxed into a
// 640x640 2D context.
//
// One difference from the server we cannot close: sharp resizes with Lanczos3,
// while canvas uses a browser-chosen filter. 'high' gets as close as the
// platform allows, but browser and server detections will agree closely rather
// than exactly. Everything else in the pipeline - the transform above, the
// normalisation, the CHW layout, the decode, the NMS - is exact.
export function drawLetterboxed(ctx, source, sourceW, sourceH, lb) {
  ctx.fillStyle = `rgb(${PAD_RGB[0]},${PAD_RGB[1]},${PAD_RGB[2]})`;
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sourceW, sourceH, lb.padLeft, lb.padTop, lb.newW, lb.newH);
}

// getImageData hands back HWC RGBA; the model wants CHW RGB in [0,1]. Skipping
// the alpha byte is the browser-side equivalent of the server's .removeAlpha().
//
// `out` is passed in and reused across frames - this runs 1.2M times per frame,
// so allocating a fresh 4.9MB Float32Array each time is a real cost. Safe to
// reuse because runs are strictly sequential and ORT copies into the wasm heap
// during run().
export function imageDataToCHW(rgba, out) {
  const area = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < area; i++) {
    const j = i << 2;
    out[i] = rgba[j] / 255;
    out[area + i] = rgba[j + 1] / 255;
    out[2 * area + i] = rgba[j + 2] / 255;
  }
  return out;
}
