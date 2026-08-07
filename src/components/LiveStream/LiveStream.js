import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetectionOverlay } from '../DetectionOverlay/DetectionOverlay';
import { EventLog } from '../EventLog/EventLog';
import { Tracker } from '../../lib/detect/tracker';
import { BoxSmoother } from '../../lib/detect/smoothing';
import { DEFAULT_CONF_THRESHOLD } from '../../lib/detect/constants';
import { isModelCached } from '../../lib/detect/modelCache';
import { modelUrl } from '../../lib/detect/detectorClient';
import { useBrowserDetector } from '../../hooks/useBrowserDetector';

// Server engine only: how often a captured frame is POSTed over the socket.
// Matches the backend's own INFERENCE_INTERVAL_MS - there is no point sending
// faster than it will sample.
const CAPTURE_INTERVAL_MS = 500;

// A bundled clip would let the demo show tracking without a webcam, replacing
// the shared server-opencv feed that was disabled after it OOM-crashed on
// Render's free tier. To enable: drop an ~15s 480p h264 clip at
// src/model/sample.mp4 and import it here with ?url. It must be imported (not
// dropped in public/) so Vite emits it under the routed asset prefix - files at
// the public root are unreachable when this app is proxied under the portfolio
// domain. The selector below hides the option while this is null.
const SAMPLE_CLIP_URL = null;

// The backend returns boxes as [x1, y1, x2, y2]; the tracker works in objects.
function normalizeServerDetections(detections = []) {
  return detections.map((d) => ({
    classId: d.classId ?? 0,
    className: d.className,
    confidence: d.confidence,
    x1: d.box[0],
    y1: d.box[1],
    x2: d.box[2],
    y2: d.box[3],
    // Carried through to the overlay's skeleton. The server marks occluded
    // joints with null coordinates rather than omitting them, so the array stays
    // index-aligned with KEYPOINT_EDGES either way.
    keypoints: d.keypoints ?? null,
  }));
}

