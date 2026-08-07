// Tests the overlay coordinate mapping.
// Run with:  npm run viewport
//
// The object-fit crop and the front-camera mirror are the two things that make
// detection overlays land in the wrong place, and both are easy to get subtly
// wrong in a way that looks almost right on the one camera you happen to test
// with. The combinations that matter (4:3 vs 16:9 source, front vs rear) are
// checked here so they don't depend on which webcam is plugged in.
//
// sizeOverlayCanvas needs a real DOM and is not covered here; it's exercised by
// browser QA.

import { objectFitMap, sourceBoxToCss } from '../src/lib/detect/viewport.js';

let fails = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// A 4:3 element, the aspect the live panel uses.
const DW = 640;
const DH = 480;

console.log('\n=== object-fit: cover ===');
{
  // The common getUserMedia default: 640x480, same aspect as the box.
  const m = objectFitMap(640, 480, DW, DH, 'cover');
  check(near(m.scale, 1) && near(m.ox, 0) && near(m.oy, 0),
    '4:3 source in a 4:3 box is not cropped at all',
    `scale=${m.scale} ox=${m.ox} oy=${m.oy}`);
}
{
  // A 16:9 webcam in the same box: height fills, width overflows and is cropped.
  const m = objectFitMap(1280, 720, DW, DH, 'cover');
  check(near(m.scale, 480 / 720), '16:9 cover scales to fill height', `scale=${m.scale.toFixed(4)}`);
  check(m.ox < 0 && near(m.oy, 0), '16:9 cover crops horizontally only',
    `ox=${m.ox.toFixed(1)} oy=${m.oy.toFixed(1)}`);
  const visibleFraction = DW / (1280 * m.scale);
  check(visibleFraction > 0.7 && visibleFraction < 0.78,
    'roughly a quarter of the frame width is detected but not shown',
    `${(visibleFraction * 100).toFixed(1)}% visible`);
}

console.log('\n=== object-fit: contain ===');
{
  // The upload preview: whole image visible, letterboxed.
  const m = objectFitMap(1280, 720, DW, DH, 'contain');
  check(near(m.scale, 640 / 1280), 'contain scales to fit width', `scale=${m.scale}`);
  check(near(m.ox, 0) && m.oy > 0, 'contain letterboxes vertically',
    `ox=${m.ox} oy=${m.oy}`);
  // Nothing may fall outside the box.
  const full = sourceBoxToCss({ x1: 0, y1: 0, x2: 1280, y2: 720 }, m);
  check(full.x1 >= -1e-6 && full.y1 >= -1e-6 && full.x2 <= DW + 1e-6 && full.y2 <= DH + 1e-6,
    'a full-frame box stays inside the element under contain',
    `(${full.x1},${full.y1.toFixed(0)})-(${full.x2},${full.y2.toFixed(0)})`);
}

console.log('\n=== mirroring ===');
{
  const m = objectFitMap(640, 480, DW, DH, 'cover');
  const box = { x1: 0, y1: 100, x2: 100, y2: 400 };

  const plain = sourceBoxToCss(box, m);
  check(near(plain.x1, 0) && near(plain.x2, 100), 'unmirrored box maps 1:1 at scale 1',
    `x=[${plain.x1},${plain.x2}]`);

  const mirrored = sourceBoxToCss(box, m, { mirror: true, displayW: DW });
  check(near(mirrored.x1, 540) && near(mirrored.x2, 640),
    'a box at the left edge is drawn at the right edge',
    `x=[${mirrored.x1},${mirrored.x2}]`);
  check(mirrored.x1 < mirrored.x2, 'mirrored coordinates stay correctly ordered');
  check(near(mirrored.y1, plain.y1) && near(mirrored.y2, plain.y2),
    'mirroring leaves the vertical axis untouched');
  check(near(mirrored.x2 - mirrored.x1, plain.x2 - plain.x1),
    'mirroring preserves box width');
}
{
  // Mirroring is its own inverse - a useful invariant, since the flag is
  // derived from the same state as the CSS transform on the video element.
  const m = objectFitMap(640, 480, DW, DH, 'cover');
  const box = { x1: 120, y1: 50, x2: 300, y2: 400 };
  const once = sourceBoxToCss(box, m, { mirror: true, displayW: DW });
  const twice = sourceBoxToCss(
    { ...once, x1: once.x1, x2: once.x2 },
    objectFitMap(DW, DH, DW, DH, 'cover'),
    { mirror: true, displayW: DW },
  );
  check(near(twice.x1, box.x1) && near(twice.x2, box.x2),
    'mirroring twice is the identity',
    `x=[${twice.x1},${twice.x2}] vs [${box.x1},${box.x2}]`);
}
{
  // A horizontally centred box must not move when mirrored.
  const m = objectFitMap(640, 480, DW, DH, 'cover');
  const centred = { x1: 270, y1: 100, x2: 370, y2: 400 };
  const flipped = sourceBoxToCss(centred, m, { mirror: true, displayW: DW });
  check(near(flipped.x1, 270) && near(flipped.x2, 370),
    'a centred box is unchanged by mirroring',
    `x=[${flipped.x1},${flipped.x2}]`);
}

console.log('\n=== cropped-source mapping ===');
{
  // Under cover, a detection near the left edge of a 16:9 frame is off-canvas.
  // It should map to a negative x, not be clamped or wrapped - the overlay
  // clips it, matching what the server would report for the same frame.
  const m = objectFitMap(1280, 720, DW, DH, 'cover');
  const edge = sourceBoxToCss({ x1: 0, y1: 300, x2: 80, y2: 600 }, m);
  check(edge.x1 < 0, 'a box in the cropped region maps outside the element',
    `x1=${edge.x1.toFixed(1)}`);
  const centre = sourceBoxToCss({ x1: 600, y1: 300, x2: 680, y2: 600 }, m);
  check(centre.x1 > 0 && centre.x2 < DW, 'a box in the centre maps inside the element',
    `x=[${centre.x1.toFixed(1)},${centre.x2.toFixed(1)}]`);
}

console.log(fails === 0 ? '\nALL VIEWPORT CHECKS PASSED' : `\n${fails} VIEWPORT CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
