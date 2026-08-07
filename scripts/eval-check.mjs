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

const CLASSES = ['fall', 'sit', 'stand'];
const AUGMENT = process.argv.includes('--augment');

const labels = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'labels.json'), 'utf8'));

// Top-1 by confidence, mirroring inference.js's own `top` reduction - that is
// the value the socket path and StillResult actually surface to a user, so it
// is the thing worth scoring.
async function predict(buffer) {
  const { top } = await analyzeBuffer(buffer);
  return top ? top.className : null;
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
    m[truth] = { fall: 0, sit: 0, stand: 0, none: 0 };
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
    f1s.push(f1);
    totalCorrect += tp;
    total += tp + fn;
    console.log(
      `    ${c.padEnd(6)} P=${precision.toFixed(3)}  R=${recall.toFixed(3)}  F1=${f1.toFixed(3)}` +
        `   (tp=${tp} fp=${fp} fn=${fn})`,
    );
  }
  const acc = total ? totalCorrect / total : 0;
  const macroF1 = f1s.reduce((a, b) => a + b, 0) / f1s.length;
  console.log(
    `\n  accuracy ${totalCorrect}/${total} = ${(acc * 100).toFixed(1)}%   macro-F1 ${macroF1.toFixed(3)}`,
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

console.log('\nEVAL COMPLETE (informational - this script does not gate on a threshold)\n');
