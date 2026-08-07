import { MODEL_BYTES } from './constants.js';

// Model fetching and caching, deliberately kept free of any onnxruntime import.
//
// The UI needs isModelCached() to decide whether to offer "start" or "download
// 15MB", and that must not drag ORT's ~400KB of JS into the main bundle for
// every visitor - including the ones who never turn browser detection on. Only
// the worker imports session.js, so only the worker pays for ORT.

const CACHE_NAME = 'han-model-v1';

async function openCache() {
  // `caches` is undefined on insecure origins and throws in some private modes.
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function isModelCached(url) {
  const cache = await openCache();
  if (!cache) return false;
  return Boolean(await cache.match(url).catch(() => null));
}

// Streams the model with progress, caching it so a second visit doesn't
// re-download it. best.onnx is ~12MB and barely compresses (fp32 weights are
// high-entropy, so brotli only takes it to ~10MB) - this is not an
// optimisation, it's the difference between the demo being usable twice.
export async function loadModelBytes(url, onProgress = () => {}) {
  const cache = await openCache();
  const cached = cache && (await cache.match(url).catch(() => null));
  if (cached) {
    onProgress(1);
    return new Uint8Array(await cached.arrayBuffer());
  }

  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Model request failed (HTTP ${res.status})`);
  // vercel.json rewrites everything unmatched to /index.html, so a wrong model
  // path returns 200 text/html rather than 404, and ORT then dies deep inside
  // WebAssembly with "expected magic word 00 61 73 6d, found 3c 21 44 4f".
  // Catch it here, where the message can say something useful.
  if ((res.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Model URL fell through to the SPA rewrite - got HTML, not ONNX');
  }

  // Vercel serves this brotli-compressed and omits Content-Length when it does,
  // while the reader yields *decompressed* bytes - so dividing by the header
  // would sail past 100%. Only trust it on an unencoded response.
  const declared = Number(res.headers.get('content-length')) || 0;
  const total = declared && !res.headers.get('content-encoding') ? declared : MODEL_BYTES;

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(received / total, 0.999));
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(1);

  if (bytes[0] === 0x3c) throw new Error('Model URL returned HTML, not ONNX');

  // Best-effort: quota limits and private browsing make this fail, and that's
  // fine - it only costs a re-download.
  cache
    ?.put(url, new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } }))
    .catch(() => {});

  return bytes;
}
