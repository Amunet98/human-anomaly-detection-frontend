// Pins the posture classifier's decision boundaries with synthetic skeletons.
// Run with:  node scripts/posture-check.mjs
//
// Same role tracker-check.mjs plays for the hysteresis constants: the numbers in
// posture.js are calibrated against a handful of measured fixtures, and this
// file is what stops a later "small tuning tweak" from quietly moving a boundary
// past a case that used to work. No model and no ONNX runtime involved - it
// feeds keypoints straight in, so it runs anywhere and takes milliseconds.
//
// Coordinates are in image space: y grows DOWNWARD. A standing person therefore
// has shoulders at a smaller y than hips.

import { classifyPosture, postureFeatures } from '../src/lib/detect/posture.js';
import { KEYPOINT_NAMES, KP_CONF_THRESHOLD } from '../src/lib/detect/constants.js';

let failures = 0;
function check(ok, label, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

// Builds a full 17-point keypoint array from a sparse {name: [x, y]} map.
// Anything unlisted is emitted at confidence 0, i.e. occluded.
function skeleton(points) {
  return KEYPOINT_NAMES.map((name) => {
    const p = points[name];
    return p
      ? { name, x: p[0], y: p[1], confidence: 0.9, visible: true }
      : { name, x: 0, y: 0, confidence: 0, visible: false };
  });
}

function boxAround(keypoints, pad = 10) {
  const vis = keypoints.filter((k) => k.confidence >= KP_CONF_THRESHOLD);
  const xs = vis.map((k) => k.x);
  const ys = vis.map((k) => k.y);
  return {
    x1: Math.min(...xs) - pad,
    y1: Math.min(...ys) - pad,
    x2: Math.max(...xs) + pad,
    y2: Math.max(...ys) + pad,
  };
}

// An upright figure, parameterised so tests can bend it.
function upright({ hipY = 200, kneeY = 300, ankleY = 400, kneeX = 100 } = {}) {
  return skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [92, hipY], rightHip: [108, hipY],
    leftKnee: [kneeX - 8, kneeY], rightKnee: [kneeX + 8, kneeY],
    leftAnkle: [92, ankleY], rightAnkle: [108, ankleY],
  });
}

console.log('\n=== fall: torso angle ===');
{
  // Shoulders and hips at the same height, far apart horizontally: fully
  // horizontal torso. This is the mid-air dive and the lying-on-the-floor case.
  const kps = skeleton({
    leftShoulder: [100, 195], rightShoulder: [100, 205],
    leftHip: [300, 195], rightHip: [300, 205],
    leftKnee: [380, 200], rightKnee: [380, 210],
    leftAnkle: [450, 200], rightAnkle: [450, 210],
  });
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.className === 'fall', 'horizontal torso is a fall', `${r.className} ${r.confidence.toFixed(2)} — ${r.reason}`);
  const f = postureFeatures(kps, boxAround(kps));
  check(f.torsoAngle > 85, 'torso angle reads ~90deg', `${f.torsoAngle.toFixed(1)}deg`);
}
{
  const kps = upright();
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.className !== 'fall', 'vertical torso is never a fall', `${r.className} — ${r.reason}`);
}
{
  // A 40-degree lean - reaching down, bending to tie a shoe. Must NOT be a fall:
  // this is the false-positive case the whole confirm window exists to protect.
  const kps = skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [176, 200], rightHip: [192, 200],
    leftKnee: [180, 300], rightKnee: [196, 300],
    leftAnkle: [180, 400], rightAnkle: [196, 400],
  });
  const f = postureFeatures(kps, boxAround(kps));
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(f.torsoAngle > 35 && f.torsoAngle < 50, 'test figure leans 35-50deg', `${f.torsoAngle.toFixed(1)}deg`);
  check(r.className !== 'fall', 'a 40deg lean is not a fall', `${r.className} — ${r.reason}`);
  check(r.confidence < 0.9 * 0.8, 'a lean is discounted, not ignored', `conf=${r.confidence.toFixed(2)}`);
}

