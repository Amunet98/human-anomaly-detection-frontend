// Maps detection boxes from source-image pixels into the CSS pixels of the
// element they're drawn over.
//
// Three things make overlays land in the wrong place, and all three are handled
// here rather than at the call sites: the CSS object-fit crop, the front-camera
// mirror, and devicePixelRatio.

// object-fit maps a sourceW x sourceH image into a dw x dh box.
//
// 'cover' fills the box and crops the overflow (max), 'contain' fits the whole
// image and letterboxes (min). The live feed uses cover; the upload preview
// uses contain.
//
// A negative offset means that edge is cropped away. Note that for a native 4:3
// camera in a 4:3 box the two scales are equal and nothing is cropped at all -
// the crop only bites on a 16:9 webcam, which loses roughly a quarter of the
// frame width. Those boxes are still detected (the model sees the whole frame)
// but are drawn partly or wholly outside the element, which is why the overlay
// clips rather than trying to be clever about it - matching what the server
// would report for the same frame.
export function objectFitMap(sourceW, sourceH, dw, dh, fit = 'cover') {
  const scale =
    fit === 'contain'
      ? Math.min(dw / sourceW, dh / sourceH)
      : Math.max(dw / sourceW, dh / sourceH);
  return {
    scale,
    ox: (dw - sourceW * scale) / 2,
    oy: (dh - sourceH * scale) / 2,
  };
}

// Source-pixel box -> CSS-pixel box.
//
// The mirror is applied by reflecting the coordinates, not by transforming the
// canvas. Flipping the context would also flip every label, making the text
// unreadable; reflecting x1/x2 and swapping them keeps all the drawing in a
// normal, unflipped space.
//
// Worth being explicit about why a mirror is needed at all: the preview <video>
// is CSS-mirrored for the front camera (like every native camera app), but
// createImageBitmap and drawImage read the decoded frame and never see that
// compositor-level transform. So detections are always in true, unmirrored
// source coordinates, and it's the drawing that has to be flipped to match what
// the viewer sees.
export function sourceBoxToCss(box, map, { mirror = false, displayW = 0 } = {}) {
  let x1 = box.x1 * map.scale + map.ox;
  let x2 = box.x2 * map.scale + map.ox;
  const y1 = box.y1 * map.scale + map.oy;
  const y2 = box.y2 * map.scale + map.oy;
  if (mirror) {
    const flipped = displayW - x2;
    x2 = displayW - x1;
    x1 = flipped;
  }
  return { x1, y1, x2, y2 };
}

// Sizes an overlay canvas to its host element at device resolution and returns
// a context that takes CSS-pixel coordinates.
//
// The transform is deliberately w / rect.width rather than dpr: after rounding
// to whole device pixels the two differ by up to half a pixel, and using dpr
// leaves every box drifting slightly at the right and bottom edges. dpr is
// capped at 2 because a third of a device pixel of extra sharpness is not worth
// 2.25x the fill cost on a phone.
export function sizeOverlayCanvas(canvas, hostEl) {
  const rect = hostEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  // Assigning width/height resets the context, so only do it on a real change.
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(w / rect.width, 0, 0, h / rect.height, 0, 0);
  return { ctx, cssW: rect.width, cssH: rect.height };
}
