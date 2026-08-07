// Runs the detection pipeline off the main thread.
//
// This is not an optimisation, it's a requirement: session.run() on the wasm
// backend is a synchronous call into the WebAssembly module, so a 250ms run on
// the main thread stalls requestAnimationFrame for 250ms - which would destroy
// exactly the smooth overlay this pipeline exists to produce. Preprocessing
// (getImageData plus a 1.2M-iteration CHW conversion) moves here too.
//
// ORT ships env.wasm.proxy which does the first half of this in one line, but
// it is documented as incompatible with the WebGPU execution provider and
// leaves preprocessing on the main thread.

import { ort, createSession, warmUp } from './session.js';
import { loadModelBytes } from './modelCache.js';
import { INPUT_SIZE } from './constants.js';
import { computeLetterbox, drawLetterboxed, imageDataToCHW } from './letterbox.js';
import { decodeYolov8 } from './postprocess.js';

let session = null;
let confThreshold;

// Allocated once and reused for every frame. The canvas is always 640x640
// (the letterbox target) regardless of source size.
const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
const ctx = canvas.getContext('2d', {
  // The video frame is opaque, so skipping the alpha channel avoids
  // premultiplied-alpha round-tripping...
  alpha: false,
  // ...and this forces a CPU-backed backing store, which avoids a GPU->CPU
  // stall on every getImageData. Measurably worth it at this call rate.
  willReadFrequently: true,
});
const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') return await init(msg);
    if (msg.type === 'frame') return await onFrame(msg);
    if (msg.type === 'threshold') {
      confThreshold = msg.value;
      return;
    }
  } catch (error) {
    self.postMessage({ type: 'error', phase: msg.type, message: String(error?.message || error) });
  }
};

async function init({ modelUrl, threshold }) {
  confThreshold = threshold;
  const bytes = await loadModelBytes(modelUrl, (value) =>
    self.postMessage({ type: 'progress', phase: 'model', value }),
  );

  self.postMessage({ type: 'progress', phase: 'session', value: 0 });
  const created = await createSession(bytes);
  session = created.session;

  self.postMessage({ type: 'progress', phase: 'warmup', value: 0 });
  const warmupMs = await warmUp(session);

  self.postMessage({ type: 'ready', ep: created.ep, warmupMs });
}

async function onFrame({ bitmap, sourceW, sourceH, seq, t }) {
  if (!session) {
    bitmap.close();
    return;
  }

  const preStarted = performance.now();
  const lb = computeLetterbox(sourceW, sourceH);
  drawLetterboxed(ctx, bitmap, sourceW, sourceH, lb);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  imageDataToCHW(data, chw);
  const pre = performance.now() - preStarted;

  const runStarted = performance.now();
  const output = (
    await session.run({
      images: new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    })
  ).output0;
  const run = performance.now() - runStarted;

  const postStarted = performance.now();
  const detections = decodeYolov8(output, lb, confThreshold);
  const post = performance.now() - postStarted;

  self.postMessage({
    type: 'result',
    seq,
    t,
    sourceW,
    sourceH,
    detections,
    timings: { pre, run, post },
  });
}
