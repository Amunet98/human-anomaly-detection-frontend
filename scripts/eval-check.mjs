// Measures posture-classification accuracy against a labelled fixture set.
// Run with:  node scripts/eval-check.mjs [--augment]
//
// This exists because the project had never measured accuracy at all -
// MODEL_CARD.md says so outright, and every mAP figure quoted in the READMEs
// and the portfolio was inherited from the *dataset's* published baseline, not
// from the file actually deployed. Without a number here, "the new model is
// better" is an assertion rather than a result.
//
// Like parity-check.mjs, this borrows the backend repo's onnxruntime-node and
// sharp rather than adding a second copy of a 100MB native dependency to this
// repo, and for the same reason it is deliberately NOT part of `npm run check`:
// check has to run without the sibling repo present.
//
// Scope, stated plainly: this scores whole-image top-1 posture against
// single-subject fixtures. It is not detection mAP - it says nothing about box
// localisation quality, and it would not notice a model that put the right
// label on a badly-placed box. That is a separate, heavier measurement (the
// training notebook's model.val()), and this is the cheap complement to it, not
// a replacement.
//
// Fixture resolution is load-bearing, not incidental. Most fixtures are
// downscaled to 960px to keep the repo light, but the lodge-group pair is stored
// at native 2048px on purpose: the bug they guard turns on a single keypoint
// confidence sitting within 0.01 of the threshold, and resampling the image
// moves it off the boundary. Downscaled, they passed against the very bug they
// were added for. If you re-encode a fixture, re-verify it still fails against
// the defect - a regression fixture that no longer reproduces guards nothing.
//
// --augment additionally replays each fixture through six perturbations
// (hflip, grayscale, darken, blur, downscale, centre-crop). That sweep is what
// caught the original failure - the deployed 3-class model scored 7/7 on sit
// but only 3/7 on stand, collapsing to `sit` at high confidence whenever the
// image was blurred or downscaled. Plain top-1 on clean images missed it
// entirely, so the sweep is the more informative of the two numbers here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BACKEND = path.resolve(FRONTEND, '../human-anomaly-detection-backend-main');
const FIXTURES = path.join(HERE, 'eval-fixtures');

if (!fs.existsSync(path.join(BACKEND, 'node_modules'))) {
  console.error(`Backend repo not found (or deps not installed) at:\n  ${BACKEND}\n`);
  console.error('Check it out alongside this repo and run `npm install` there.');
  process.exit(2);
}

const require = createRequire(BACKEND + '/');
const sharp = require('sharp');
const { analyzeBuffer } = require(path.join(BACKEND, 'inference'));

const CLASSES = ['fall', 'sit', 'squat', 'stand'];
const AUGMENT = process.argv.includes('--augment');

const labels = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'labels.json'), 'utf8'));

// Counts the checks that are pass/fail rather than scored: every-person and
// cross-photo consistency. The confusion matrix stays purely informational.
let failures = 0;

// Top-1 by confidence, mirroring inference.js's own `top` reduction - that is
// the value the socket path and StillResult actually surface to a user, so it
// is the thing worth scoring.
async function predict(buffer) {
  const { top } = await analyzeBuffer(buffer);
  return top ? top.className : null;
}

// Every posture in the frame, sorted, for fixtures that carry `expectedAll`.
//
// Top-1 is what a user sees, but it cannot express a multi-person frame: a photo
// of two seated people and one standing scores identically whether the standing
// one is right or wrong, because a `sit` wins the reduction either way. That is
// exactly how a real bug survived - a woman behind a sofa flipped between sit and
// stand across two near-identical photos while top-1 stayed `sit` on both.
async function predictAll(buffer) {
  const { detections } = await analyzeBuffer(buffer);
  return detections.map((d) => d.className).sort();
}

// The six perturbations. Chosen to be things a real deployment hits - a mirrored
// front camera, a night-mode frame, motion blur, a low-bitrate stream, a
// subject who does not fill the frame - not adversarial noise.
const PERTURBATIONS = {
  hflip: (img) => img.flop(),
  grayscale: (img) => img.grayscale(),
  'dark-40%': (img) => img.modulate({ brightness: 0.6 }),
  'blur-3px': (img) => img.blur(3),
  'downscale-320': (img) => img.resize(320),
  'crop-80%': (img, meta) =>
    img.extract({
      left: Math.round(meta.width * 0.1),
      top: Math.round(meta.height * 0.1),
      width: Math.round(meta.width * 0.8),
      height: Math.round(meta.height * 0.8),
    }),
};

function newMatrix() {
  const m = {};
  for (const truth of CLASSES) {
    m[truth] = Object.fromEntries([...CLASSES.map((c) => [c, 0]), ['none', 0]]);
  }
  return m;
}

