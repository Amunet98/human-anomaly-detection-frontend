import { useCallback, useEffect, useRef, useState } from 'react';
import { Detector } from '../lib/detect/detectorClient';

// Owns the detection worker and the capture loop that feeds it.
//
// The capture loop and the inference loop run on deliberately separate clocks.
// Capture runs at display rate via requestVideoFrameCallback and keeps only the
// newest frame; inference is self-clocked, dispatching whenever the worker goes
// idle. So the pipeline runs as fast as the device allows - anywhere from ~1fps
// on a mid-range phone without WebGPU to 30fps+ on a desktop GPU - without a
// fixed interval to tune and without a queue that grows whenever inference is
// slower than capture, which is the normal case rather than the exception.
export function useBrowserDetector({ videoRef, enabled, threshold, onResult }) {
  const [progress, setProgress] = useState({ phase: null, value: 0 });
  const [ep, setEp] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ fps: 0, latency: 0 });

  // `status` is derived rather than stored. Storing it would mean setting
  // 'loading' synchronously inside the setup effect, which cascades a second
  // render on every enable and makes the React compiler bail out of this hook.
  const status = !enabled ? 'idle' : error ? 'error' : ep ? 'ready' : 'loading';

  const detectorRef = useRef(null);
  const latestRef = useRef(null);
  const pendingRef = useRef(false);
  const recentRef = useRef([]);

  // Held in a ref so a new callback identity from the caller doesn't tear down
  // the worker and re-download the model. Synced in an effect, not during
  // render - mutating a ref while rendering is not safe under concurrent
  // rendering, since a render can be thrown away.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const dispatch = useCallback(() => {
    const detector = detectorRef.current;
    const bitmap = latestRef.current;
    if (!detector || !bitmap || !detector.ready || detector.busy) return;
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    latestRef.current = null;
    detector.submit(bitmap, {
      sourceW: video.videoWidth,
      sourceH: video.videoHeight,
      t: performance.now(),
    });
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) return undefined;

    const detector = new Detector({
      onProgress: (phase, value) => setProgress({ phase, value }),
      onReady: ({ ep: resolved }) => setEp(resolved),
      onResult: (result) => {
        const total = result.timings.pre + result.timings.run + result.timings.post;
        // Rolling window over the last second, so the readout reflects what the
        // device is doing now rather than an average since page load.
        const now = performance.now();
        const recent = recentRef.current;
        recent.push({ now, total });
        while (recent.length && now - recent[0].now > 1000) recent.shift();
        setStats({
          fps: recent.length,
          latency: recent.reduce((sum, r) => sum + r.total, 0) / recent.length,
        });

        onResultRef.current?.(result);
        dispatch();
      },
      onError: (message, phase) => {
        // A failure during init is fatal for this engine; a per-frame failure
        // is not, and the worker has already cleared its busy flag.
        if (phase === 'init' || !detectorRef.current?.ready) setError(message);
      },
    });
    detectorRef.current = detector;
    detector.start(threshold);

    return () => {
      detector.dispose();
      detectorRef.current = null;
      latestRef.current?.close();
      latestRef.current = null;
      recentRef.current = [];
      setEp(null);
      setError(null);
      setProgress({ phase: null, value: 0 });
      setStats({ fps: 0, latency: 0 });
    };
    // `threshold` is intentionally not a dependency - changing it must not tear
    // down the worker and re-download the model. It's pushed across below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dispatch]);

  useEffect(() => {
    detectorRef.current?.setThreshold(threshold);
  }, [threshold]);

  // Capture pump.
  useEffect(() => {
    if (!enabled || status !== 'ready') return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let cancelled = false;
    let rafId = null;
    let frameHandle = null;

    const schedule = () => {
      if (cancelled) return;
      if (video.requestVideoFrameCallback) {
        frameHandle = video.requestVideoFrameCallback(pump);
      } else {
        rafId = requestAnimationFrame(pump);
      }
    };

    const pump = async () => {
      if (cancelled) return;
      if (video.readyState >= 2 && !pendingRef.current) {
        pendingRef.current = true;
        try {
          // Reads the decoded frame, so CSS transforms on the element (the
          // front-camera mirror) don't affect it - detections stay in true
          // source coordinates.
          const bitmap = await createImageBitmap(video);
          if (cancelled) {
            bitmap.close();
          } else {
            // Dropping the previous frame is what keeps memory flat when
            // inference is slower than capture. Without the close() these leak.
            latestRef.current?.close();
            latestRef.current = bitmap;
            dispatch();
          }
        } catch {
          // Happens transiently while a stream is being torn down or a clip
          // seeks - the next frame will be fine.
        } finally {
          pendingRef.current = false;
        }
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (frameHandle !== null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(frameHandle);
      }
      pendingRef.current = false;
    };
  }, [enabled, status, videoRef, dispatch]);

  return { status, progress, ep, error, stats };
}
