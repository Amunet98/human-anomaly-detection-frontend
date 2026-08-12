// Measures the POST-TRACKER false-alarm rate on video of people not falling.
//
// Run with:  node scripts/falsealarm-check.mjs <video-or-frame-dir> [options]
//            npm run falsealarm -- ../corpus-adl/adl-01 --label "UR Fall ADL 01"
//
// WHY THIS EXISTS
// ---------------
// Every accuracy figure in MODEL_CARD.md is measured on STILL IMAGES, one frame
// at a time. But nothing in this system alarms on a single frame: tracker.js
// votes each track's class over a window and only confirms a fall after it has
// held for FALL_CONFIRM_MS. So the one number a buyer asks for first - how often
// does it cry wolf - has never been measured, and the card says so outright:
// the 1.2s sustain is "the only claim in this document resting on the tracker
// rather than on measurement".
//
// The stills figure that stands in for it is 11.5% of ordinary people reading
// as `fall` on a single frame, two-thirds of them crouching. That statistic
// cannot distinguish the two worlds that matter:
//
//   - a crouch flickers to `fall` for a frame or two, the sustain eats it, and
//     nothing reaches the user;
//   - a crouch HOLDS for two seconds, the sustain does not save you, and a
//     carer walks to a room for nothing.
//
// Both produce the same 11.5%. Only video separates them. This script is the
// separation.
//
// WHAT IT DOES
// ------------
// Runs the real detector over every sampled frame, feeds the results into the
// real tracker.js in order, and reports every moment `fallConfirmed` went true.
// Point it at footage where nobody falls and each one of those is a false alarm
// by construction - the same logic that makes POLAR usable as a negative set.
//
// FRAME RATE IS A PARAMETER, NOT A DETAIL
// ---------------------------------------
// FALL_CONFIRM_MS is 1200ms but VOTE_WINDOW is 7 *results*, so the two scale
// differently with capture rate: at 5fps the window spans 1.4s, at 1fps it
// spans 7s. The deployed rates are not one number either - the server throttles
// to one frame per 500ms (2fps) and mid-range Android manages roughly 1fps on
// WASM. A single-rate answer would therefore be misleading about the product.
//
// So inference runs ONCE per frame - it is the expensive part - and the tracker
// is then replayed over that cached result at several rates by subsampling.
// Cheap, and it turns "does it false-alarm" into "does it false-alarm at the
// rate this device actually achieves".
//
// SCOPE, STATED HONESTLY
// ----------------------
// This measures confirmed alarms on the footage you give it. Fifteen minutes of
// one person in one room is not a deployment guarantee, and this script cannot
// make it one. What it does is convert the last unmeasured claim in the model
// card into a number with a denominator.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { Tracker, TRACKER_TUNING } from '../src/lib/detect/tracker.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BACKEND = path.resolve(FRONTEND, '../human-anomaly-detection-backend-main');

if (!fs.existsSync(path.join(BACKEND, 'node_modules'))) {
  console.error(`Backend repo not found (or deps not installed) at:\n  ${BACKEND}\n`);
  console.error('Check it out alongside this repo and run `npm install` there.');
  process.exit(2);
}

const require = createRequire(BACKEND + '/');
const { analyzeBuffer } = require(path.join(BACKEND, 'inference'));

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--label', '--fps', '--source-fps', '--replay', '--dump', '--limit']);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) {
    opts[a] = argv[i + 1];
    i += 1; // consume the value so it is never mistaken for the source path
  } else if (a.startsWith('--')) {
    opts[a] = true;
  } else {
    positional.push(a);
  }
}
const flag = (name, fallback) => (opts[name] !== undefined ? opts[name] : fallback);
const sources = positional;
const source = positional[0];

if (!source) {
  console.error(`Usage: node scripts/falsealarm-check.mjs <video-or-frame-dir> [options]

  --label NAME     what this footage is, for the report
  --fps N          rate to analyse at (default 5)
  --source-fps N   native rate of a frame FOLDER, if higher than --fps; frames
                   are subsampled down to --fps. UR Fall records at 30.
  --replay a,b,c   tracker replay rates (default 1,2,5). 2 is the server's
                   throttle, ~1 is mid-range Android on WASM.
  --expect-falls   the footage DOES contain falls, so report detections as
                   recall rather than as false alarms
  --dump DIR       write the frames that triggered a confirmation, to look at
  --limit N        stop after N frames (smoke test)

A frame directory is any folder of .png/.jpg sorted by filename - which is the
shape the UR Fall ADL sequences unzip into, so they need no conversion.`);
  process.exit(2);
}

const LABEL = flag('--label', path.basename(source));
const FPS = Number(flag('--fps', 5));
// Native rate of a frame FOLDER, when it differs from the rate we want to
// analyse at. UR Fall records at 30fps; the deployed system never exceeds ~5.
const SOURCE_FPS = Number(flag('--source-fps', FPS));
const REPLAY = flag('--replay', '1,2,5').split(',').map(Number).filter((n) => n > 0);
const EXPECT_FALLS = opts['--expect-falls'] === true;
const DUMP = flag('--dump', null);
const LIMIT = Number(flag('--limit', 0));

