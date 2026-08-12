// Measures the raw geometric features posture.js decides on, across the whole
// 2023 corpus, and reports their distribution per ground-truth class.
//
// Run with:  node scripts/feature-dump.mjs [--limit N] [--out FILE] [--keypoints]
//                                          [--corpus DIR]
//
// With --keypoints it doubles as a training-set exporter: every row gains the
// raw 17-joint pose, which is the input a keypoints -> posture classifier would
// learn from. See the KEYPOINTS constant below for the row shape and for the
// one trap in consuming it (occluded joints are null, not zero).
//
// Why this exists: every threshold in posture.js is currently justified by five
// to eight measured values, quoted inline in its comments. That was honest at
// the time - MODEL_CARD.md says the fixture set "no longer discriminates and has
// to grow before it can say anything more" - but it means nobody knows whether
// FALL_TORSO_ANGLE=50 sits in a genuinely empty band or merely in a gap that
// eight images happened to leave. This script answers that with ~4,900 real
// images instead, without training anything.
//
// It is a *measurement* tool, not a test. It has no pass/fail and is not part of
// `npm run check`. Like eval-check.mjs and parity-check.mjs it borrows the
// backend repo's onnxruntime-node and sharp rather than adding a second copy of
// a 100MB native dependency here, so it needs that repo installed alongside.
//
// Two caveats on the ground truth it reports against, both load-bearing:
//
//   1. The 2023 labels are box-level and were produced for a *detector*, not for
//      this system. They are used here only to group measurements by class, so a
//      mislabelled box widens a distribution rather than breaking anything. Do
//      not read the class assignments as an accuracy figure - eval-check.mjs on
//      hand-verified fixtures is what measures accuracy.
//   2. Class `squat` in that corpus means "crouching bystander at an accident
//      scene", and in those same images the genuinely fallen person is often
//      left unlabelled entirely. Its rows are worth measuring precisely because
//      they are the hard-negative case, but they are not clean squat examples.
//
// The two squat features (hipAnkleDrop, stanceOffset) are computed *here* rather
// than in posture.js on purpose: this run is what calibrates them. They move
// into posture.js once there are measured numbers to justify a threshold.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const BACKEND = path.join(ROOT, 'human-anomaly-detection-backend-main');

// Which staged corpus to read. build-corpus.py writes corpus-2023 (falls) and
// corpus-polar (sit/squat/stand) in the same manifest shape, so this script runs
// over either unchanged - which is the point of them sharing a shape.
const corpusArg = (() => {
  const i = process.argv.indexOf('--corpus');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'corpus-2023';
})();
const CORPUS = path.isAbsolute(corpusArg) ? corpusArg : path.join(ROOT, corpusArg);

if (!fs.existsSync(path.join(BACKEND, 'node_modules'))) {
  console.error(`Backend repo not found (or deps not installed) at:\n  ${BACKEND}\n`);
  console.error('Check it out alongside this repo and run `npm install` there.');
  process.exit(2);
}
if (!fs.existsSync(path.join(CORPUS, 'manifest.jsonl'))) {
  console.error(`Corpus not staged at:\n  ${CORPUS}\n`);
  console.error('Run scripts/calibration/build-corpus.py first, e.g.');
  console.error('  python3 scripts/calibration/build-corpus.py --dataset polar');
  process.exit(2);
}

const require = createRequire(BACKEND + '/');
const { analyzeBuffer } = require(path.join(BACKEND, 'inference'));
const { postureFeatures } = require(path.join(BACKEND, 'posture'));

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LIMIT = Number(argOf('--limit', 0));
const OUT = path.resolve(argOf('--out', path.join(CORPUS, 'features.jsonl')));

// --keypoints appends the raw 17-joint pose to every row, which is what a
// keypoints -> posture classifier trains on. Opt-in rather than default for two
// reasons: the analysis scripts beside this one read the existing row shape, and
// the keypoints roughly triple the file.
//
// Emitted as [x, y, c] triples in COCO index order (KEYPOINT_NAMES in
// constants.js), not as named objects - 17 names repeated 9,331 times is most of
// the file for no information.
//
// **Occluded joints keep their null coordinates.** Do not coerce them to 0 when
// consuming this: 0 is a legitimate image coordinate, so a null-to-zero
// conversion silently teaches a model that unseen joints live in the top-left
// corner. Either mask them or carry the confidence as an input channel - the
// confidence is what says whether the coordinate means anything.
const KEYPOINTS = process.argv.includes('--keypoints');

