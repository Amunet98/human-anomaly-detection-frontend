// Behavioural tests for the tracker and box smoother.
// Run with:  npm run tracker
//
// These are pure-logic modules with no browser dependency, so the scenarios
// that actually matter can be simulated directly - which is worth far more than
// eyeballing a webcam, because the interesting cases (a 600ms bend versus a
// real fall) are hard to perform reliably on demand and impossible to repeat.
//
// The tuning constants in tracker.js are judgement calls. These tests are what
// pin down what those judgements are supposed to buy, so changing a constant
// tells you immediately which behaviour you traded away.

import { Tracker } from '../src/lib/detect/tracker.js';
import { BoxSmoother } from '../src/lib/detect/smoothing.js';

let fails = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};
const det = (className, confidence, box = [100, 100, 200, 400]) => ({
  className, confidence, classId: 0,
  x1: box[0], y1: box[1], x2: box[2], y2: box[3],
});
// standing box: tall (100x300). lying box: wide (300x100).
const STAND = [100, 100, 200, 400];
const LYING = [100, 300, 400, 400];

const FPS = 5, STEP = 1000 / FPS;

// --- 1. class flicker should stabilise ---
{
  console.log('\n=== 1. sit/stand flicker ===');
  const t = new Tracker();
  let now = 0, states = [];
  // model alternates sit/stand, sit slightly more confident
  for (let i = 0; i < 20; i++) {
    now += STEP;
    const d = i % 3 === 0 ? det('stand', 0.55, STAND) : det('sit', 0.7, STAND);
    states.push(t.update([d], now)[0].state);
  }
  const settled = states.slice(8);
  check(new Set(settled).size === 1 && settled[0] === 'sit',
    'settles on one class despite alternating raw output',
    `last 12 states: ${[...new Set(settled)].join(',')}`);
}

// --- 2. bending over must NOT confirm a fall ---
{
  console.log('\n=== 2. bend over for ~600ms ===');
  const t = new Tracker();
  let now = 0, confirmed = false;
  for (let i = 0; i < 5; i++) { now += STEP; t.update([det('stand', 0.8, STAND)], now); }
  // 3 frames (600ms) of a confident fall reading, wide box and all
  for (let i = 0; i < 3; i++) {
    now += STEP;
    const tr = t.update([det('fall', 0.85, LYING)], now)[0];
    if (tr.fallConfirmed) confirmed = true;
  }
  for (let i = 0; i < 5; i++) { now += STEP; t.update([det('stand', 0.8, STAND)], now); }
  check(!confirmed, 'never confirms a fall for a 600ms episode');
}

// --- 3. a real sustained fall must confirm ---
{
  console.log('\n=== 3. sustained fall ===');
  const t = new Tracker();
  let now = 0, confirmAt = null;
  for (let i = 0; i < 5; i++) { now += STEP; t.update([det('stand', 0.8, STAND)], now); }
  const fallStart = now;
  for (let i = 0; i < 20; i++) {
    now += STEP;
    const tr = t.update([det('fall', 0.85, LYING)], now)[0];
    if (tr.fallConfirmed && confirmAt === null) confirmAt = now;
  }
  const delay = confirmAt === null ? null : confirmAt - fallStart;
  check(confirmAt !== null, 'confirms a sustained fall');
  check(delay !== null && delay >= 1200 && delay <= 2600,
    'confirms within a sensible delay', `${delay}ms after onset`);
}

// --- 4. recovery: fall then get up ---
{
  console.log('\n=== 4. fall then stand back up ===');
  const t = new Tracker();
  let now = 0;
  for (let i = 0; i < 15; i++) { now += STEP; t.update([det('fall', 0.9, LYING)], now); }
  let tr = t.update([det('fall', 0.9, LYING)], now += STEP)[0];
  check(tr.state === 'fall' && tr.fallConfirmed, 'is a confirmed fall before recovery');
  for (let i = 0; i < 15; i++) { now += STEP; tr = t.update([det('stand', 0.85, STAND)], now)[0]; }
  check(tr.state === 'stand' && !tr.fallConfirmed, 'clears once standing again', `state=${tr.state}`);
}