const LiveStream = ({ socket }) => {
  const hostRef = useRef(null);
  const videoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);

  const [source, setSource] = useState('camera'); // camera | clip
  const [engine, setEngine] = useState('server'); // server | browser
  const [threshold, setThreshold] = useState(DEFAULT_CONF_THRESHOLD);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [modelCached, setModelCached] = useState(false);
  const [events, setEvents] = useState([]);
  const [serverStats, setServerStats] = useState({ fps: 0, latency: 0 });
  const [summary, setSummary] = useState({ state: null, confirmed: false, count: 0 });

  const tracker = useMemo(() => new Tracker(), []);
  const smoother = useMemo(() => new BoxSmoother(), []);
  // Which track ids are currently a confirmed fall, so the event log records
  // each episode once rather than on every frame it stays confirmed.
  const confirmedRef = useRef(new Set());

  const usingOwnCamera = source === 'camera';
  // The preview is mirrored for the front camera like every native camera app,
  // so the overlay has to be mirrored to match. Both are derived from this one
  // value so they cannot drift apart.
  const mirror = usingOwnCamera && facingMode === 'user';

  useEffect(() => {
    isModelCached(modelUrl).then(setModelCached).catch(() => {});
  }, []);

  // Feeds one detector result (from either engine) through the tracker and
  // records any newly confirmed fall.
  const handleDetections = useCallback(
    (detections) => {
      const now = performance.now();
      // Applied here as well as in the worker so the slider does something in
      // server mode too: the backend thresholds at its own DETECTION_CONFIDENCE
      // (0.4) and can't be told otherwise per-request, so the slider can only
      // tighten from there - which is why its floor moves with the engine.
      const kept = detections.filter((d) => d.confidence >= threshold);
      const tracks = tracker.update(kept, now);

      const stillConfirmed = new Set();
      const fresh = [];
      for (const track of tracks) {
        if (!track.fallConfirmed) continue;
        stillConfirmed.add(track.id);
        if (!confirmedRef.current.has(track.id)) {
          fresh.push({
            id: `${track.id}-${Date.now()}`,
            trackId: track.id,
            at: Date.now(),
            confidence: track.confidence,
          });
        }
      }
      confirmedRef.current = stillConfirmed;
      if (fresh.length) setEvents((prev) => [...fresh, ...prev].slice(0, 50));

      const top = tracks.reduce(
        (best, t) => (!best || t.confidence > best.confidence ? t : best),
        null,
      );
      setSummary({
        state: top?.state ?? null,
        confirmed: stillConfirmed.size > 0,
        count: tracks.length,
      });
    },
    [tracker, threshold],
  );

  // Sampled by the overlay's render loop at display rate, not by React - the
  // smoother needs to be asked continuously to ease boxes between inference
  // results, and re-rendering the tree at 60fps to push boxes down would be
  // wasteful.
  const getTracks = useCallback(
    () => smoother.sample(tracker.live(performance.now()), performance.now()),
    [tracker, smoother],
  );

  const browser = useBrowserDetector({
    videoRef,
    enabled: engine === 'browser',
    threshold,
    onResult: useCallback((result) => handleDetections(result.detections), [handleDetections]),
  });

  // Switching source or engine invalidates every track - ids, vote history and
  // smoothed positions all describe the old feed.
  //
  // Done in the handlers rather than an effect on [source, engine]: clearing
  // React state synchronously inside an effect cascades an extra render and
  // makes the React compiler bail out of this component.
  const resetTracking = useCallback(() => {
    tracker.reset();
    smoother.reset();
    confirmedRef.current = new Set();
    setSummary({ state: null, confirmed: false, count: 0 });
  }, [tracker, smoother]);

  const changeSource = useCallback(
    (next) => {
      resetTracking();
      setSource(next);
    },
    [resetTracking],
  );

  const changeEngine = useCallback(
    (next) => {
      resetTracking();
      // The server can't be asked for anything below its own 0.4 floor, so a
      // lower slider value would silently stop meaning anything on switching.
      if (next === 'server') {
        setThreshold((current) => Math.max(current, DEFAULT_CONF_THRESHOLD));
      }
      setEngine(next);
    },
    [resetTracking],
  );

  // Camera acquisition. Re-runs on flip: phones can't open both lenses at once,
  // so the old stream is stopped before requesting the other.
  useEffect(() => {
    if (!usingOwnCamera) return undefined;
    let cancelled = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Deliberately not clearing cameraReady here: the two setters below run in
    // async callbacks, so they don't cascade a render out of this effect, and
    // holding the previous value while a camera flip resolves keeps the last
    // frame on screen instead of blinking the panel to "idle".
    navigator.mediaDevices
      ?.getUserMedia?.({ video: { facingMode: { ideal: facingMode } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraReady(true);
        setCameraError(null);
        // Device labels only populate after permission is granted, so probe
        // for a second camera here rather than on mount.
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!cancelled) {
              setHasMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);
            }
          })
          .catch(() => {});
      })
      .catch((err) => {
        if (cancelled) return;
        setCameraReady(false);
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission denied.'
            : 'No camera available on this device.',
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [usingOwnCamera, facingMode]);

  // Server engine: capture a frame every CAPTURE_INTERVAL_MS and send it up.
  // Kept as an option because it needs no download at all, and because on a
  // mid-range phone without WebGPU it is genuinely the better experience.
  useEffect(() => {
    if (engine !== 'server' || !socket) return undefined;
    const canvas = captureCanvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      socket.emit('camera-frame', canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    }, CAPTURE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [engine, socket]);

  // Server engine results. 'own-detection' carries every box; 'own-detected' is
  // the legacy label-only event, still handled so an older backend degrades to
  // a working badge instead of an empty overlay.
  useEffect(() => {
    if (engine !== 'server' || !socket) return undefined;
    const recent = [];
    // A current backend emits both events for the same frame, legacy last.
    // Without this the label-only handler would overwrite the real summary a
    // moment after it was computed - clearing `confirmed` on every result and
    // making a confirmed fall flicker. Once the rich event has been seen even
    // once, the legacy one is redundant by definition.
    let hasRichEvents = false;

    const onDetection = (payload) => {
      hasRichEvents = true;
      const now = performance.now();
      recent.push(now);
      while (recent.length && now - recent[0] > 1000) recent.shift();
      setServerStats({ fps: recent.length, latency: 0 });
      handleDetections(normalizeServerDetections(payload?.detections));
    };
    const onLegacy = (label) => {
      if (hasRichEvents || typeof label !== 'string') return;
      setSummary({ state: label, confirmed: false, count: 1 });
    };

    socket.on('own-detection', onDetection);
    socket.on('own-detected', onLegacy);
    return () => {
      socket.off('own-detection', onDetection);
      socket.off('own-detected', onLegacy);
      setServerStats({ fps: 0, latency: 0 });
    };
  }, [engine, socket, handleDetections]);

  const detecting = engine === 'browser' ? browser.status === 'ready' : cameraReady;
  const stats = engine === 'browser' ? browser.stats : serverStats;
  const engineLabel = engine === 'browser' ? browser.ep || 'browser' : 'server';

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* ---- viewport ---- */}
        <div className="flex-1 min-w-0">
          <div
            ref={hostRef}
            className={`relative w-full rounded-2xl overflow-hidden bg-black/30 ${
              summary.confirmed ? 'console-alert' : ''
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              loop={source === 'clip'}
              src={source === 'clip' ? SAMPLE_CLIP_URL ?? undefined : undefined}
              className={`w-full block aspect-[4/3] object-cover ${mirror ? 'scale-x-[-1]' : ''}`}
            />

            <DetectionOverlay
              hostRef={hostRef}
              sourceRef={videoRef}
              getTracks={getTracks}
              mirror={mirror}
              fit="cover"
            />

            {/* HUD */}
            <div className="absolute top-0 inset-x-0 flex items-start justify-between p-3 pointer-events-none font-mono text-[11px] tracking-wider">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-black/55 text-white backdrop-blur-sm">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    detecting ? 'bg-red-500 console-pulse' : 'bg-white/40'
                  }`}
                />
                {detecting ? 'LIVE' : 'IDLE'}
              </span>
              <span className="px-2 py-1 rounded bg-black/55 text-white/85 backdrop-blur-sm">
                {stats.fps.toFixed(0)} FPS
                {stats.latency ? ` · ${stats.latency.toFixed(0)}ms` : ''} · {engineLabel}
              </span>
            </div>

            {hasMultipleCameras && usingOwnCamera && (
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                className="absolute bottom-3 right-3 p-2 rounded-full bg-black/55 text-white text-lg leading-none backdrop-blur-sm"
                aria-label="Switch camera"
                title="Switch camera"
              >
                🔄
              </button>
            )}

            {summary.confirmed && (
              <div className="absolute bottom-3 left-3 px-3 py-1.5 pebble-badge bg-red-600 text-white font-mono text-xs font-bold tracking-wider">
                FALL CONFIRMED
              </div>
            )}

            {/* Blocking states, in priority order. */}
            {engine === 'browser' && browser.status === 'loading' && (
              <LoadingOverlay progress={browser.progress} />
            )}
            {engine === 'browser' && browser.status === 'error' && (
              <BlockingMessage>
                Detector failed to start: {browser.error}
                <br />
                <button className="underline mt-2" onClick={() => changeEngine('server')}>
                  Switch back to server detection
                </button>
              </BlockingMessage>
            )}
            {usingOwnCamera && cameraError && (
              <BlockingMessage>{cameraError}</BlockingMessage>
            )}
            {source === 'clip' && !SAMPLE_CLIP_URL && (
              <BlockingMessage>No sample clip is bundled yet.</BlockingMessage>
            )}
          </div>

          {/*
            Offscreen scratch canvas for the server engine's frame capture -
            never meant to be seen.

            The inline style is load-bearing: Tailwind's `hidden` utility does
            NOT work here. Mantine's NormalizeCSS injects `canvas { display:
            inline-block }` through emotion at runtime, and runtime-injected
            styles are *unlayered*, while Tailwind v4 puts its utilities in
            `@layer utilities`. Unlayered rules beat layered ones outright,
            whatever their specificity - so `.hidden` loses and the capture
            canvas renders at its full videoWidth x videoHeight, looking like a
            second video feed under the real one.
          */}
          <canvas ref={captureCanvasRef} style={{ display: 'none' }} />

          {/* ---- controls ---- */}
          <div className="mt-4 flex flex-col gap-3">
            {SAMPLE_CLIP_URL && (
              <ControlRow label="Source">
                <Segmented
                  value={source}
                  onChange={changeSource}
                  options={[
                    { value: 'camera', label: 'Your camera' },
                    { value: 'clip', label: 'Sample clip' },
                  ]}
                />
              </ControlRow>
            )}

            <ControlRow label="Engine">
              <Segmented
                value={engine}
                onChange={changeEngine}
                options={[
                  { value: 'server', label: 'Server · ~2 fps' },
                  {
                    value: 'browser',
                    label: modelCached ? 'Browser · real-time' : 'Browser · ~15MB',
                  },
                ]}
              />
            </ControlRow>

            <ControlRow label={`Confidence · ${threshold.toFixed(2)}`}>
              <input
                type="range"
                min={engine === 'server' ? '0.40' : '0.25'}
                max="0.75"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full max-w-xs accent-red-600"
                aria-label="Detection confidence threshold"
              />
            </ControlRow>

            <p className="text-xs opacity-55 leading-relaxed">
              {engine === 'browser'
                ? 'Detection runs entirely in this tab — your camera never leaves the device. The model downloads once and is cached.'
                : 'Frames are sent to the self-hosted backend for detection, about twice a second. Switch to browser detection for real-time boxes.'}{' '}
              A fall is only confirmed after it persists for over a second, which is what stops a bend or a crouch triggering it.
            </p>
          </div>
        </div>

        {/* ---- event rail ---- */}
        <div className="lg:w-72 lg:flex-shrink-0">
          <EventLog events={events} tracked={summary.count} state={summary.state} />
        </div>
      </div>
    </div>
  );
};