console.log('\n=== sit vs stand ===');
{
  const kps = upright();
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.className === 'stand', 'straight legs, hips above knees -> stand', `${r.className} — ${r.reason}`);
}
{
  // Seated: knees level with the hips and bent forward to a ~90deg angle.
  const kps = skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [92, 200], rightHip: [108, 200],
    leftKnee: [182, 205], rightKnee: [198, 205],
    leftAnkle: [180, 300], rightAnkle: [196, 300],
  });
  const f = postureFeatures(kps, boxAround(kps));
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.className === 'sit', 'knees level with hips, bent -> sit', `${r.className} — ${r.reason}`);
  check(f.kneeAngle < 120, 'knee angle reads bent', `${f.kneeAngle.toFixed(0)}deg`);
}
{
  // The measured bench case: knees ABOVE the hips (legs drawn up), knee ~87deg.
  const kps = skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [92, 200], rightHip: [108, 200],
    leftKnee: [180, 184], rightKnee: [196, 184],
    leftAnkle: [178, 280], rightAnkle: [194, 280],
  });
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.className === 'sit', 'knees above hips -> sit', `${r.className} — ${r.reason}`);
}

console.log('\n=== occlusion tiers ===');
{
  const kps = upright();
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.tier === 'A', 'full leg chain is tier A', `tier=${r.tier}`);
}
{
  // Knees visible, ankles not - a desk or a low wall cutting the shot.
  const kps = skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [92, 200], rightHip: [108, 200],
    leftKnee: [92, 300], rightKnee: [108, 300],
  });
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.tier === 'B', 'no ankles is tier B', `tier=${r.tier}`);
  check(r.className === 'stand', 'tier B still resolves stand from kneeDrop', `${r.className}`);
  check(r.confidence < 0.9, 'tier B is discounted below personConf', `conf=${r.confidence.toFixed(2)}`);
}
{
  // The balcony case: hips visible, no legs at all.
  const kps = skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [92, 200], rightHip: [108, 200],
  });
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.tier === 'C', 'no knees is tier C', `tier=${r.tier}`);
  check(r.className === 'stand', 'tier C defaults to the non-alarming label', `${r.className}`);
  check(r.confidence <= 0.9 * 0.6 + 1e-9, 'tier C is heavily discounted', `conf=${r.confidence.toFixed(2)}`);
}
{
  // Head and shoulders only - no hips, so no torso vector at all.
  const kps = skeleton({
    nose: [100, 60], leftShoulder: [90, 100], rightShoulder: [110, 100],
  });
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(r.tier === 'D', 'no hips is tier D', `tier=${r.tier}`);
  check(r.confidence <= 0.9 * 0.4 + 1e-9, 'tier D is the lowest weight', `conf=${r.confidence.toFixed(2)}`);
}

console.log('\n=== a fall still outranks a tier-C guess ===');
{
  // The reason tier discounts are multiplicative: the tracker's vote is
  // confidence-weighted, so a confident fall has to beat a low-information
  // stand from another frame of the same track.
  const fallKps = skeleton({
    leftShoulder: [100, 195], rightShoulder: [100, 205],
    leftHip: [300, 195], rightHip: [300, 205],
  });
  const fall = classifyPosture(fallKps, boxAround(fallKps), 0.85);
  const guessKps = skeleton({
    leftShoulder: [90, 100], rightShoulder: [110, 100],
    leftHip: [92, 200], rightHip: [108, 200],
  });
  const guess = classifyPosture(guessKps, boxAround(guessKps), 0.95);
  check(
    fall.className === 'fall' && fall.confidence > guess.confidence,
    'a confident fall outweighs a higher-personConf tier-C stand',
    `fall=${fall.confidence.toFixed(2)} vs standGuess=${guess.confidence.toFixed(2)}`,
  );
}

console.log('\n=== degenerate input ===');
{
  const kps = skeleton({});
  const r = classifyPosture(kps, { x1: 0, y1: 0, x2: 0, y2: 0 }, 0.5);
  check(
    r && typeof r.className === 'string' && Number.isFinite(r.confidence),
    'no keypoints at all does not throw or emit NaN',
    `${r.className} ${r.confidence}`,
  );
}

console.log(failures === 0 ? '\nALL POSTURE CHECKS PASSED' : `\n${failures} POSTURE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
