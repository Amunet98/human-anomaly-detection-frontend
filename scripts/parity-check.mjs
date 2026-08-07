// Checks that the browser-side detection modules agree with the server's
// inference.js. Run with:  node scripts/parity-check.mjs
//
// Requires the backend repo checked out alongside this one (../human-anomaly-
// detection-backend-main) with its node_modules installed - it borrows the
// backend's onnxruntime-node and sharp, and compares against its actual
// analyzeBuffer() rather than a reimplementation of it.
//
// The modules under src/lib/detect are a port of inference.js:59-152, and the
// two have to keep producing the same numbers or a frame analysed in the
// browser will disagree with the same frame POSTed to /analyze. This harness
// runs the browser modules under Node against the same ONNX session the server
// uses, which isolates the maths from canvas-vs-sharp resampling: any
// difference it reports is a real bug in the port.
//
// Canvas resampling is deliberately NOT covered - it cannot be made to match
// (sharp uses Lanczos3, canvas uses a browser-chosen filter), so sharp produces
// the pixels for both sides here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BACKEND = path.resolve(FRONTEND, '../human-anomaly-detection-backend-main');

if (!fs.existsSync(path.join(BACKEND, 'node_modules'))) {
  console.error(`Backend repo not found (or deps not installed) at:\n  ${BACKEND}\n`);
  console.error('Check it out alongside this repo and run `npm install` there.');
  process.exit(2);
}

const require = createRequire(BACKEND + '/');
const ort = require('onnxruntime-node');
const sharp = require('sharp');
const { analyzeBuffer } = require(path.join(BACKEND, 'inference'));

const { computeLetterbox, imageDataToCHW } = await import(`${FRONTEND}/src/lib/detect/letterbox.js`);
const { decodeYolov8 } = await import(`${FRONTEND}/src/lib/detect/postprocess.js`);
const { INPUT_SIZE } = await import(`${FRONTEND}/src/lib/detect/constants.js`);

const session = await ort.InferenceSession.create(path.join(BACKEND, 'best.onnx'), {
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  graphOptimizationLevel: 'basic',
});

// The server's preprocessing, inlined verbatim from inference.js:59-90 so we
// can get at the intermediate RGB buffer and tensor that analyzeBuffer hides.
async function serverPreprocess(buffer) {
  const meta = await sharp(buffer).metadata();
  const scale = Math.min(INPUT_SIZE / meta.width, INPUT_SIZE / meta.height);
  const newW = Math.round(meta.width * scale);
  const newH = Math.round(meta.height * scale);
  const padLeft = Math.floor((INPUT_SIZE - newW) / 2);
  const padTop = Math.floor((INPUT_SIZE - newH) / 2);
  const { data } = await sharp(buffer)
    .resize(newW, newH)
    .extend({
      top: padTop,
      bottom: INPUT_SIZE - newH - padTop,
      left: padLeft,
      right: INPUT_SIZE - newW - padLeft,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const area = INPUT_SIZE * INPUT_SIZE;
  const tensorData = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    tensorData[i] = data[i * 3] / 255;
    tensorData[area + i] = data[i * 3 + 1] / 255;
    tensorData[2 * area + i] = data[i * 3 + 2] / 255;
  }
  return { tensorData, rgb: data, scale, padLeft, padTop, w: meta.width, h: meta.height };
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const fixtures = fs
  .readdirSync(path.join(FRONTEND, 'public'))
  .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !/favicon|android-chrome|apple-touch|arrow/i.test(f));

if (!fixtures.length) {
  console.error('No image fixtures found in public/');
  process.exit(2);
}

for (const file of fixtures) {
  const buf = fs.readFileSync(path.join(FRONTEND, 'public', file));
  console.log(`\n=== ${file} ===`);

  const srv = await serverPreprocess(buf);

  // 1. Geometry. Exact equality: the rounding in computeLetterbox is a
  //    deliberate copy of the server's and a mismatch shifts every box.
  const lb = computeLetterbox(srv.w, srv.h);
  check(
    lb.scale === srv.scale && lb.padLeft === srv.padLeft && lb.padTop === srv.padTop,
    'computeLetterbox matches server',
    `${srv.w}x${srv.h} -> scale=${lb.scale.toFixed(6)} pad=(${lb.padLeft},${lb.padTop})`,
  );

  // 2. Tensor layout. Build the RGBA that getImageData would return from the
  //    exact pixels sharp produced, so only the HWC->CHW conversion is compared.
  const area = INPUT_SIZE * INPUT_SIZE;
  const rgba = new Uint8ClampedArray(area * 4);
  for (let i = 0; i < area; i++) {
    rgba[i * 4] = srv.rgb[i * 3];
    rgba[i * 4 + 1] = srv.rgb[i * 3 + 1];
    rgba[i * 4 + 2] = srv.rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  const mine = imageDataToCHW(rgba, new Float32Array(3 * area));
  let maxDiff = 0;
  for (let i = 0; i < mine.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(mine[i] - srv.tensorData[i]));
  }
  check(maxDiff === 0, 'imageDataToCHW matches server tensor', `maxDiff=${maxDiff}`);

  // 3. Decode. One session run, both decoders over the identical output tensor.
  const out = (
    await session.run({
      images: new ort.Tensor('float32', srv.tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    })
  ).output0;

  const server = (await analyzeBuffer(buf)).detections;
  const browser = decodeYolov8(out, lb);

  check(
    server.length === browser.length,
    'same detection count',
    `server=${server.length} browser=${browser.length}`,
  );

  for (let i = 0; i < Math.min(server.length, browser.length); i++) {
    const s = server[i];
    const b = browser[i];
    const dConf = Math.abs(s.confidence - b.confidence);
    const dBox = Math.max(
      Math.abs(s.box[0] - b.x1),
      Math.abs(s.box[1] - b.y1),
      Math.abs(s.box[2] - b.x2),
      Math.abs(s.box[3] - b.y2),
    );
    // Tolerances exist only because the server rounds boxes to whole pixels
    // and confidence to 3dp, while we keep floats for the box smoother.
    check(
      s.className === b.className && dBox <= 1 && dConf <= 0.001,
      `detection[${i}] ${s.className}`,
      `dBox=${dBox.toFixed(3)}px dConf=${dConf.toFixed(4)}`,
    );
  }
}

console.log(failures === 0 ? '\nALL PARITY CHECKS PASSED' : `\n${failures} PARITY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
