# Human Anomaly Detection — Frontend

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
