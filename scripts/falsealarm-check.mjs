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

// --- gather frames ----------------------------------------------------------

let frameDir;
let cleanup = null;

if (fs.statSync(source).isDirectory()) {
  frameDir = source;
} else {
  // Video: decode to JPEG once at the sampling rate. -q:v 2 is near-lossless;
  // the detector letterboxes to 640 anyway, so anything finer is wasted disk.
  if (!hasFfmpeg()) {
    console.error('ffmpeg is needed to read a video file. Install it, or pass a folder of frames.');
    process.exit(2);
  }
  frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsealarm-'));
  cleanup = frameDir;
  console.log(`decoding ${path.basename(source)} at ${FPS} fps ...`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-i', source, '-vf', `fps=${FPS}`,
                          '-q:v', '2', path.join(frameDir, 'f-%06d.jpg')]);
}

// Natural sort, not lexical. Frame order IS the measurement here - a tracker
// fed shuffled frames associates nothing and reports a confident zero, which is
// the worst possible failure mode because it looks like good news. ffmpeg pads
// its output and the UR Fall sequences are padded too, so lexical would happen
// to work for both; a hand-made folder of frame1..frame10.jpg would not, and
// nothing would say so.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
let frames = fs
  .readdirSync(frameDir)
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .sort(collator.compare);
// A frame folder recorded at 30fps does not need 30fps of inference: nothing
// downstream runs faster than ~5fps and the deployed rates are 1-2. Subsample
// to --fps and skip the rest, which is a 6x saving on the only expensive step.
// (Video input is already decoded at --fps by ffmpeg, so this is a no-op there.)
if (SOURCE_FPS > FPS) {
  const step = SOURCE_FPS / FPS;
  const kept = [];
  for (let i = 0; i < frames.length; i += step) kept.push(frames[Math.round(i)]);
  console.log(`  subsampling ${frames.length} frames at ${SOURCE_FPS} fps -> ${kept.length} at ${FPS} fps`);
  frames = kept.filter(Boolean);
}
if (LIMIT) frames = frames.slice(0, LIMIT);

if (!frames.length) {
  console.error(`No .png/.jpg frames found in ${frameDir}`);
  process.exit(2);
}

const durationS = frames.length / FPS;
console.log(`\n=== ${LABEL} ===`);
console.log(`  ${frames.length} frames at ${FPS} fps = ${fmtDuration(durationS)} of footage`);
console.log(`  ${EXPECT_FALLS ? 'footage CONTAINS falls - reporting detections' :
                                 'footage contains NO falls - every confirmation is a false alarm'}`);

// --- inference, once ---------------------------------------------------------

const results = [];
let framesWithFall = 0;
let detectionsTotal = 0;
let detectionsFall = 0;

process.stdout.write('  running the detector ');
for (let i = 0; i < frames.length; i += 1) {
  const buf = fs.readFileSync(path.join(frameDir, frames[i]));
  const { detections } = await analyzeBuffer(buf);
  // inference.js returns boxes as a [x1,y1,x2,y2] array; the tracker wants them
  // as properties, the same shape postprocess.js hands it in the browser.
  const dets = detections.map((d) => ({
    className: d.className,
    confidence: d.confidence,
    tier: d.tier,
    keypoints: d.keypoints,
    x1: d.box[0], y1: d.box[1], x2: d.box[2], y2: d.box[3],
  }));
  results.push({ file: frames[i], t: (i / FPS) * 1000, dets });

  detectionsTotal += dets.length;
  const falls = dets.filter((d) => d.className === 'fall').length;
  detectionsFall += falls;
  if (falls) framesWithFall += 1;
  if (i % 25 === 0) process.stdout.write('.');
}
console.log(' done');

// The stills-equivalent figure, so the two are directly comparable rather than
// quoted from different documents.
console.log(`\n  PER-FRAME (what MODEL_CARD's 11.5% measures):`);
console.log(`    ${detectionsFall} of ${detectionsTotal} person-detections read as \`fall\`` +
            `  = ${pct(detectionsFall, detectionsTotal)}`);
console.log(`    ${framesWithFall} of ${frames.length} frames contain at least one` +
            `  = ${pct(framesWithFall, frames.length)}`);

