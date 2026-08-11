import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconCameraRotate } from '@tabler/icons-react';
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

// Which lens to open with.
//
// On a phone you hold the device and point it at the person you're watching,
// so the rear camera is the one that matches the actual use case - and rear
// lenses are considerably wider than front ones, which is what lets a standing
// adult fit in frame from a couple of metres instead of across the room. On a
// laptop there is only the front camera worth opening.
//
// `pointer: coarse` rather than a width breakpoint: this is a question about
// the hardware, not the window size, and a narrow desktop window is still a
// desktop.
function preferredFacingMode() {
  return window.matchMedia?.('(pointer: coarse)').matches ? 'environment' : 'user';
}

// Whether a camera API is reachable at all cannot change during a session, so
// it is resolved once at import rather than inside the acquisition effect:
// setting state synchronously in an effect body cascades an extra render, which
// is the same reason that effect only ever calls setState from async callbacks.
//
// The secure-context case is the one that actually bites - navigator.mediaDevices
// is undefined on plain http at a LAN address, which is exactly how you would
// open this on a phone to try it.
const CAMERA_API_ERROR = navigator.mediaDevices?.getUserMedia
  ? null
  : window.isSecureContext
    ? 'This browser does not expose a camera API.'
    : 'The camera needs a secure context — open this page over HTTPS.';

