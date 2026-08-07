import * as ort from 'onnxruntime-web';
import { INPUT_SIZE } from './constants.js';

// The default onnxruntime-web entry point is the JSEP build: WebGPU, WebNN and
// the WASM CPU backend in a single artifact. Deliberately not
// 'onnxruntime-web/webgpu', which in 1.27 is the Asyncify build - its CPU
// fallback carries stack-unwinding instrumentation, and the CPU path is what
// every Safari and Firefox visitor gets, so it is the one that has to be fast.
//
// Note there is no ort.env.wasm.wasmPaths here on purpose. ORT resolves its
// .wasm through `new URL(..., import.meta.url)`, which Vite rewrites into a
// content-hashed asset under build.assetsDir - which @vercel/microfrontends has
// already pointed at the routed /vc-ap-373432 prefix. Setting wasmPaths would
// override that and break the proxied deployment.

ort.env.logLevel = 'error';

// Explicit rather than incidental: wasm threads need SharedArrayBuffer, which
// needs cross-origin isolation (COOP/COEP), which this page cannot set - it is
// proxied through the portfolio domain. ORT would force this to 1 anyway and
// warn twice while doing it.
ort.env.wasm.numThreads = 1;

// env.wasm.simd is left at its default `true`. It is a capability *check* that
// throws a clear error on a browser without SIMD, not a switch - setting it
// false doesn't disable SIMD (no non-SIMD binary has shipped since 1.19), it
// just turns a good error message into a cryptic instantiation failure.

ort.env.webgpu.powerPreference = 'high-performance';

// WebGPU needs only a secure context - the cross-origin-isolation requirement
// applies to SharedArrayBuffer, not to WebGPU. So this works on the proxied
// domain even though wasm threads don't.
//
// The probe is separate from the executionProviders list because ORT doesn't
// expose which provider a session actually resolved to, and the HUD wants to
// show it.
export async function pickExecutionProviders() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) return { providers: ['webgpu', 'wasm'], ep: 'webgpu' };
    } catch {
      // Adapter request can reject on blocklisted drivers - fall through to CPU.
    }
  }
  return { providers: ['wasm'], ep: 'wasm' };
}

export async function createSession(modelBytes) {
  const { providers, ep } = await pickExecutionProviders();
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
    // The opposite of the server's settings, and deliberately so: the backend
    // trades speed for footprint because it runs on a 512MB host. A browser tab
    // has memory to spare and wants the arena/pattern allocators.
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: 'sequential',
  });
  return { session, ep };
}

// First run() on WebGPU compiles shaders and can take seconds. Burn that cost
// behind the loading overlay rather than on the user's first live frame.
export async function warmUp(session) {
  const started = performance.now();
  const zeros = new ort.Tensor('float32', new Float32Array(3 * INPUT_SIZE * INPUT_SIZE), [1, 3, INPUT_SIZE, INPUT_SIZE]);
  await session.run({ images: zeros });
  return performance.now() - started;
}

export { ort };
