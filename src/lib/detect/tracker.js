import { iou } from './postprocess.js';

// Multi-object tracker with temporal state, sitting between the raw per-frame
// detector and the overlay.
//
// This is the part that makes the system read as accurate, and it is not a
// cosmetic layer. best.onnx classifies each frame in isolation, but a fall is a
// *transition into a sustained state* - a single frame genuinely cannot
// distinguish someone who has fallen from someone bending down, crouching, or
// lying on a sofa, because in one frame those look the same. Without temporal
// state the label strobes between classes and fires on anyone who bends over.
//
// So: associate detections into tracks, vote on each track's class over a short
// window, and require a fall to persist before it counts as one. The raw
// per-frame class is still exposed alongside, so the UI can stay honest about
// what the model actually said versus what the system concluded.

// Association. Loose on purpose: at 5fps a walking person moves a long way
// between frames, and a too-strict gate spawns a new track every frame.
const ASSOC_IOU = 0.3;

// Class vote window, in results (not milliseconds) - it should span the same
// number of observations regardless of how fast inference happens to be.
const VOTE_WINDOW = 7;

// Asymmetric thresholds. A track has to be clearly a fall to become one, but
// only ambiguously not-a-fall to stop being one: under-reporting a real fall is
// the worse error for this system, and the gap is what stops a detection
// hovering near the threshold from chattering.
const FALL_ENTER_CONF = 0.55;
const FALL_EXIT_CONF = 0.35;

// How long a track must hold the 'fall' vote before it is confirmed. This is
// the single most effective false-positive filter here: bending to pick
// something up reads as 'fall' for a few frames, but not for over a second.
const FALL_CONFIRM_MS = 1200;

// Box aspect ratio used to be nudged into the fall evidence here, back when the
// detector classified posture from appearance and had no direct read on body
// orientation. posture.js now measures the shoulder-to-hip angle itself and
// already folds aspect into that decision (FALL_ASPECT), so applying it again
// at this layer would count the same weak signal twice - once inside the
// classifier's confidence and once on top of it. Removed rather than retuned:
// the signal is not gone, it moved to where the geometry is.

// Track lifecycle, in milliseconds.
const FADE_IN_MS = 120;
const HOLD_MS = 200;
const DROP_MS = 400;

let nextId = 1;

export class Tracker {
  constructor() {
    this.tracks = new Map();
  }

  reset() {
    this.tracks.clear();
  }

  // Feed one detector result. `detections` are in source-image pixels.
  // Returns the live tracks, newest state applied.
  update(detections, now) {
    const unmatched = new Set(this.tracks.keys());

    // Greedy matching by descending confidence. Greedy rather than Hungarian
    // because with a handful of people in frame the optimal assignment and the
    // greedy one almost always agree, and this has no dependencies.
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    for (const det of sorted) {
      let bestId = null;
      let bestIou = ASSOC_IOU;
      for (const id of unmatched) {
        const score = iou(det, this.tracks.get(id).box);
        if (score > bestIou) {
          bestIou = score;
          bestId = id;
        }
      }

      if (bestId === null) {
        this.tracks.set(nextId, newTrack(nextId, det, now));
        nextId++;
      } else {
        unmatched.delete(bestId);
        observe(this.tracks.get(bestId), det, now);
      }
    }

    // Tracks with no detection this round hold their last box and fade rather
    // than vanishing, so a single dropped frame doesn't flicker the overlay.
    for (const id of unmatched) {
      const track = this.tracks.get(id);
      if (now - track.lastSeen > DROP_MS) this.tracks.delete(id);
    }

    return this.live(now);
  }

