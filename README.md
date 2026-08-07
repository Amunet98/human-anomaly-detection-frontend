# Human Anomaly Detection — Frontend

[![Live Demo](https://img.shields.io/badge/Live%20Demo-bimeshpoudel.com.np-facc15)](https://www.bimeshpoudel.com.np/human-anomaly-live-demo)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio)](https://socket.io)

**Live demo:** https://www.bimeshpoudel.com.np/human-anomaly-live-demo

React + Vite + Mantine dashboard for the human anomaly (fall) detection
system. Shows a live video feed with real-time detection alerts, plus
upload/URL image checks — a rewrite of the original Create React App
frontend on Vite.

Talks to the [backend](https://github.com/Amunet98/human-anomaly-detection-backend)
over a socket (live frames + detection events) and REST (`/category`,
`/item/:id`, `/analyze`). The backend in turn receives camera frames from
[server-opencv](https://github.com/Amunet98/server-opencv).

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

## Deploying

Connected to Vercel via the GitHub integration — pushes to `main` build and
deploy production automatically. `VITE_API_URL` is set to the deployed
backend's URL as a Vercel environment variable.

In production the app is served *through* the portfolio's domain at
`/human-anomaly-live-demo` via
[Vercel Microfrontends](https://vercel.com/docs/microfrontends) — the
portfolio and this demo deploy independently but share one domain.

> **Note:** the backend only streams the shared demo feed while viewers are
> connected, and the feed may be paused at times to stay within free-tier
> hosting limits — the upload/URL image checks work regardless.

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
