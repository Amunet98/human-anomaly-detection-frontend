import modelUrl from '../../model/best.onnx?url';
import { DEFAULT_CONF_THRESHOLD } from './constants.js';

export { modelUrl };

// Main-thread handle to the detection worker.
//
// Exposes a strict one-in-flight contract: submit() is a no-op unless the
// worker is idle. That's what lets the caller run its capture loop at display
// rate and simply drop frames the worker isn't ready for, instead of building a
// queue that grows without bound whenever inference is slower than capture
// (which is the normal case, not the exception).
export class Detector {
  constructor({ onReady, onResult, onProgress, onError } = {}) {
    this.ready = false;
    this.busy = false;
    this.ep = null;
    this.seq = 0;
    this.onReady = onReady;
    this.onResult = onResult;
    this.onProgress = onProgress;
    this.onError = onError;

    this.worker = new Worker(new URL('./detector.worker.js', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event) => this.#handle(event.data);
    this.worker.onerror = (event) => {
      this.busy = false;
      this.onError?.(event.message || 'Detector worker failed to start');
    };
  }

  start(threshold = DEFAULT_CONF_THRESHOLD) {
    this.worker.postMessage({ type: 'init', modelUrl, threshold });
  }

  setThreshold(value) {
    this.worker.postMessage({ type: 'threshold', value });
  }

  // `bitmap` is transferred, not copied - it is neutered in this thread
  // afterwards, so the caller must not hold on to it.
  submit(bitmap, { sourceW, sourceH, t }) {
    if (!this.ready || this.busy) return false;
    this.busy = true;
    this.worker.postMessage(
      { type: 'frame', bitmap, sourceW, sourceH, seq: ++this.seq, t },
      [bitmap],
    );
    return true;
  }

  dispose() {
    this.worker.terminate();
    this.ready = false;
    this.busy = false;
  }

  #handle(msg) {
    switch (msg.type) {
      case 'progress':
        this.onProgress?.(msg.phase, msg.value);
        break;
      case 'ready':
        this.ready = true;
        this.ep = msg.ep;
        this.onReady?.({ ep: msg.ep, warmupMs: msg.warmupMs });
        break;
      case 'result':
        this.busy = false;
        this.onResult?.(msg);
        break;
      case 'error':
        // A per-frame failure shouldn't wedge the pipeline; clearing busy lets
        // the next frame through. An init failure leaves ready false, so
        // submit() stays a no-op regardless.
        this.busy = false;
        this.onError?.(msg.message, msg.phase);
        break;
    }
  }
}
