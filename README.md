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

Static build, deploys well to Vercel: `vercel --prod` (or connect the repo
in the Vercel dashboard). Set `VITE_API_URL` to the deployed backend's URL
as a Vercel environment variable.