function ControlRow({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-[11px] uppercase tracking-widest opacity-55 w-40">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-gray-500/30">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`px-3 py-1.5 font-mono text-[11px] tracking-wider transition-colors ${
            value === option.value
              ? 'bg-red-600 text-white'
              : 'bg-transparent opacity-70 hover:opacity-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BlockingMessage({ children }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-6 text-center font-mono text-sm text-white">
      <div>{children}</div>
    </div>
  );
}

const PHASE_LABEL = {
  model: 'Downloading model',
  session: 'Starting runtime',
  warmup: 'Warming up',
};

function LoadingOverlay({ progress }) {
  const pct = Math.round((progress.value || 0) * 100);
  // Only the model download has a meaningful percentage; the other phases are
  // short and report 0, so showing a stuck "0%" would look broken.
  const determinate = progress.phase === 'model';
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-8 text-center text-white">
      <span className="font-mono text-xs tracking-widest uppercase opacity-80">
        {PHASE_LABEL[progress.phase] || 'Preparing'}
        {determinate ? ` · ${pct}%` : ''}
      </span>
      <div className="w-full max-w-xs h-1 rounded bg-white/20 overflow-hidden">
        <div
          className={`h-full bg-red-500 transition-[width] duration-200 ${
            determinate ? '' : 'console-indeterminate'
          }`}
          style={determinate ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

export default LiveStream;
