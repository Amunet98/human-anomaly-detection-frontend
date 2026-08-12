// Asserts the generated squat probe agrees with the sklearn model it came from.
// Run with:  node scripts/squat-probe-check.mjs   (npm run squat-probe)
//
// Why this exists rather than trusting the code generator.
//
// The probe's 52 features are built from the WIRE form of a detection, not the
// internal one: coordinates are box-relative and integer-rounded, and any joint
// below KP_CONF_THRESHOLD contributes (0, 0, 0) - confidence zeroed too, since
// `c === 0` is the marker the model was trained to read as "joint absent".
// Inside posture.js keypoints are full precision and never nulled, so the JS
// feature builder has to reconstruct a transform that happens somewhere else
// entirely (keypointsForWire in inference.js). Nothing about that is enforced by
// the type system, and getting it wrong does not throw - it silently feeds the
// model a distribution it never saw, on exactly the occluded joints that decide
// occlusion tier. The failure mode is a quietly worse classifier, which is the
// hardest kind to notice.
//
// So: train_squat_probe.py dumps 300 real corpus-2023 rows with both the feature
// vector and the probability sklearn computed for them, and this walks the same
// rows through the shipped JS. Features and probability are compared separately,
// so a failure says which half drifted.
//
// The rows are from corpus-2023 deliberately - the domain the probe was NOT
// trained on, so they carry the occlusion and framing shapes POLAR
// under-represents.
//
// Part of `npm run check`: it needs no ONNX session, no corpus and no sibling
// repo, just the two generated files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BACKEND = path.resolve(FRONTEND, '../human-anomaly-detection-backend-main');
const FIXTURES = path.join(BACKEND, 'training', 'squat-probe-fixtures.json');

if (!fs.existsSync(FIXTURES)) {
  console.error(`Reference fixtures not found at:\n  ${FIXTURES}\n`);
  console.error('Regenerate with: .venv/bin/python training/train_squat_probe.py');
  process.exit(2);
}

const { rows, kpConfThreshold } = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
const { SQUAT_PROBE_THRESHOLD, probeFeatures, squatProbability } = await import(
  `${FRONTEND}/src/lib/detect/squat-probe.js`
);

// Tolerances. Features are exact arithmetic on both sides and should agree to
// float noise; the probability accumulates 100 leaf values through an exp, so it
// gets a little more room. Neither is loose enough to hide a real encoding bug -
// a single mis-zeroed joint moves the probability by orders of magnitude more.
const FEATURE_TOL = 1e-9;
const PROB_TOL = 1e-9;

let featureFails = 0;
let probFails = 0;
let worstFeature = 0;
let worstProb = 0;
let crossings = 0;

for (const row of rows) {
  // The wire row as posture.js would see it after rehydration: nulled
  // coordinates stay null, confidence is the rounded wire value.
  const keypoints = row.kp.map(([x, y, c]) => ({ x, y, confidence: c }));
  const box = { x1: row.box[0], y1: row.box[1], x2: row.box[2], y2: row.box[3] };

  const got = probeFeatures(keypoints, box, kpConfThreshold);
  for (let i = 0; i < 52; i += 1) {
    const d = Math.abs(got[i] - row.features[i]);
    if (d > worstFeature) worstFeature = d;
    if (d > FEATURE_TOL) {
      if (featureFails < 5) {
        console.log(
          `  FEATURE  ${row.file}  index ${i}: js=${got[i]} python=${row.features[i]}`,
        );
      }
      featureFails += 1;
    }
  }

  const p = squatProbability(got);
  const d = Math.abs(p - row.p);
  if (d > worstProb) worstProb = d;
  if (d > PROB_TOL) {
    if (probFails < 5) {
      console.log(`  PROB     ${row.file}: js=${p} python=${row.p}  delta=${d}`);
    }
    probFails += 1;
  }
  // A disagreement that lands either side of the threshold is the one that
  // changes an answer, so it is counted separately from raw numeric drift.
  if (p >= SQUAT_PROBE_THRESHOLD !== row.p >= SQUAT_PROBE_THRESHOLD) crossings += 1;
}

console.log(`\nsquat probe parity over ${rows.length} corpus-2023 rows`);
console.log(`  threshold          ${SQUAT_PROBE_THRESHOLD}`);
console.log(`  worst feature diff ${worstFeature.toExponential(2)}  (tol ${FEATURE_TOL})`);
console.log(`  worst prob diff    ${worstProb.toExponential(2)}  (tol ${PROB_TOL})`);
console.log(`  rows that would decide differently: ${crossings}`);

const fired = rows.filter((r) => r.p >= SQUAT_PROBE_THRESHOLD).length;
console.log(`  (${fired} of ${rows.length} reference rows are above the threshold, so the`);
console.log('   check exercises both sides of it rather than only the quiet one)');

if (featureFails || probFails || crossings) {
  console.log(
    `\nSQUAT PROBE CHECK FAILED - ${featureFails} feature diffs, ` +
      `${probFails} probability diffs, ${crossings} decision changes\n`,
  );
  console.log('If the encoding changed on purpose, regenerate both halves together:');
  console.log('  .venv/bin/python training/train_squat_probe.py\n');
  process.exit(1);
}

console.log('\nSQUAT PROBE CHECK PASSED - the shipped JS reproduces sklearn exactly.\n');