// --- one clip -----------------------------------------------------------------

// Each clip gets its own Tracker. Clips are separate recordings, so letting a
// track survive across a boundary would associate two different people who
// happen to occupy the same pixels - and could manufacture a sustained "fall"
// out of two unrelated frames, which is exactly the artefact this script exists
// to rule out.
async function runClip(src) {
  let frameDir = src;
  let cleanup = null;

  if (!fs.statSync(src).isDirectory()) {
    // Video: decode to JPEG once at the sampling rate. -q:v 2 is near-lossless;
    // the detector letterboxes to 640 anyway, so finer is wasted disk.
    if (!hasFfmpeg()) {
      console.error('ffmpeg is needed to read a video file. Install it, or pass a folder of frames.');
      process.exit(2);
    }
    frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsealarm-'));
    cleanup = frameDir;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', src, '-vf', `fps=${FPS}`,
                            '-q:v', '2', path.join(frameDir, 'f-%06d.jpg')]);
  }

  // Natural sort, not lexical. Frame order IS the measurement: a tracker fed
  // shuffled frames associates nothing and reports a confident zero, which is
  // the worst failure mode because it looks like good news. Both real sources
  // here zero-pad so lexical would work by luck; frame1..frame10.jpg would not.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  let frames = fs.readdirSync(frameDir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort(collator.compare);

  // A folder recorded at 30fps does not need 30fps of inference: nothing
  // downstream runs faster than ~5fps. Subsampling here is a 6x saving on the
  // only expensive step. (Video is already decoded at --fps, so this is a no-op.)
  if (SOURCE_FPS > FPS) {
    const step = SOURCE_FPS / FPS;
    const kept = [];
    for (let i = 0; i < frames.length; i += step) kept.push(frames[Math.round(i)]);
    frames = kept.filter(Boolean);
  }
  if (LIMIT) frames = frames.slice(0, LIMIT);
  if (!frames.length) {
    console.error(`  no .png/.jpg frames in ${src} - skipped`);
    return null;
  }

  const results = [];
  let framesWithFall = 0, detectionsTotal = 0, detectionsFall = 0;

  for (const file of frames) {
    const { detections } = await analyzeBuffer(fs.readFileSync(path.join(frameDir, file)));
    // inference.js returns boxes as a [x1,y1,x2,y2] array; the tracker wants
    // them as properties, the shape postprocess.js hands it in the browser.
    const dets = detections.map((d) => ({
      className: d.className, confidence: d.confidence, tier: d.tier, keypoints: d.keypoints,
      x1: d.box[0], y1: d.box[1], x2: d.box[2], y2: d.box[3],
    }));
    results.push({ file, t: (results.length / FPS) * 1000, dets, dir: frameDir });
    detectionsTotal += dets.length;
    const falls = dets.filter((d) => d.className === 'fall').length;
    detectionsFall += falls;
    if (falls) framesWithFall += 1;
  }

  const byRate = new Map();
  for (const rate of REPLAY) {
    if (rate > FPS) continue;
    byRate.set(rate, replay(results, rate));
  }

  return {
    src, frameDir, cleanup, frames: frames.length, durationS: frames.length / FPS,
    framesWithFall, detectionsTotal, detectionsFall, byRate,
  };
}

// Replay the cached per-frame results through a fresh tracker at `rate`, and
// return one entry per confirmed-fall episode.
function replay(results, rate) {
  const stride = FPS / rate;
  const tracker = new Tracker();
  const episodes = [];
  const open = new Map();

  for (let i = 0; i < results.length; i += stride) {
    const r = results[Math.round(i)];
    if (!r) continue;
    const live = tracker.update(r.dets, r.t);
    const liveIds = new Set(live.map((t) => t.id));
    for (const track of live) {
      if (track.fallConfirmed && !open.has(track.id)) {
        open.set(track.id, { start: r.t, file: r.file, dir: r.dir, conf: track.confidence, tier: track.tier });
      } else if (!track.fallConfirmed && open.has(track.id)) {
        episodes.push({ ...open.get(track.id), end: r.t, id: track.id });
        open.delete(track.id);
      }
    }
    // A track can vanish while still confirmed - close its episode too, or it
    // would be silently dropped and undercount the alarms.
    for (const [id, ep] of open) {
      if (!liveIds.has(id)) {
        episodes.push({ ...ep, end: r.t, id });
        open.delete(id);
      }
    }
  }
  const last = results.at(-1);
  for (const [id, ep] of open) episodes.push({ ...ep, end: last.t, id });
  return episodes;
}

// --- run every clip -----------------------------------------------------------

console.log(`\n=== ${LABEL} ===`);
console.log(`  ${sources.length} clip${sources.length === 1 ? '' : 's'}, analysed at ${FPS} fps`);
console.log(`  ${EXPECT_FALLS ? 'footage CONTAINS falls - reporting detections'
                              : 'footage contains NO falls - every confirmation is a FALSE ALARM'}`);

