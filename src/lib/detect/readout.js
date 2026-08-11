// How a classified posture is presented to a viewer.
//
// Deliberately here rather than inside DetectionOverlay: it is pure string and
// colour selection with no React or canvas dependency, both the live overlay and
// the still-image badges need exactly the same answer, and keeping it framework-
// free is what lets posture-check.mjs pin it down.
//
// This file decides nothing about posture. It only decides how honest the screen
// is about what posture.js already concluded.

// Severity, not decoration: red reads as the thing you're meant to notice, and
// it's the portfolio's own accent. Amber and emerald are the two "nothing is
// wrong" states.
export const CLASS_COLORS = {
  fall: { stroke: '#f87171', fill: '#dc2626', text: '#ffffff' },
  sit: { stroke: '#fbbf24', fill: '#b45309', text: '#ffffff' },
  squat: { stroke: '#a78bfa', fill: '#6d28d9', text: '#ffffff' },
  stand: { stroke: '#34d399', fill: '#047857', text: '#ffffff' },
};

// Slate. Used for an unrecognised class and, more importantly, for the tiers
// below - it has to read as "no answer", not as a fifth posture.
export const FALLBACK_COLOR = { stroke: '#94a3b8', fill: '#334155', text: '#ffffff' };

// Tiers C and D are not weak answers, they are absent ones. At tier C only the
// hips are visible, and a waist-up crop of someone standing and a waist-up crop
// of someone at a desk produce an identical torso; tier D has no torso vector at
// all. posture.js returns `stand` at both because it is the safe non-alarming
// default and the tracker needs *some* class to vote on - but painting that in
// the confident green of a real `stand` read tells the viewer the opposite of
// what the system actually knows.
//
// This matters more here than anywhere else in the app: the demo's own domain is
// a laptop webcam, which frames people from the waist up, so tier C is the single
// most likely thing a visitor will hit. See MODEL_CARD.md, "Known limitation".
//
// The percentage is dropped rather than shown. At these tiers it is personConf
// times a fixed 0.6 / 0.4 discount - a statement about how much of the body was
// visible, not about how likely the label is - and printing it beside a hedge
// reads as a confidence in the hedge.
export function postureReadout(tier, state, confidence) {
  if (tier === 'C') return { color: FALLBACK_COLOR, text: 'LEGS HIDDEN', indeterminate: true };
  if (tier === 'D') return { color: FALLBACK_COLOR, text: 'NO READ', indeterminate: true };
  return {
    color: CLASS_COLORS[state] || FALLBACK_COLOR,
    text: `${String(state).toUpperCase()} ${Math.round((confidence ?? 0) * 100)}%`,
    indeterminate: false,
  };
}
