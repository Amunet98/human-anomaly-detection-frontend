import { CLASS_NAMES, DEFAULT_CONF_THRESHOLD, IOU_THRESHOLD } from './constants.js';

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

// Greedy, class-aware NMS - a box is suppressed only by a higher-scoring box of
// the *same* class. Structured identically to the server's inference.js:105-113
// rather than the more usual per-class-partition form, so the two stay
// diff-able even though they'd produce the same result.
export function nms(boxes) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of sorted) {
    if (kept.some((k) => k.classId === box.classId && iou(k, box) > IOU_THRESHOLD)) continue;
    kept.push(box);
  }
  return kept;
}

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
  return nms(boxes).map((b) => ({
    classId: b.classId,
    className: CLASS_NAMES[b.classId] ?? `class_${b.classId}`,
    confidence: b.score,
    x1: b.x1,
    y1: b.y1,
    x2: b.x2,
    y2: b.y2,
  }));
}