// --- tracker replay, per rate -----------------------------------------------

console.log(`\n  POST-TRACKER (what a user would actually be shown):`);
console.log(`    confirm requires ${TRACKER_TUNING.FALL_CONFIRM_MS}ms sustained` +
            ` at >= ${TRACKER_TUNING.FALL_ENTER_CONF} over a ${TRACKER_TUNING.VOTE_WINDOW}-result window\n`);

const dumped = new Set();
let worstRate = null;

for (const rate of REPLAY) {
  if (rate > FPS) {
    console.log(`    ${rate} fps  - skipped, cannot replay faster than the ${FPS} fps sampled`);
    continue;
  }
  const stride = FPS / rate;
  const tracker = new Tracker();
  const episodes = [];
  const open = new Map(); // trackId -> episode start time

  for (let i = 0; i < results.length; i += stride) {
    const r = results[Math.round(i)];
    if (!r) continue;
    for (const track of tracker.update(r.dets, r.t)) {
      if (track.fallConfirmed && !open.has(track.id)) {
        open.set(track.id, { start: r.t, file: r.file, conf: track.confidence, tier: track.tier });
      } else if (!track.fallConfirmed && open.has(track.id)) {
        episodes.push({ ...open.get(track.id), end: r.t, id: track.id });
        open.delete(track.id);
      }
    }
    // A track can disappear while still confirmed - close its episode too.
    const liveIds = new Set(tracker.live(r.t).map((t) => t.id));
    for (const [id, ep] of open) {
      if (!liveIds.has(id)) {
        episodes.push({ ...ep, end: r.t, id });
        open.delete(id);
      }
    }
  }
  for (const [id, ep] of open) episodes.push({ ...ep, end: results.at(-1).t, id });

  const perHour = episodes.length / (durationS / 3600);
  const verb = EXPECT_FALLS ? 'confirmed fall' : 'FALSE ALARM';
  console.log(`    ${String(rate).padStart(2)} fps  ${String(episodes.length).padStart(3)} ${verb}${episodes.length === 1 ? '' : 's'}` +
              `   = ${perHour.toFixed(1)} per hour of footage` +
              (rate === 2 ? '   <- the server\'s throttle' : '') +
              (rate === 1 ? '   <- mid-range Android on WASM' : ''));
  for (const ep of episodes.slice(0, 6)) {
    console.log(`             track #${ep.id} at ${fmtDuration(ep.start / 1000)}` +
                ` for ${((ep.end - ep.start) / 1000).toFixed(1)}s` +
                `  conf ${ep.conf.toFixed(2)} tier ${ep.tier}  (${ep.file})`);
    if (DUMP) dumped.add(ep.file);
  }
  if (episodes.length > 6) console.log(`             ... and ${episodes.length - 6} more`);
  if (worstRate === null || episodes.length > worstRate.n) worstRate = { rate, n: episodes.length };
}

// --- how much the tracker is actually buying --------------------------------

if (!EXPECT_FALLS && worstRate) {
  console.log(`\n  WHAT THE TRACKER SUPPRESSED:`);
  console.log(`    ${framesWithFall} frames looked like a fall; ${worstRate.n} survived to a` +
              ` confirmation at the worst rate (${worstRate.rate} fps).`);
  if (framesWithFall && !worstRate.n) {
    console.log(`    The 1.2s sustain absorbed all of them. That is the claim MODEL_CARD`);
    console.log(`    has been resting on the tracker for, now measured on this footage.`);
  } else if (worstRate.n) {
    console.log(`    The sustain did NOT absorb everything. Look at the frames above -`);
    console.log(`    a crouch held for over 1.2s is the expected culprit.`);
  }
}

if (DUMP && dumped.size) {
  fs.mkdirSync(DUMP, { recursive: true });
  for (const f of dumped) fs.copyFileSync(path.join(frameDir, f), path.join(DUMP, f));
  console.log(`\n  wrote ${dumped.size} triggering frames to ${DUMP}`);
}

console.log(`\n  Read this as a measurement of THIS footage, not of the product. One`);
console.log(`  person in one room is a data point; a deployment figure needs many.\n`);

if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });

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