const clips = [];
process.stdout.write('  running the detector ');
for (const src of sources) {
  const clip = await runClip(src);
  if (clip) clips.push(clip);
  process.stdout.write('.');
}
console.log(' done');

if (!clips.length) {
  console.error('nothing to report');
  process.exit(2);
}

const totalFrames = clips.reduce((a, c) => a + c.frames, 0);
const totalDuration = clips.reduce((a, c) => a + c.durationS, 0);
const totalDets = clips.reduce((a, c) => a + c.detectionsTotal, 0);
const totalFallDets = clips.reduce((a, c) => a + c.detectionsFall, 0);
const totalFallFrames = clips.reduce((a, c) => a + c.framesWithFall, 0);

console.log(`  ${totalFrames} frames = ${fmtDuration(totalDuration)} of footage`);

console.log(`\n  PER-FRAME (what MODEL_CARD's 11.5% measures):`);
console.log(`    ${totalFallDets} of ${totalDets} person-detections read as \`fall\`  = ${pct(totalFallDets, totalDets)}`);
console.log(`    ${totalFallFrames} of ${totalFrames} frames contain at least one  = ${pct(totalFallFrames, totalFrames)}`);

console.log(`\n  POST-TRACKER (what a user would actually be shown):`);
console.log(`    confirm requires ${TRACKER_TUNING.FALL_CONFIRM_MS}ms sustained at >= ${TRACKER_TUNING.FALL_ENTER_CONF}` +
            ` over a ${TRACKER_TUNING.VOTE_WINDOW}-result window\n`);

const dumped = [];
let worst = null;
for (const rate of REPLAY) {
  if (rate > FPS) {
    console.log(`    ${String(rate).padStart(2)} fps  - skipped, cannot replay faster than the ${FPS} fps sampled`);
    continue;
  }
  const eps = clips.flatMap((c) => (c.byRate.get(rate) || []).map((e) => ({ ...e, src: c.src })));
  const perHour = eps.length / (totalDuration / 3600);
  const verb = EXPECT_FALLS ? 'confirmed fall' : 'FALSE ALARM';
  const note = rate === 2 ? "   <- the server's throttle"
             : rate === 1 ? '   <- mid-range Android on WASM' : '';
  console.log(`    ${String(rate).padStart(2)} fps  ${String(eps.length).padStart(3)} ${verb}${eps.length === 1 ? '' : 's'}` +
              `   = ${perHour.toFixed(1)} per hour${note}`);
  for (const ep of eps.slice(0, 8)) {
    console.log(`             ${path.basename(ep.src).padEnd(18)} at ${fmtDuration(ep.start / 1000)}` +
                ` for ${((ep.end - ep.start) / 1000).toFixed(1)}s  conf ${ep.conf.toFixed(2)} tier ${ep.tier}`);
    if (DUMP) dumped.push(ep);
  }
  if (eps.length > 8) console.log(`             ... and ${eps.length - 8} more`);
  if (worst === null || eps.length > worst.n) worst = { rate, n: eps.length };
}

if (!EXPECT_FALLS && worst) {
  console.log(`\n  WHAT THE TRACKER SUPPRESSED:`);
  console.log(`    ${totalFallFrames} frames looked like a fall; ${worst.n} survived to a confirmation` +
              ` at the worst rate (${worst.rate} fps).`);
  if (totalFallFrames && !worst.n) {
    console.log(`    The ${TRACKER_TUNING.FALL_CONFIRM_MS}ms sustain absorbed all of them - the claim MODEL_CARD`);
    console.log(`    has been resting on the tracker for, now measured on this footage.`);
  } else if (worst.n) {
    console.log(`    The sustain did NOT absorb everything. A crouch held past ${TRACKER_TUNING.FALL_CONFIRM_MS}ms`);
    console.log(`    is the expected culprit - pass --dump DIR to look at the frames.`);
  } else if (!totalFallFrames) {
    console.log(`    Nothing even looked like a fall per-frame, so the tracker was never`);
    console.log(`    tested here. This footage does not exercise the question.`);
  }
}

if (DUMP && dumped.length) {
  fs.mkdirSync(DUMP, { recursive: true });
  for (const ep of dumped) {
    fs.copyFileSync(path.join(ep.dir, ep.file), path.join(DUMP, `${path.basename(ep.src)}-${ep.file}`));
  }
  console.log(`\n  wrote ${dumped.length} triggering frames to ${DUMP}`);
}

console.log(`\n  Read this as a measurement of THIS footage, not of the product. A`);
console.log(`  deployment figure needs many people, rooms and camera heights.\n`);

for (const c of clips) if (c.cleanup) fs.rmSync(c.cleanup, { recursive: true, force: true });

// --- helpers ----------------------------------------------------------------

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function pct(a, b) {
  return b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a';
}

function fmtDuration(s) {
  const m = Math.floor(s / 60);
  return m ? `${m}m ${(s % 60).toFixed(0)}s` : `${s.toFixed(1)}s`;
}
