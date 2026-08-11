import {
  CLASS_NAMES,
  DEFAULT_CONF_THRESHOLD,
  IOU_THRESHOLD,
  KEYPOINT_NAMES,
  KP_CONF_THRESHOLD,
  MIN_BOX_AREA_RATIO,
} from './constants.js';
import { classifyPosture } from './posture.js';

export function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

// Greedy, class-AGNOSTIC NMS - a box is suppressed by any higher-scoring box it
// overlaps, regardless of class. Structured identically to the server's nms() in
// inference.js so the two stay diff-able.
//
// Class-agnostic is not a tuning choice here, it's forced by the label set:
// fall/sit/stand are mutually exclusive *postures of one person*, not different
// objects that can legitimately coexist in the same place. Under the previous
// class-aware rule the runner-up posture survived on the same box, so a standing
// subject rendered as both `stand 0.72` and `sit 0.44` at IoU ~0.99 - two labels
// stacked on one person, which is always wrong. Restore the classId guard only
// if the model is ever retrained on classes that can genuinely overlap.
export function nms(boxes) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of sorted) {
    if (kept.some((k) => iou(k, box) > IOU_THRESHOLD)) continue;
    kept.push(box);
  }
  return kept;
}

// Drops boxes that are tiny relative to the largest surviving box in the same
// frame. Runs after NMS, on the survivors, so a cluster of overlapping fragments
// has already collapsed to one before anything is measured.
//
// This is the fix for sub-limb false positives: the model emits a `stand 0.43`
// box on a subject's boot, which NMS cannot touch (it barely overlaps the person
// box - only ~32% of the boot box is inside it, so containment suppression
// wouldn't catch it either) but which is 3.1% of the person box's area.
//
// The largest box is compared against itself and so is always kept - a lone
// distant person is never self-filtered.
export function filterTinyBoxes(boxes) {
  if (boxes.length < 2) return boxes;
  const area = (b) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const maxArea = Math.max(...boxes.map(area));
  if (maxArea <= 0) return boxes;
  return boxes.filter((b) => area(b) >= MIN_BOX_AREA_RATIO * maxArea);
}

// The superseded 3-class detector's own head order, frozen. It is deliberately
// NOT CLASS_NAMES: that list is the live posture vocabulary and gained `squat`
// at index 2, which is where the old weights emit `stand`. Indexing the old
// model's output into the new list would silently relabel every stand as a
// squat - and because this decoder is only exercised by eval-check.mjs scoring
// the archived weights, nothing in the app would have surfaced it.
const LEGACY_CLASS_NAMES = ['fall', 'sit', 'stand'];

// Decodes YOLOv8's raw export output and maps boxes back to source-image pixels.
// Port of inference.js:118-152.
//
// Layout is [1, 4 + numClasses, numAnchors], channel-major: every cx, then
// every cy, then w, h, then one plane per class. There is no objectness channel
// (v8 dropped it) and the class scores already have sigmoid applied by the
// export, so the max class score is the confidence directly - no activation to
// apply here.
//
// numClasses and numAnchors come from the tensor's own dims so this doesn't
// silently truncate if the model is retrained with a different class count.
export function decodeYolov8(output, lb, confThreshold = DEFAULT_CONF_THRESHOLD) {
  const data = output.data;
  const [, channels, numAnchors] = output.dims;
  const numClasses = channels - 4;
  const { scale, padLeft, padTop } = lb;

  const boxes = [];
  for (let a = 0; a < numAnchors; a++) {
    let bestScore = -Infinity;
    let bestClass = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numAnchors + a];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < confThreshold) continue;

    const cx = data[0 * numAnchors + a];
    const cy = data[1 * numAnchors + a];
    const w = data[2 * numAnchors + a];
    const h = data[3 * numAnchors + a];

    boxes.push({
      x1: (cx - w / 2 - padLeft) / scale,
      y1: (cy - h / 2 - padTop) / scale,
      x2: (cx + w / 2 - padLeft) / scale,
      y2: (cy + h / 2 - padTop) / scale,
      score: bestScore,
      classId: bestClass,
    });
  }

  // Unlike the server we keep float coordinates rather than rounding: the box
  // smoother interpolates between results and wants the sub-pixel detail.
  return filterTinyBoxes(nms(boxes)).map((b) => ({
    classId: b.classId,
    className: LEGACY_CLASS_NAMES[b.classId] ?? `class_${b.classId}`,
    confidence: b.score,
    x1: b.x1,
    y1: b.y1,
    x2: b.x2,
    y2: b.y2,
  }));
}

// Decodes the pose model's raw export output and derives a posture per person.
// Port of inference.js's decodePose().
//
// Layout is [1, 5 + numKeypoints*3, numAnchors], channel-major, same as the
// detector's but with a different channel budget: cx, cy, w, h, then ONE person
// confidence (the model has a single class), then x, y, confidence per keypoint.
// numKeypoints comes from the tensor's own dims so a 17-point COCO model and any
// other pose head decode through the same path.
//
// Keypoints arrive in the same 640-canvas coordinates as the box, so they undo
// the letterbox with exactly the same scale/pad arithmetic - no separate mapping
// and nothing new in letterbox.js.
export function decodePose(output, lb, confThreshold = DEFAULT_CONF_THRESHOLD) {
  const data = output.data;
  const [, channels, numAnchors] = output.dims;
  const numKeypoints = (channels - 5) / 3;
  const { scale, padLeft, padTop } = lb;

  const boxes = [];
  for (let a = 0; a < numAnchors; a++) {
    const personConf = data[4 * numAnchors + a];
    if (personConf < confThreshold) continue;

    const cx = data[0 * numAnchors + a];
    const cy = data[1 * numAnchors + a];
    const w = data[2 * numAnchors + a];
    const h = data[3 * numAnchors + a];

    const keypoints = [];
    for (let k = 0; k < numKeypoints; k++) {
      const base = (5 + k * 3) * numAnchors + a;
      const confidence = data[base + 2 * numAnchors];
      keypoints.push({
        name: KEYPOINT_NAMES[k] ?? `kp_${k}`,
        x: (data[base] - padLeft) / scale,
        y: (data[base + numAnchors] - padTop) / scale,
        confidence,
        visible: confidence >= KP_CONF_THRESHOLD,
      });
    }

    boxes.push({
      x1: (cx - w / 2 - padLeft) / scale,
      y1: (cy - h / 2 - padTop) / scale,
      x2: (cx + w / 2 - padLeft) / scale,
      y2: (cy + h / 2 - padTop) / scale,
      score: personConf,
      // Single-class model, so every box is class 0 and NMS is inherently
      // class-agnostic - the distinction that mattered for the old 3-class head
      // no longer exists here.
      classId: 0,
      keypoints,
    });
  }

  return filterTinyBoxes(nms(boxes)).map((b) => {
    const posture = classifyPosture(b.keypoints, b, b.score);
    return {
      classId: CLASS_NAMES.indexOf(posture.className),
      className: posture.className,
      confidence: posture.confidence,
      // Kept for the overlay and for debugging why a posture was chosen; the
      // tracker ignores them.
      keypoints: b.keypoints,
      personConfidence: b.score,
      tier: posture.tier,
      reason: posture.reason,
      x1: b.x1,
      y1: b.y1,
      x2: b.x2,
      y2: b.y2,
    };
  });
}