// How long the top track must stay at tier C/D before the demo tells the viewer
// to step back. Slightly above the tracker's 1.2s fall sustain: this is advice,
// not an alarm, so it can afford to be the slower of the two.
const INDETERMINATE_SUSTAIN_MS = 1500;

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
    // How much of the body the server's posture.js actually had. Without this
    // the server engine would show a confident `stand` in exactly the waist-up
    // framing where the browser engine hedges - the two engines are supposed to
    // be indistinguishable to the viewer.
    tier: d.tier ?? null,
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
  const [facingMode, setFacingMode] = useState(preferredFacingMode);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  // The stage's aspect ratio is taken from the stream rather than hardcoded, so
  // the box matches the camera exactly: nothing is cropped and there are no
  // letterbox bars. Held as a string ("1280 / 720") because that is what the
  // CSS custom property wants. Seeded at 4/3 for the first paint, before any
  // metadata has arrived.
  const [stageRatio, setStageRatio] = useState('4 / 3');
  const [modelCached, setModelCached] = useState(false);
  const [events, setEvents] = useState([]);
  const [serverStats, setServerStats] = useState({ fps: 0, latency: 0 });
  const [summary, setSummary] = useState({
    state: null,
    confirmed: false,
    count: 0,
    legsHidden: false,
  });

  // When the top track first went indeterminate, or null if it isn't. A ref
  // rather than state: it changes on every inference result and nothing renders
  // from it directly.
  const indeterminateSinceRef = useRef(null);

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

      // Sustained, not instantaneous. Someone walking toward the lens clips to
      // waist-up for a frame or two on the way in, and a coaching hint that
      // blinks on and off is worse than no hint at all - the same reasoning that
      // gives the tracker its 1.2s fall sustain.
      const indeterminate = top?.tier === 'C' || top?.tier === 'D';
      if (!indeterminate) {
        indeterminateSinceRef.current = null;
      } else if (indeterminateSinceRef.current === null) {
        indeterminateSinceRef.current = now;
      }

      setSummary({
        state: top?.state ?? null,
        confirmed: stillConfirmed.size > 0,
        count: tracks.length,
        legsHidden:
          indeterminate && now - indeterminateSinceRef.current >= INDETERMINATE_SUSTAIN_MS,
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
    indeterminateSinceRef.current = null;
    setSummary({ state: null, confirmed: false, count: 0, legsHidden: false });
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
    //
    // Every constraint is `ideal`, never `exact`: a browser that cannot honour
    // one picks its closest mode instead of rejecting outright. 1280x720 asks
    // for a real sensor mode rather than whatever low default the UA would
    // otherwise hand back - the detector letterboxes to the model's input size
    // anyway, but a sharper source is a better one to letterbox from. The
    // OverconstrainedError retry below covers the devices that reject it
    // regardless.
    if (CAMERA_API_ERROR) return undefined;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .catch((err) => {
        if (err?.name !== 'OverconstrainedError') throw err;
        return navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
        });
      })
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
      // Legacy string events carry no tier, so no hedge can be made about them.
      setSummary({ state: label, confirmed: false, count: 1, legsHidden: false });
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

  // videoWidth/Height are 0 until metadata lands; guard so a stray early event
  // can't write "0 / 0" into the ratio and collapse the stage.
  const onLoadedMetadata = useCallback((event) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth && videoHeight) setStageRatio(`${videoWidth} / ${videoHeight}`);
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto page-gutter">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* ---- viewport ---- */}
        <div className="flex-1 min-w-0">
          <div
            ref={hostRef}
            style={{ '--stage-ratio': stageRatio }}
            className={`camera-stage relative w-full overflow-hidden bg-black/30 sm:rounded-2xl ${
              summary.confirmed ? 'console-alert' : ''
            }`}
          >
            {/*
              object-contain, not cover.
              ----------------------------------------------------------------
              cover crops whatever doesn't fit the box - on a 16:9 phone camera
              in the old fixed 4:3 stage that was roughly a quarter of the frame
              width, as viewport.js's own comment notes. The model always saw
              the whole frame, so those detections were computed and then drawn
              outside the visible element; what it cost the user was framing,
              since the only way to get a person inside that narrower visible
              window was to back away from them.

              With the stage's aspect ratio driven by the stream, contain and
              cover agree in the steady state - contain is what keeps the full
              field of view visible during the moments they don't, i.e. while a
              camera flip resolves and the box still has the old ratio.
            */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              loop={source === 'clip'}
              src={source === 'clip' ? SAMPLE_CLIP_URL ?? undefined : undefined}
              onLoadedMetadata={onLoadedMetadata}
              className={`w-full h-full block object-contain ${mirror ? 'scale-x-[-1]' : ''}`}
            />

            <DetectionOverlay
              hostRef={hostRef}
              sourceRef={videoRef}
              getTracks={getTracks}
              mirror={mirror}
              fit="contain"
            />

            {/* HUD */}
            <div className="stage-safe-top absolute top-0 inset-x-0 flex items-start justify-between px-3 pointer-events-none font-mono text-[11px] tracking-wider">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-black/55 text-white backdrop-blur-sm">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    detecting ? 'bg-red-500 console-pulse' : 'bg-white/40'
                  }`}
                />
                {detecting ? 'LIVE' : 'IDLE'}
              </span>
              <span className="px-2 py-1 rounded bg-black/55 text-white/85 backdrop-blur-sm tabular-nums">
                {stats.fps.toFixed(0)} FPS
                {stats.latency ? ` · ${stats.latency.toFixed(0)}ms` : ''} · {engineLabel}
              </span>
            </div>

            <div className="stage-safe-bottom absolute bottom-0 inset-x-0 flex items-end justify-between px-3 pointer-events-none">
              {/* An alarm outranks advice, though in practice they cannot
                  co-occur: the fall gate needs a torso vector, so a confirmed
                  fall is always tier A. */}
              {summary.confirmed ? (
                <div className="px-3 py-1.5 pebble-badge bg-red-600 text-white font-mono text-xs font-bold tracking-wider">
                  FALL CONFIRMED
                </div>
              ) : summary.legsHidden ? (
                <div className="px-3 py-1.5 pebble-badge bg-black/70 text-white/90 font-mono text-[11px] tracking-wider backdrop-blur-sm">
                  Knees not in frame — step back to read sit/stand
                </div>
              ) : (
                <span />
              )}

              {hasMultipleCameras && usingOwnCamera && (
                <button
                  type="button"
                  onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                  className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform duration-200 active:scale-95 cursor-pointer"
                  aria-label={
                    facingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'
                  }
                  title="Switch camera"
                >
                  <IconCameraRotate size={20} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Blocking states, in priority order. */}
            {engine === 'browser' && browser.status === 'loading' && (
              <LoadingOverlay progress={browser.progress} />
            )}
            {engine === 'browser' && browser.status === 'error' && (
              <BlockingMessage>
                Detector failed to start: {browser.error}
                <br />
                <button
                  type="button"
                  className="underline mt-2 min-h-11 cursor-pointer"
                  onClick={() => changeEngine('server')}
                >
                  Switch back to server detection
                </button>
              </BlockingMessage>
            )}
            {usingOwnCamera && (cameraError || CAMERA_API_ERROR) && (
              <BlockingMessage>{cameraError || CAMERA_API_ERROR}</BlockingMessage>
            )}
            {source === 'clip' && !SAMPLE_CLIP_URL && (
              <BlockingMessage>No sample clip is bundled yet.</BlockingMessage>
            )}
          </div>

          {/* Offscreen scratch canvas for the server engine's frame capture -
              never meant to be seen. `hidden` is safe again now that Mantine
              is gone: its NormalizeCSS used to inject an unlayered
              `canvas { display: inline-block }` at runtime, which outranked
              Tailwind's layered utility and rendered this at full
              videoWidth x videoHeight under the real feed. */}
          <canvas ref={captureCanvasRef} className="hidden" />

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
                className="w-full max-w-xs accent-accent cursor-pointer"
                aria-label="Detection confidence threshold"
              />
            </ControlRow>

            <p className="text-xs text-dim leading-relaxed max-w-prose">
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="font-mono text-[11px] uppercase tracking-widest text-dim w-full sm:w-40 tabular-nums">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-line">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`min-h-11 px-3 font-mono text-[11px] tracking-wider transition-colors duration-200 cursor-pointer ${
            value === option.value
              ? 'bg-accent text-canvas font-semibold'
              : 'bg-transparent text-dim hover:text-head hover:bg-raise'
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
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center font-mono text-sm text-white">
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
          className={`h-full bg-accent transition-[width] duration-200 ${
            determinate ? '' : 'console-indeterminate'
          }`}
          style={determinate ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

export default LiveStream;
