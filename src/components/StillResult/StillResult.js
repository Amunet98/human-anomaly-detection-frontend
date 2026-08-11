import { useCallback, useRef } from 'react';
import { DetectionOverlay } from '../DetectionOverlay/DetectionOverlay';
import { postureReadout } from '../../lib/detect/readout';

// Shows a single analysed image with its detections drawn on top.
//
// Both the upload and URL paths previously rendered only `top.className` as a
// bare string and never showed the image at all - so every box the model
// produced was computed server-side, sent over the wire, and discarded. This
// renders the same payload /analyze already returns.
//
// object-contain rather than cover here: for a one-off image the whole frame
// should be visible, and a crop would hide detections the model actually made.
export function StillResult({ src, detections, loading, error }) {
  const hostRef = useRef(null);
  const imgRef = useRef(null);

  // Adapts /analyze's payload to what the overlay draws. Stills have no
  // temporal state, so there is no tracker involved: no ids to keep stable, no
  // vote to take, and nothing can be a *confirmed* fall from one frame - which
  // is the whole reason the live view needs a tracker at all.
  const getTracks = useCallback(
    () =>
      (detections || []).map((d, index) => ({
        id: index + 1,
        state: d.className,
        confidence: d.confidence,
        fallConfirmed: false,
        opacity: 1,
        box: { x1: d.box[0], y1: d.box[1], x2: d.box[2], y2: d.box[3] },
        // The server sends occluded joints as {x: null, y: null}; the overlay
        // already skips any edge with a missing endpoint, so they pass straight
        // through.
        keypoints: d.keypoints ?? null,
        tier: d.tier ?? null,
      })),
    [detections],
  );

  if (error) {
    return (
      <p className="mt-4 font-mono text-sm text-accent break-words">{error}</p>
    );
  }
  if (!src) return null;

  return (
    <div className="mt-6">
      <div ref={hostRef} className="relative w-full rounded-2xl overflow-hidden bg-black/20">
        <img
          ref={imgRef}
          src={src}
          alt="Analysed frame with detections"
          className="w-full block max-h-80 object-contain"
        />
        {!loading && <DetectionOverlay
          hostRef={hostRef}
          sourceRef={imgRef}
          getTracks={getTracks}
          fit="contain"
        />}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 font-mono text-xs tracking-widest uppercase text-white">
            Analysing…
          </div>
        )}
      </div>

      {!loading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {detections?.length ? (
            detections.map((d, index) => {
              // /analyze already returns `tier` per detection (inference.js), so
              // the still path hedges an indeterminate read exactly like the live
              // overlay does - same helper, no API change.
              const readout = postureReadout(d.tier, d.className, d.confidence);
              return (
                <span
                  key={`${d.className}-${index}`}
                  className="px-2.5 py-1 rounded font-mono text-[11px] tracking-wider text-white"
                  style={{ backgroundColor: readout.color.fill }}
                >
                  #{index + 1} {readout.text}
                </span>
              );
            })
          ) : (
            <span className="font-mono text-xs text-dim">
              No person detected above the confidence threshold.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