// --- 5. two people keep distinct stable ids ---
{
  console.log('\n=== 5. two people ===');
  const t = new Tracker();
  let now = 0, idsSeen = new Set(), lastIds = null;
  for (let i = 0; i < 15; i++) {
    now += STEP;
    // person A drifts right, person B stays put
    const a = det('stand', 0.8, [100 + i * 4, 100, 200 + i * 4, 400]);
    const b = det('sit', 0.8, [500, 150, 600, 400]);
    const live = t.update([a, b], now);
    live.forEach((x) => idsSeen.add(x.id));
    lastIds = live.map((x) => x.id).sort();
  }
  check(lastIds.length === 2, 'tracks both people', `live=${lastIds.length}`);
  check(idsSeen.size === 2, 'ids stay stable across 15 frames', `distinct ids ever seen=${idsSeen.size}`);
}

// --- 6. a track that leaves frame is dropped ---
{
  console.log('\n=== 6. person leaves frame ===');
  const t = new Tracker();
  let now = 0;
  for (let i = 0; i < 10; i++) { now += STEP; t.update([det('stand', 0.8, STAND)], now); }
  check(t.update([], now += STEP).length === 1, 'holds the box briefly after one miss');
  now += 500;
  const live = t.update([], now);
  check(live.length === 0, 'gone after ~500ms of misses', `live=${live.length}`);
}

// --- 7. smoother eases toward target and does not overshoot ---
{
  console.log('\n=== 7. box smoothing ===');
  const t = new Tracker(), s = new BoxSmoother();
  let now = 0;
  t.update([det('stand', 0.8, [100, 100, 200, 400])], now);
  s.sample(t.live(now), now);
  // jump the box 100px right, then sample at 60fps for 300ms
  now += STEP;
  t.update([det('stand', 0.8, [200, 100, 300, 400])], now);
  let x1 = null, overshoot = false;
  for (let i = 0; i < 18; i++) {
    now += 16.7;
    x1 = s.sample(t.live(now), now)[0].box.x1;
    if (x1 > 200.01 || x1 < 100) overshoot = true;
  }
  check(!overshoot, 'never overshoots the target');
  check(Math.abs(x1 - 200) < 1, 'converges on the target', `x1=${x1.toFixed(2)} target=200`);
}


// --- 8. consistent but low-confidence fall: state honest, not confirmed ---
{
  console.log('\n=== 8. consistent low-confidence fall (narrow box) ===');
  const t = new Tracker();
  let now = 0, tr;
  for (let i = 0; i < 20; i++) {
    now += STEP;
    // 0.46 conf, and a TALL box so the lying-aspect bonus does not apply
    tr = t.update([det('fall', 0.46, STAND)], now)[0];
  }
  check(tr.state === 'fall', 'state reports what the model consistently says', `state=${tr.state}`);
  check(!tr.fallConfirmed, 'but does not confirm on weak evidence');
}

// --- 9. aspect bonus rescues a borderline fall with a lying box ---
{
  console.log('\n=== 9. borderline fall, lying box ===');
  const t = new Tracker();
  let now = 0, tr;
  for (let i = 0; i < 20; i++) { now += STEP; tr = t.update([det('fall', 0.5, LYING)], now)[0]; }
  check(tr.fallConfirmed, 'aspect corroboration carries 0.50 over the 0.55 bar');
}

// --- 10. confirmation does not blink off when confidence sags ---
{
  console.log('\n=== 10. confirmed fall, confidence sags to 0.40 ===');
  const t = new Tracker();
  let now = 0, tr;
  for (let i = 0; i < 15; i++) { now += STEP; tr = t.update([det('fall', 0.9, LYING)], now)[0]; }
  check(tr.fallConfirmed, 'confirmed while lying still at high confidence');
  let blinked = false;
  for (let i = 0; i < 15; i++) {
    now += STEP;
    tr = t.update([det('fall', 0.40, LYING)], now)[0];
    if (!tr.fallConfirmed) blinked = true;
  }
  check(!blinked, 'stays confirmed as confidence sags below the enter bar');
}

console.log(fails === 0 ? '\nALL TRACKER CHECKS PASSED' : `\n${fails} TRACKER CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