// A detection is assigned the class of the ground-truth box it overlaps most,
// and only if that overlap is convincing. 0.5 is the conventional floor and is
// deliberately strict here: the pose model finds *every* person in frame while
// the 2023 annotations are frequently partial, so a loose gate would hand a
// bystander the label of the person next to them.
const MATCH_IOU = 0.5;

const KP = {
  leftShoulder: 5, rightShoulder: 6,
  leftHip: 11, rightHip: 12,
  leftKnee: 13, rightKnee: 14,
  leftAnkle: 15, rightAnkle: 16,
};

// Mirrors posture.js's own threshold. Imported by value rather than from
// constants.js because the backend copy is what inference.js actually ran.
const KP_CONF = 0.65;

function iouOf(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (!inter) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

// analyzeBuffer returns keypoints in wire form - occluded joints carry null
// coordinates and the confidence is rounded to 2dp. postureFeatures wants the
// internal shape. The conversion is lossless for our purposes: a nulled joint is
// below KP_CONF_THRESHOLD and postureFeatures would have discarded it anyway,
// and whole-pixel coordinates on a 640px image do not move an angle measurably.
function rehydrate(wire) {
  return wire.map((k) => ({
    name: k.name,
    x: k.x,
    y: k.y,
    confidence: k.c,
  }));
}

const midpoint = (kps, l, r) => {
  const a = kps[l];
  const b = kps[r];
  const av = a && a.x !== null && a.confidence >= KP_CONF;
  const bv = b && b.x !== null && b.confidence >= KP_CONF;
  if (av && bv) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (av) return { x: a.x, y: a.y };
  if (bv) return { x: b.x, y: b.y };
  return null;
};

// The two candidate squat features, per the plan. Both are ratios normalised by
// torso length, so they are scale-free and - being ratios of vertical extents
// against a vertical reference - largely insensitive to camera pitch.
//
//   hipAnkleDrop  how far below the hips the ankles sit, over torso length.
//                 A chair-sit puts a full vertical shin below the hip; a squat
//                 folds the body so the heels come up toward the hips.
//   stanceOffset  how far the ankles sit horizontally from the hips, over torso
//                 length. A chair-sit projects the feet forward; a squat keeps
//                 them under the centre of mass.
//
// Hypothesised separations are in the plan. This script exists to replace them
// with measurements, so nothing here assumes a threshold.
function squatFeatures(kps) {
  const shoulder = midpoint(kps, KP.leftShoulder, KP.rightShoulder);
  const hip = midpoint(kps, KP.leftHip, KP.rightHip);
  const ankle = midpoint(kps, KP.leftAnkle, KP.rightAnkle);
  if (!shoulder || !hip || !ankle) return { hipAnkleDrop: null, stanceOffset: null };

  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (!torso) return { hipAnkleDrop: null, stanceOffset: null };

  return {
    hipAnkleDrop: (ankle.y - hip.y) / torso,
    stanceOffset: Math.abs(ankle.x - hip.x) / torso,
  };
}

// --- distribution reporting ----------------------------------------------

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function describe(values) {
  const s = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    min: s[0],
    p05: quantile(s, 0.05),
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    p95: quantile(s, 0.95),
    max: s[s.length - 1],
  };
}

const FEATURES = [
  'torsoAngle',
  'kneeDrop',
  'kneeAngle',
  'thighShinRatio',
  'aspect',
  'hipAnkleDrop',
  'stanceOffset',
];

function reportFeature(rows, feature, classes) {
  console.log(`\n--- ${feature}`);
  console.log(
    '  ' +
      ['class', 'n', 'min', 'p05', 'p25', 'med', 'p75', 'p95', 'max']
        .map((h) => h.padEnd(9))
        .join(''),
  );
  for (const c of classes) {
    const d = describe(rows.filter((r) => r.gt === c).map((r) => r.f[feature]));
    if (!d) {
      console.log('  ' + c.padEnd(9) + '0'.padEnd(9) + '(no measurable values)');
      continue;
    }
    const fmt = (v) => (v === null ? '-' : v.toFixed(2)).padEnd(9);
    console.log(
      '  ' +
        c.padEnd(9) +
        String(d.n).padEnd(9) +
        [d.min, d.p05, d.p25, d.median, d.p75, d.p95, d.max].map(fmt).join(''),
    );
  }
}