  // Liveness is decided by the drop timeout, not by opacity: a track observed
  // this very instant has age 0 and therefore opacity 0, and filtering on that
  // would hide every box on the frame it first appears. The render loop samples
  // at display rate, so the fade-in resolves within a few frames.
  live(now) {
    const out = [];
    for (const track of this.tracks.values()) {
      const since = now - track.lastSeen;
      if (since > DROP_MS) continue;
      const age = now - track.firstSeen;
      const opacity =
        since <= HOLD_MS
          ? Math.min(1, age / FADE_IN_MS)
          : Math.max(0, 1 - (since - HOLD_MS) / (DROP_MS - HOLD_MS));
      out.push({ ...track, opacity });
    }
    return out;
  }
}

function newTrack(id, det, now) {
  const track = {
    id,
    box: { x1: det.x1, y1: det.y1, x2: det.x2, y2: det.y2 },
    votes: [],
    // What the model said about this exact frame.
    rawClass: det.className,
    rawConfidence: det.confidence,
    // Straight passthrough for the skeleton overlay. Deliberately not voted on
    // or smoothed: joints are per-frame evidence, and averaging them across a
    // window would draw a limb where the body never was.
    keypoints: det.keypoints ?? null,
    // What the tracker concluded over the vote window.
    state: det.className,
    confidence: det.confidence,
    fallSince: null,
    fallConfirmed: false,
    firstSeen: now,
    lastSeen: now,
  };
  observe(track, det, now);
  return track;
}

function observe(track, det, now) {
  track.box = { x1: det.x1, y1: det.y1, x2: det.x2, y2: det.y2 };
  track.lastSeen = now;
  track.rawClass = det.className;
  track.rawConfidence = det.confidence;
  track.keypoints = det.keypoints ?? null;

  // The classifier's confidence already encodes how much evidence supported the
  // call - how far the torso cleared the fall boundary, and how much of the body
  // was visible at all (its tier discount). Using it directly as the vote weight
  // means a tier-C guess from a waist-up frame cannot outvote a clean full-body
  // read in the same window.
  track.votes.push({ className: det.className, weight: det.confidence });
  if (track.votes.length > VOTE_WINDOW) track.votes.shift();

  // Confidence-weighted majority over the window: a couple of low-confidence
  // stray frames can't outvote a run of confident ones.
  const totals = new Map();
  for (const vote of track.votes) {
    totals.set(vote.className, (totals.get(vote.className) || 0) + vote.weight);
  }
  let winner = track.state;
  let best = -Infinity;
  for (const [className, total] of totals) {
    if (total > best) {
      best = total;
      winner = className;
    }
  }
  const votedConfidence = best / track.votes.length;

  // The displayed state simply follows the vote. It deliberately has no
  // confidence gate: gating it would mean showing 'stand' while the model says
  // 'fall' on every single frame at 0.5 confidence, which is the system lying
  // about what it saw. The vote window is what suppresses flicker here.
  track.state = winner;
  track.confidence = votedConfidence;

  // Confirmation is the stricter, alert-worthy conclusion, and it is where the
  // confidence bar belongs: a fall counts once the track has read as a fall
  // continuously for FALL_CONFIRM_MS *and* the evidence is strong.
  //
  // The clock resets the moment the state stops being 'fall', so the duration
  // always describes one continuous episode rather than accumulating across
  // separate near-misses.
  if (track.state !== 'fall') {
    track.fallSince = null;
    track.fallConfirmed = false;
    return;
  }

  if (track.fallSince === null) track.fallSince = now;
  const sustained = now - track.fallSince >= FALL_CONFIRM_MS;

  // Hysteresis: clearing an already-confirmed fall needs the evidence to drop
  // well below the bar that raised it, not merely to wobble across it. Someone
  // lying still is often detected less confidently than the fall itself, and
  // the confirmation should not blink off when that happens.
  track.fallConfirmed = track.fallConfirmed
    ? votedConfidence >= FALL_EXIT_CONF
    : sustained && votedConfidence >= FALL_ENTER_CONF;
}

export const TRACKER_TUNING = {
  ASSOC_IOU,
  VOTE_WINDOW,
  FALL_ENTER_CONF,
  FALL_EXIT_CONF,
  FALL_CONFIRM_MS,
};
