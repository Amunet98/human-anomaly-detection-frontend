// Box smoothing for the overlay.
//
// Inference lands at somewhere between 1 and 30 results per second depending on
// the device and execution provider, while the overlay redraws at display rate.
// Drawing the last result verbatim makes boxes snap between positions; this
// eases them toward the newest target instead.
//
// Deliberately an exponential filter toward the latest target, NOT a lerp
// between the last two results. A true lerp has nothing to interpolate toward
// until the *next* result arrives, so it only works if the display is delayed
// by one inference period - which on a mid-range phone at 1fps would mean a
// one-second-stale overlay. This adapts to any inference rate and buffers
// nothing.

// Time constant in seconds. Roughly: how long the box takes to cover ~63% of
// the distance to its target. Lower is snappier and jitterier.
const TAU = 0.07;

// Above this the filter is skipped entirely - after a tab has been backgrounded
// or on the very first result, easing from a stale position produces a visible
// slide across the frame.
const SNAP_AFTER_MS = 500;

export class BoxSmoother {
  constructor() {
    this.state = new Map();
  }

  reset() {
    this.state.clear();
  }

  // `tracks` come from Tracker.update/live. Returns the same tracks with `box`
  // and `confidence` replaced by their smoothed values.
  sample(tracks, now) {
    const seen = new Set();
    const out = [];

    for (const track of tracks) {
      seen.add(track.id);
      const previous = this.state.get(track.id);

      if (!previous || now - previous.at > SNAP_AFTER_MS) {
        // New track: start at its detected position rather than sliding in
        // from wherever the previous holder of this slot was.
        const fresh = { ...track.box, confidence: track.confidence, at: now };
        this.state.set(track.id, fresh);
        out.push({ ...track, box: { ...track.box } });
        continue;
      }

      const dt = Math.max(0, (now - previous.at) / 1000);
      const k = 1 - Math.exp(-dt / TAU);
      const next = {
        x1: previous.x1 + (track.box.x1 - previous.x1) * k,
        y1: previous.y1 + (track.box.y1 - previous.y1) * k,
        x2: previous.x2 + (track.box.x2 - previous.x2) * k,
        y2: previous.y2 + (track.box.y2 - previous.y2) * k,
        // Smoothed too, otherwise the percentage in the label strobes even
        // when the box is steady.
        confidence: previous.confidence + (track.confidence - previous.confidence) * k,
        at: now,
      };
      this.state.set(track.id, next);
      out.push({
        ...track,
        confidence: next.confidence,
        box: { x1: next.x1, y1: next.y1, x2: next.x2, y2: next.y2 },
      });
    }

    for (const id of this.state.keys()) {
      if (!seen.has(id)) this.state.delete(id);
    }
    return out;
  }
}
