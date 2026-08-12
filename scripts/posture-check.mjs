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
import { postureReadout, CLASS_COLORS } from '../src/lib/detect/readout.js';

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

console.log('\n=== seated facing camera, legs extended (thigh foreshortening) ===');
{
  // Real keypoints from scripts/eval-fixtures/bench-sit-frontal.jpg - a woman
  // seated on a bench with her legs stretched forward toward the lens. This
  // shipped as `stand 63%` before thigh/shin foreshortening was added, because
  // both of the other leg features genuinely read as standing here: her knees
  // are well below her hips and her legs are almost straight.
  const kps = skeleton({
    leftShoulder: [814, 904], rightShoulder: [621, 924],
    leftHip: [726, 1197], rightHip: [601, 1200],
    leftKnee: [659, 1371], rightKnee: [568, 1394],
    leftAnkle: [604, 1692], rightAnkle: [538, 1721],
  });
  const box = { x1: 439, y1: 687, x2: 873, y2: 1896 };
  const f = postureFeatures(kps, box);
  const r = classifyPosture(kps, box, 0.894);

  check(f.kneeDrop > 0.5, 'kneeDrop alone would say STAND', `kneeDrop=${f.kneeDrop.toFixed(2)}`);
  check(f.kneeAngle > 150, 'kneeAngle alone would say STAND', `kneeAngle=${f.kneeAngle.toFixed(0)}deg`);
  check(f.thighShinRatio < 0.75, 'but the thigh is foreshortened', `thigh/shin=${f.thighShinRatio.toFixed(2)}`);
  check(r.className === 'sit', 'classified as SIT', `${r.className} ${r.confidence.toFixed(2)} — ${r.reason}`);
}
{
  // The statue seated beside her, same photo - even more foreshortened.
  const kps = skeleton({
    leftShoulder: [1117, 1032], rightShoulder: [880, 1039],
    leftHip: [1071, 1272], rightHip: [913, 1276],
    leftKnee: [1088, 1358], rightKnee: [900, 1360],
    leftAnkle: [1069, 1542], rightAnkle: [927, 1536],
  });
  const r = classifyPosture(kps, { x1: 802, y1: 771, x2: 1181, y2: 1663 }, 0.913);
  check(r.className === 'sit', 'the second seated subject is SIT too', `${r.className} — ${r.reason}`);
}
{
  // Real keypoints from a standing background pedestrian in street-fall.jpg.
  // Guards the other direction: the new rule must not drag standers into sit.
  // Measured standers cluster at thigh/shin 1.00-1.11.
  const kps = upright();
  const f = postureFeatures(kps, boxAround(kps));
  const r = classifyPosture(kps, boxAround(kps), 0.9);
  check(f.thighShinRatio >= 0.75, 'an upright figure is not foreshortened', `thigh/shin=${f.thighShinRatio.toFixed(2)}`);
  check(r.className === 'stand', 'still classified as STAND', `${r.className} — ${r.reason}`);
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

console.log('\n=== squat ===');
{
  // Real keypoints, from corpus-2023/images/fall_1091.jpg - a bystander crouched
  // beside someone on the ground. Kept as measured rather than idealised: the
  // point of a real skeleton here is that it carries the asymmetry and the
  // imperfect joint placement a hand-built one would smooth away.
  const crouch = skeleton({
    leftShoulder: [142, 203], rightShoulder: [184, 243],
    leftHip: [46, 435], rightHip: [70, 456],
    leftKnee: [210, 451], rightKnee: [226, 492],
    leftAnkle: [83, 541], rightAnkle: [101, 605],
  });
  const f = postureFeatures(crouch, boxAround(crouch));
  check(f.kneeAngle < 130, 'crouch: knee is deeply bent', `${f.kneeAngle.toFixed(0)}deg`);
  check(
    f.hipAnkleDrop >= 0.3 && f.hipAnkleDrop < 1.0,
    'crouch: hips sit low over the ankles',
    `hipAnkleDrop=${f.hipAnkleDrop.toFixed(2)}`,
  );
  check(f.stanceOffset < 0.5, 'crouch: feet stay under the hips', `stanceOffset=${f.stanceOffset.toFixed(2)}`);
  const r = classifyPosture(crouch, boxAround(crouch), 0.9);
  check(r.className === 'squat', 'classified as SQUAT', `${r.className} ${r.confidence.toFixed(2)} — ${r.reason}`);

  // The gate needs all three leg features, so it must be unreachable without
  // ankles. A waist-up crouch is geometrically identical to a chair-sit and has
  // to answer `sit`, not guess `squat` - the tier-B discount is the honest reply.
  const noAnkles = skeleton({
    leftShoulder: [142, 203], rightShoulder: [184, 243],
    leftHip: [46, 435], rightHip: [70, 456],
    leftKnee: [210, 451], rightKnee: [226, 492],
  });
  const rB = classifyPosture(noAnkles, boxAround(noAnkles), 0.9);
  check(rB.tier === 'B', 'crouch without ankles is tier B', `tier=${rB.tier}`);
  check(rB.className !== 'squat', 'tier B never emits squat', `${rB.className}`);

  // REGRESSION: hipAnkleDrop is signed, and without a floor the gate accepted
  // bodies with the ankles ABOVE the hips - sprawled on the ground, legs up.
  // Found in the wild on corpus image fall25.jpg, which came back
  // `knee 128deg, hips -2.36 over ankles`. A fall relabelled squat is a missed
  // alarm, which is why this is a floor and not a cosmetic bound.
  const inverted = skeleton({
    leftShoulder: [100, 300], rightShoulder: [120, 300],
    leftHip: [104, 400], rightHip: [116, 400],
    leftKnee: [150, 330], rightKnee: [160, 340],
    leftAnkle: [140, 180], rightAnkle: [150, 190],
  });
  const fi = postureFeatures(inverted, boxAround(inverted));
  check(fi.hipAnkleDrop < 0, 'inverted figure has ankles above hips', `hipAnkleDrop=${fi.hipAnkleDrop.toFixed(2)}`);
  const ri = classifyPosture(inverted, boxAround(inverted), 0.9);
  check(ri.className !== 'squat', 'ankles above hips is never a squat', `${ri.className}`);

  // A standing figure must not be pulled in: its feet are under its hips too, so
  // stanceOffset alone cannot exclude it - kneeAngle and hipAnkleDrop must.
  const tall = upright();
  const rs = classifyPosture(tall, boxAround(tall), 0.9);
  check(rs.className === 'stand', 'an upright figure is still STAND', `${rs.className}`);
}

console.log('\n=== kneeling reads as a fall ===');
{
  // Shin foreshortened far past anything an in-plane leg produces: the shin
  // points at the lens. This is the on-all-fours case that torsoAngle misses
  // because the torso is still upright - measured on corpus image fall084.jpg,
  // an elderly man down on his hands and knees at thighShinRatio 5.07.
  const kneeling = skeleton({
    leftShoulder: [92, 100], rightShoulder: [108, 100],
    leftHip: [92, 200], rightHip: [108, 200],
    leftKnee: [92, 300], rightKnee: [108, 300],
    leftAnkle: [94, 318], rightAnkle: [106, 318],
  });
  const f = postureFeatures(kneeling, boxAround(kneeling));
  check(f.thighShinRatio >= 2.5, 'shin is foreshortened past 2.5x', `thigh/shin=${f.thighShinRatio.toFixed(2)}`);
  check(f.torsoAngle < 50, 'torso alone would NOT call this a fall', `${f.torsoAngle.toFixed(1)}deg`);
  const r = classifyPosture(kneeling, boxAround(kneeling), 0.9);
  check(r.className === 'fall', 'classified as FALL', `${r.className} ${r.confidence.toFixed(2)} — ${r.reason}`);

  // The ordinary in-plane leg must stay well clear of the gate.
  const tall = upright();
  const ft = postureFeatures(tall, boxAround(tall));
  check(ft.thighShinRatio < 2.5, 'an upright leg is nowhere near the gate', `thigh/shin=${ft.thighShinRatio.toFixed(2)}`);
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

// Knees above hips is never a sit. Found 2026-08-12 by replaying a dojo video:
// a man flat on his back read `sit` at 0.77 because his torso angle (25deg) sat
// under the fall gate and a negative kneeDrop is trivially under STAND_KNEE_DROP.
console.log('\n=== a body on its back is not seated ===');
{
  // Knees drawn up well above the hips, torso not horizontal enough to trip the
  // main fall gate on its own.
  const onBack = skeleton({
    leftShoulder: [100, 200], rightShoulder: [112, 202],
    leftHip: [140, 240], rightHip: [152, 242],
    leftKnee: [150, 160], rightKnee: [162, 162],
    leftAnkle: [170, 210], rightAnkle: [182, 212],
  });
  const f = postureFeatures(onBack, boxAround(onBack));
  check(f.kneeDrop < -0.25, 'knees sit above the hips', `kneeDrop=${f.kneeDrop.toFixed(2)}`);
  const r = classifyPosture(onBack, boxAround(onBack), 0.9);
  check(r.className === 'fall', 'classified as FALL, not sit', `${r.className} — ${r.reason}`);

  // The floor is at -0.25 and not 0 because a real bench-sit was measured at
  // -0.16, legs drawn up. That case must survive.
  const benchSit = skeleton({
    leftShoulder: [100, 100], rightShoulder: [112, 100],
    leftHip: [100, 180], rightHip: [112, 180],
    leftKnee: [140, 168], rightKnee: [152, 168],
    leftAnkle: [140, 230], rightAnkle: [152, 230],
  });
  const fb = postureFeatures(benchSit, boxAround(benchSit));
  check(
    fb.kneeDrop < 0 && fb.kneeDrop > -0.25,
    'the bench-sit case sits between 0 and the floor',
    `kneeDrop=${fb.kneeDrop.toFixed(2)}`,
  );
  check(
    classifyPosture(benchSit, boxAround(benchSit), 0.9).className === 'sit',
    'a mildly-negative kneeDrop is still SIT',
  );
}

// A box wider than it is tall means a horizontal body. This used to also require
// torsoAngle >= 30, which is self-defeating: a body foreshortened along the view
// axis has a LOW torso angle by construction.
console.log('\n=== a wide box is a fall regardless of torso angle ===');
{
  // Lying along the view axis: the torso points at the lens, so shoulder-mid and
  // hip-mid are nearly stacked and torsoAngle reads ~7deg - upright. Only the
  // box gives it away. This is the prone-fall-view-axis shape.
  const flat = skeleton({
    leftShoulder: [195, 300], rightShoulder: [205, 300],
    leftHip: [200, 340], rightHip: [210, 340],
    leftKnee: [250, 342], rightKnee: [260, 342],
    leftAnkle: [300, 344], rightAnkle: [310, 344],
  });
  const box = boxAround(flat);
  const f = postureFeatures(flat, box);
  check(f.aspect >= 1.5, 'box is wider than tall', `aspect=${f.aspect.toFixed(2)}`);
  check(f.torsoAngle < 30, 'torso angle alone would NOT trip the gate', `${f.torsoAngle.toFixed(1)}deg`);
  const r = classifyPosture(flat, box, 0.9);
  check(r.className === 'fall', 'classified as FALL via the aspect hatch', `${r.className} — ${r.reason}`);

  // An upright figure must stay well clear of the hatch.
  const tall = upright();
  const ft = postureFeatures(tall, boxAround(tall));
  check(ft.aspect < 1.5, 'an upright figure is nowhere near the aspect gate', `aspect=${ft.aspect.toFixed(2)}`);
}

// What the *viewer* is told, which is a separate question from what the
// classifier concluded. posture.js has to return some class at tier C/D so the
// tracker has something to vote on, and it correctly returns the non-alarming
// one - but showing that to a visitor as a confident `stand` is the system
// claiming knowledge it does not have. Pinned here because the demo's own
// framing (a laptop webcam, waist-up) makes tier C the most likely thing anyone
// will actually see.
console.log('\n=== how an indeterminate read is presented ===');
{
  const noKnees = skeleton({
    leftShoulder: [92, 100], rightShoulder: [108, 100],
    leftHip: [92, 200], rightHip: [108, 200],
  });
  const r = classifyPosture(noKnees, boxAround(noKnees), 0.9);
  check(r.tier === 'C', 'waist-up crop is still tier C', `tier=${r.tier}`);
  check(r.className === 'stand', 'classifier still emits the safe default', r.className);

  const shown = postureReadout(r.tier, r.className, r.confidence);
  check(shown.indeterminate === true, 'presented as indeterminate', shown.text);
  check(!/STAND/.test(shown.text), 'does NOT show a confident STAND', shown.text);
  check(!/%/.test(shown.text), 'no percentage beside a hedge', shown.text);
  check(
    shown.color !== CLASS_COLORS.stand,
    'not painted in the confident stand colour',
    shown.color.fill,
  );

  const noHips = skeleton({ leftShoulder: [92, 100], rightShoulder: [108, 100] });
  const d = classifyPosture(noHips, boxAround(noHips), 0.9);
  check(d.tier === 'D', 'no torso vector is tier D', `tier=${d.tier}`);
  check(postureReadout(d.tier, d.className, d.confidence).indeterminate, 'tier D hedges too');

  // The whole point of the hedge is that it never touches a real answer. A fall
  // needs a torso vector, so it is always tier A and must render normally.
  const lying = skeleton({
    leftShoulder: [100, 200], rightShoulder: [100, 210],
    leftHip: [200, 200], rightHip: [200, 210],
  });
  const fall = classifyPosture(lying, boxAround(lying), 0.9);
  const fallShown = postureReadout(fall.tier, fall.className, fall.confidence);
  check(fall.className === 'fall', 'lying figure is still a fall', `tier=${fall.tier}`);
  check(!fallShown.indeterminate, 'a fall is NEVER hedged', fallShown.text);
  check(/FALL/.test(fallShown.text) && /%/.test(fallShown.text), 'fall keeps its label and %', fallShown.text);

  // A full-body read is unaffected.
  const tall = upright();
  const s = classifyPosture(tall, boxAround(tall), 0.9);
  const sShown = postureReadout(s.tier, s.className, s.confidence);
  check(!sShown.indeterminate, 'a tier-A stand is shown plainly', sShown.text);
}

console.log(failures === 0 ? '\nALL POSTURE CHECKS PASSED' : `\n${failures} POSTURE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
