# Human Anomaly Detection — Frontend

[![Live Demo](https://img.shields.io/badge/Live%20Demo-bimeshpoudel.com.np-facc15)](https://www.bimeshpoudel.com.np/human-anomaly-live-demo)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio)](https://socket.io)

**Live demo:** https://www.bimeshpoudel.com.np/human-anomaly-live-demo

React + Vite live console for the human anomaly (fall) detection system:
point your camera at someone and it labels their posture — `fall`, `sit`,
`squat`, `stand` — with tracked boxes and a skeleton overlay, plus
upload/URL image checks.

**Detection can run entirely in your browser.** The live view has two
engines, switchable in the UI:

| engine | where inference happens | cost |
|---|---|---|
| **server** (default) | a frame every 500 ms is POSTed over the socket to the [backend](https://github.com/Amunet98/human-anomaly-detection-backend) | no download; bounded by the network and the backend's cold start |
| **browser** | `onnxruntime-web` in a Web Worker, WebGPU where available | one ~15 MB model download, cached; then real-time and fully offline |

Both engines feed the same tracker, so the two paths agree on what they
report. Upload and URL checks always go to the backend's `/analyze`.

## How detection works

`best.onnx` is **COCO-pretrained yolov8n-pose, unmodified** — it detects one
class (`person`) plus 17 keypoints. Nothing in the shipped pipeline was
trained. The four postures are derived from keypoint geometry, which is why the
model file and the label set are independent of each other.

The version before this one was trained — yolov8n fine-tuned on 8,340 Roboflow
images to predict the postures directly — and was replaced because measurement
said so: 76.7% under perturbation, with a `sit` class that never missed and was
wrong nearly half the time it fired, because it had learned the room rather
than the body. Keypoint geometry has no equivalent shortcut available: a
shoulder-to-hip angle is the same blurred, greyscaled or downscaled. The
backend repo's [`training/MODEL_CARD.md`](../human-anomaly-detection-backend-main/training/MODEL_CARD.md)
has the side-by-side.

The pipeline lives in [`src/lib/detect/`](src/lib/detect/):

| file | job |
|---|---|
| `detectorClient.js` / `detector.worker.js` | worker handle with a strict one-in-flight contract — the capture loop drops frames the worker isn't ready for instead of building an unbounded queue |
| `modelCache.js` | Cache Storage for the model, kept free of any onnxruntime import so visitors who never enable browser detection don't pay for ORT |
| `session.js` | ORT session setup (JSEP build; `numThreads = 1`, since SharedArrayBuffer needs cross-origin isolation this page can't set) |
| `letterbox.js` / `postprocess.js` | ultralytics-compatible preprocessing, then decode + class-aware NMS + a relative min-box floor |
| `posture.js` | the geometric classifier — fall / kneel / squat / sit gates, with occlusion tiers A–D discounting confidence |
| `tracker.js` | associates detections into tracks and votes each track's class over a 7-result window; a fall must *sustain* to count |
| `smoothing.js` / `viewport.js` | overlay easing, and mapping boxes through object-fit crop, mirroring and devicePixelRatio |

`tracker.js` is not cosmetic. A single frame genuinely cannot distinguish
someone who has fallen from someone crouching or lying on a sofa, so without
temporal state the label strobes and fires on anyone who bends over. The raw
per-frame class is still surfaced alongside the voted one, so the UI stays
honest about what the model said versus what the system concluded.

Thresholds, decision order and the measured failure modes are documented in
the backend repo's
[`training/MODEL_CARD.md`](https://github.com/Amunet98/human-anomaly-detection-backend/blob/main/training/MODEL_CARD.md).

## Setup

```bash
npm install
npm run dev
```

### Environment variables (`.env.local`)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | backend base URL (defaults to `http://localhost:8081`) |

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run check` — the standard pre-commit suite: `tracker` + `viewport` + `posture`
- `npm run parity` — asserts the browser and server `posture.js` agree
- `npm run eval` / `npm run eval:robust` — accuracy against the labelled fixtures
- `npm run fixture -- <image> --expect <class>` — vet a candidate fixture before
  adopting it: runs the real pipeline plus the harness's own six perturbations,
  reports tier and per-person reads, suggests the `expectedAll` line for a
  multi-subject frame, and refuses to stage anything that does not hold. Add
  `--write` to copy it into `eval-fixtures/` and append to `labels.json`

`check` is the one to run routinely. `parity` and `eval` need the sibling
backend repo checked out next to this one, which is why they're excluded
from it.

## Accuracy

From `npm run eval:robust`, measured 2026-08-12 against the 19 labelled
fixtures in `scripts/eval-fixtures/`:

| | clean | perturbed |
|---|---|---|
| accuracy | **16/19 (84.2%)** | **98/114 (86.0%)** |
| macro-F1 | 0.838 | 0.859 |

"Perturbed" replays every fixture through hflip, grayscale, darken-40%,
blur-3px, downscale-320w and centre-crop-80%. Per-class under perturbation:
`fall` P=1.000 R=0.750, `sit` P=1.000 R=1.000, `stand` P=0.750 R=1.000,
`squat` P=0.769 R=0.833.

**macro-F1 now covers all four classes.** The previous 0.905 spanned only
three — `squat` had no fixture and was excluded — so the two figures are not
comparable. Adding a fourth, harder class lowers the average while making it
mean more.

Three fixtures are labelled KNOWN GAP and are expected to fail: two falls that
2D geometry cannot express, and one squat sitting 0.05 the wrong side of a
threshold whose alternative costs fall recall.

**Do not read 86.0% as a deployment accuracy.** The fixtures were chosen
*because* they were failure candidates — three are labelled KNOWN GAP and are
expected to fail — so the set is adversarial by construction, not
representative. Its job is to fail when the classifier regresses, and an
earlier 8-image set was retired precisely because it could no longer do that.

Alongside the accuracy numbers the harness runs two **pass/fail** checks that
top-1 scoring is blind to: `expectedAll` (every person in the frame, not just
the top one) and `consistentWith` (near-identical photo pairs must agree).

## Deploying

Connected to Vercel via the GitHub integration — pushes to `main` build and
deploy production automatically. `VITE_API_URL` is set to the deployed
backend's URL as a Vercel environment variable.

In production the app is served *through* the portfolio's domain at
`/human-anomaly-live-demo` via
[Vercel Microfrontends](https://vercel.com/docs/microfrontends) — the
portfolio and this demo deploy independently but share one domain.

> **Note:** the live view uses **your own camera**, not a shared feed. The
> [server-opencv](https://github.com/Amunet98/server-opencv) demo feed is
> disabled — it OOM-crashed on Render's free tier. The **server** engine and
> the upload/URL checks are the paths that need the backend awake; on the free
> tier the first request of the day waits ~50s for a cold start, which is
> deliberate (see the backend README). Switching the live view to the
> **browser** engine sidesteps the backend entirely — the model is served from
> this app's own assets.

## Deployment headers

`vercel.json` is not self-explanatory and JSON has no comments, so the reasoning
lives here.

**`Cache-Control: immutable` on `/vc-ap-373432/*`.** That path is the asset
prefix `@vercel/microfrontends` assigns this project, and everything Vite emits
into it is content-hashed — JS, CSS, the onnxruntime `.wasm`, and `best.onnx`.
A rebuild or a retrain changes the hash and therefore the URL, so nothing can go
stale. Without this, Vercel serves `max-age=0, must-revalidate` and every page
load pays a revalidation round-trip, which matters most for the ~12 MB model.

Note this is also why assets must be *imported* (`import url from './x?url'`)
rather than dropped in `public/`. Files at the public root are unreachable when
this app is proxied under the portfolio domain — only `/human-anomaly-live-demo`
and `/vc-ap-373432/*` route here.

**Security headers duplicated from the portfolio.** Under Vercel Microfrontends
the child project answers its own requests, so the portfolio's headers never
applied to `bimeshpoudel.com.np/human-anomaly-live-demo` — verified with `curl`:
the demo page came back with no HSTS and no `X-Frame-Options` while the parent's
own pages had both. They have to be declared on this side.

**No Content-Security-Policy yet.** It will need `'wasm-unsafe-eval'`, because
onnxruntime-web compiles its WebAssembly at runtime and a CSP without it blocks
instantiation outright. It is not set until it has been exercised in a real
browser: a wrong CSP takes the demo down silently.

**Do not use `"//"` keys as comments in `vercel.json`.** Vercel validates the
file against a strict schema and rejects unknown properties, and the deployment
fails *before* the build with no build logs to explain it.