// --- main -----------------------------------------------------------------

const manifest = fs
  .readFileSync(path.join(CORPUS, 'manifest.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const work = LIMIT ? manifest.slice(0, LIMIT) : manifest;
console.log(`Corpus: ${work.length} images${LIMIT ? ` (limited from ${manifest.length})` : ''}`);
console.log(`Model : ${path.join(BACKEND, 'best.onnx')}`);
console.log(`Out   : ${OUT}\n`);

const out = fs.createWriteStream(OUT);
const rows = [];
const tierCounts = {};
let detections = 0;
let matched = 0;
let unmatched = 0;
const started = Date.now();

for (let i = 0; i < work.length; i++) {
  const m = work[i];
  const buffer = fs.readFileSync(path.join(CORPUS, 'images', m.file));

  let result;
  try {
    result = await analyzeBuffer(buffer);
  } catch (err) {
    console.error(`  ! ${m.file}: ${err.message}`);
    continue;
  }

  for (const d of result.detections) {
    detections++;
    const kps = rehydrate(d.keypoints);
    const f = { ...postureFeatures(kps, { x1: d.box[0], y1: d.box[1], x2: d.box[2], y2: d.box[3] }), ...squatFeatures(kps) };

    // Best-overlapping ground-truth box, if any clears MATCH_IOU.
    let best = null;
    let bestIou = 0;
    for (const g of m.gt) {
      const v = iouOf(d.box, g.box);
      if (v > bestIou) {
        bestIou = v;
        best = g;
      }
    }
    const gt = bestIou >= MATCH_IOU ? best.cls : null;
    if (gt) matched++;
    else unmatched++;

    tierCounts[d.tier] = (tierCounts[d.tier] || 0) + 1;

    const row = {
      file: m.file,
      split: m.split,
      gt,
      iou: Number(bestIou.toFixed(3)),
      pred: d.className,
      conf: d.confidence,
      personConf: d.personConfidence,
      tier: d.tier,
      box: d.box,
      f: Object.fromEntries(
        FEATURES.map((k) => [k, f[k] === null || f[k] === undefined ? null : Number(f[k].toFixed(4))]),
      ),
    };
    if (KEYPOINTS) {
      // Raw image coordinates, deliberately not normalised. Normalisation is a
      // modelling choice - by box, by torso length, by image - and baking one in
      // here would force it on every consumer. `box` is on the row already, so
      // any of them can be recovered.
      row.kp = kps.map((k) => [
        k.x === null ? null : Number(k.x.toFixed(1)),
        k.y === null ? null : Number(k.y.toFixed(1)),
        k.confidence,
      ]);
    }
    rows.push(row);
    out.write(JSON.stringify(row) + '\n');
  }

  if ((i + 1) % 250 === 0 || i === work.length - 1) {
    const secs = (Date.now() - started) / 1000;
    const rate = (i + 1) / secs;
    const eta = (work.length - i - 1) / rate;
    process.stdout.write(
      `\r  ${i + 1}/${work.length} images  ${detections} detections  ` +
        `${rate.toFixed(1)} img/s  eta ${Math.round(eta)}s   `,
    );
  }
}
out.end();
console.log('\n');

const CLASSES = ['fall', 'sit', 'squat', 'stand'];

console.log('=== coverage ===\n');
console.log(`  images            : ${work.length}`);
console.log(`  detections        : ${detections}`);
console.log(`  matched to a gt box (IoU >= ${MATCH_IOU}) : ${matched}`);
console.log(`  unmatched (no gt overlap)                 : ${unmatched}`);
console.log(`  occlusion tiers   :`, tierCounts);
console.log('\n  matched by class  :');
for (const c of CLASSES) {
  console.log(`    ${c.padEnd(6)} ${rows.filter((r) => r.gt === c).length}`);
}

console.log('\n\n=== feature distributions by ground-truth class ===');
console.log('\n(Reminder: `squat` here is the 2023 corpus\'s crouching-bystander');
console.log(' class, not clean squats. See the header of this file.)');
for (const feature of FEATURES) {
  reportFeature(rows, feature, CLASSES);
}

console.log(`\n\nWrote ${rows.length} rows to ${OUT}`);