function report(matrix, title) {
  console.log(`\n=== ${title} ===\n`);
  const header = ['truth \\ pred', ...CLASSES, 'none'];
  console.log('  ' + header.map((h) => h.padEnd(13)).join(''));
  for (const truth of CLASSES) {
    const row = [truth, ...CLASSES.map((c) => matrix[truth][c]), matrix[truth].none];
    console.log('  ' + row.map((v) => String(v).padEnd(13)).join(''));
  }

  console.log('\n  per-class:');
  let totalCorrect = 0;
  let total = 0;
  const f1s = [];
  for (const c of CLASSES) {
    const tp = matrix[c][c];
    const fn = CLASSES.reduce((s, p) => s + (p === c ? 0 : matrix[c][p]), 0) + matrix[c].none;
    const fp = CLASSES.reduce((s, t) => s + (t === c ? 0 : matrix[t][c]), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    // A class with no ground-truth rows contributes nothing to macro-F1. Left in,
    // an unfixtured class scores 0 and drags the average down by 1/|CLASSES| -
    // adding `squat` to CLASS_NAMES alone moved this from 1.000 to 0.750 while
    // every actual prediction was unchanged. Absent is not the same as wrong.
    if (tp + fn > 0) f1s.push(f1);
    totalCorrect += tp;
    total += tp + fn;
    console.log(
      `    ${c.padEnd(6)} P=${precision.toFixed(3)}  R=${recall.toFixed(3)}  F1=${f1.toFixed(3)}` +
        `   (tp=${tp} fp=${fp} fn=${fn})`,
    );
  }
  const acc = total ? totalCorrect / total : 0;
  const macroF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;
  const absent = CLASSES.length - f1s.length;
  console.log(
    `\n  accuracy ${totalCorrect}/${total} = ${(acc * 100).toFixed(1)}%   ` +
      `macro-F1 ${macroF1.toFixed(3)}` +
      (absent ? `  (over ${f1s.length} of ${CLASSES.length} classes; ${absent} unfixtured)` : ''),
  );
  return { acc, macroF1 };
}

// --- clean pass ---------------------------------------------------------

const clean = newMatrix();
const perFixture = [];

for (const { file, expected } of labels) {
  const buf = fs.readFileSync(path.join(FIXTURES, file));
  const got = await predict(buf);
  clean[expected][got ?? 'none'] += 1;
  perFixture.push({ file, expected, got });
}

console.log('\n=== per-fixture (clean) ===\n');
for (const { file, expected, got } of perFixture) {
  const mark = got === expected ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${file.padEnd(22)} expected=${String(expected).padEnd(6)} got=${got ?? 'none'}`);
}

report(clean, 'confusion matrix (clean)');

// --- multi-person and cross-photo consistency -------------------------------

const multi = labels.filter((l) => l.expectedAll);
if (multi.length) {
  console.log('\n=== every-person check (fixtures with expectedAll) ===\n');
  const seen = new Map();
  for (const { file, expectedAll } of multi) {
    const got = await predictAll(fs.readFileSync(path.join(FIXTURES, file)));
    const want = [...expectedAll].sort();
    const ok = got.length === want.length && got.every((c, i) => c === want[i]);
    if (!ok) failures += 1;
    seen.set(file, got);
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(22)} expected=[${want.join(',')}] got=[${got.join(',')}]`,
    );
  }

  // Pairs of near-identical photos must not disagree. A classifier that is
  // right on average but flips between two shots of the same scene is not
  // usable on video, where consecutive frames differ far less than these do.
  const pairs = multi.filter((l) => l.consistentWith && seen.has(l.consistentWith));
  if (pairs.length) {
    console.log('\n=== cross-photo consistency ===\n');
    const done = new Set();
    for (const { file, consistentWith } of pairs) {
      const key = [file, consistentWith].sort().join('|');
      if (done.has(key)) continue;
      done.add(key);
      const a = seen.get(file);
      const b = seen.get(consistentWith);
      const ok = a.length === b.length && a.every((c, i) => c === b[i]);
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? 'PASS' : 'FAIL'}  ${file} vs ${consistentWith}  [${a.join(',')}] vs [${b.join(',')}]`,
      );
    }
  }
}

// --- perturbation sweep -------------------------------------------------

if (AUGMENT) {
  const aug = newMatrix();
  const byPerturbation = {};

  for (const name of Object.keys(PERTURBATIONS)) {
    byPerturbation[name] = { correct: 0, total: 0 };
  }

  console.log('\n=== per-fixture (perturbed) ===\n');
  for (const { file, expected } of labels) {
    const src = fs.readFileSync(path.join(FIXTURES, file));
    const meta = await sharp(src).metadata();
    const results = [];
    for (const [name, fn] of Object.entries(PERTURBATIONS)) {
      const buf = await fn(sharp(src), meta).toBuffer();
      const got = await predict(buf);
      aug[expected][got ?? 'none'] += 1;
      byPerturbation[name].total += 1;
      if (got === expected) byPerturbation[name].correct += 1;
      results.push(`${name}=${got === expected ? '.' : (got ?? 'none')}`);
    }
    console.log(`  ${file.padEnd(22)} ${results.join('  ')}`);
  }
  console.log('\n  ("." means the perturbation did not change the answer)');

  report(aug, 'confusion matrix (perturbed)');

  console.log('\n  survival by perturbation:');
  for (const [name, { correct, total }] of Object.entries(byPerturbation)) {
    console.log(`    ${name.padEnd(14)} ${correct}/${total}`);
  }
}

if (failures === 0) {
  console.log('\nEVAL COMPLETE - accuracy figures above are informational; the');
  console.log('every-person and consistency checks are pass/fail and all passed.\n');
  process.exit(0);
} else {
  console.log(`\n${failures} EVAL CHECK(S) FAILED\n`);
  process.exit(1);
}
