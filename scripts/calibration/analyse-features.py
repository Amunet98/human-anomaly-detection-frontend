#!/usr/bin/env python3
"""Analyse feature-dump.mjs output: where the 2026 geometry agrees with the 2023
corpus, where it does not, and whether the disagreements are fixable.

The interesting question is not the headline agreement rate - the 2023 labels are
box-level annotations made for a detector and are not clean enough to score
against. It is the *structure* of the disagreement: a miss that every feature
calls upright is a different problem from one where two features disagree and the
tie-break went the wrong way. The first may be unfixable from 2D keypoints; the
second is a threshold.

Usage:  python3 analyse-features.py [features.jsonl]
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
# scripts/calibration -> frontend-new -> repo root -> corpus-2023
CORPUS = HERE.parents[2] / "corpus-2023"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else CORPUS / "features.jsonl"

CLASSES = ["fall", "sit", "squat", "stand"]

# Mirrors posture.js. Kept here so the analysis can say which gate fired.
FALL_TORSO_ANGLE = 50
FALL_ASPECT = 1.5
FALL_ASPECT_TORSO_ANGLE = 30
AMBIGUOUS_TORSO_ANGLE = 30
STAND_KNEE_DROP = 0.5
STAND_KNEE_ANGLE = 150
SIT_THIGH_FORESHORTEN = 0.75

rows = [json.loads(l) for l in open(SRC) if l.strip()]
matched = [r for r in rows if r["gt"]]

print(f"rows: {len(rows)}   matched to a gt box: {len(matched)}")
print(f"tiers: {dict(Counter(r['tier'] for r in rows))}")

# --- confusion -----------------------------------------------------------
cm = defaultdict(Counter)
for r in matched:
    cm[r["gt"]][r["pred"]] += 1

print("\n=== 2023 corpus label (row) vs 2026 geometric prediction (col) ===\n")
print("  " + "truth\\pred".ljust(12) + "".join(c.ljust(8) for c in CLASSES) + "n")
for c in CLASSES:
    tot = sum(cm[c].values())
    print("  " + c.ljust(12) + "".join(str(cm[c][p]).ljust(8) for p in CLASSES) + str(tot))
agree = sum(cm[c][c] for c in CLASSES)
print(f"\n  raw agreement: {agree}/{len(matched)} = {agree/len(matched):.1%}")
print("  (not an accuracy figure - the 2023 labels are not clean. Structure below is the point.)")

# --- where do fall misses come from? -------------------------------------
falls = [r for r in matched if r["gt"] == "fall"]
miss = [r for r in falls if r["pred"] != "fall"]
print(f"\n\n=== fall recall: {len(falls)-len(miss)}/{len(falls)} caught, {len(miss)} missed ===\n")

buckets = Counter()
for r in miss:
    f = r["f"]
    t, ka, tsr = f["torsoAngle"], f["kneeAngle"], f["thighShinRatio"]
    if t is None:
        buckets["tier D - no torso vector (hips or shoulders unseen)"] += 1
    elif f["kneeDrop"] is None:
        buckets["tier C - no knees, sit/stand indeterminate"] += 1
    elif tsr is not None and tsr >= 2.5:
        buckets["shin foreshortened (thighShin >= 2.5) - kneeling/on all fours"] += 1
    elif ka is not None and ka < STAND_KNEE_ANGLE and f["kneeDrop"] >= STAND_KNEE_DROP:
        buckets["kneeDrop/kneeAngle disagree, tie-break chose stand"] += 1
    elif t >= AMBIGUOUS_TORSO_ANGLE:
        buckets[f"torso 30-50 deg - ambiguous band, below the fall gate -> {r['pred']}"] += 1
    elif f["kneeDrop"] < STAND_KNEE_DROP:
        # Upright torso AND knees at/above hip height: this reads as a seated
        # person, not a standing one. Distinct problem from the view-axis case.
        buckets["torso upright + knees high - reads as seated -> sit"] += 1
    else:
        buckets["torso upright + legs extended - reads as standing -> stand"] += 1

for k, v in buckets.most_common():
    print(f"  {v:5}  ({v/len(miss):5.1%})  {k}")

print("\n  missed falls by predicted class:",
      dict(Counter(r["pred"] for r in miss)))

# --- the unfixable-looking bucket, in detail ------------------------------
axis = [
    r for r in miss
    if r["f"]["torsoAngle"] is not None
    and r["f"]["torsoAngle"] < AMBIGUOUS_TORSO_ANGLE
    and r["f"]["kneeDrop"] is not None
    and r["f"]["kneeDrop"] >= STAND_KNEE_DROP
    and (r["f"]["thighShinRatio"] is None or r["f"]["thighShinRatio"] < 2.5)
]
if axis:
    print(f"\n\n=== 'reads upright' falls ({len(axis)}) - is any feature separating them? ===\n")
    stands = [r for r in matched if r["gt"] == "stand" and r["pred"] == "stand"]
    for feat in ["torsoAngle", "kneeDrop", "kneeAngle", "thighShinRatio", "aspect",
                 "hipAnkleDrop", "stanceOffset"]:
        a = sorted(x for x in (r["f"][feat] for r in axis) if x is not None)
        s = sorted(x for x in (r["f"][feat] for r in stands) if x is not None)
        if not a or not s:
            continue
        med_a = a[len(a) // 2]
        med_s = s[len(s) // 2]
        print(f"  {feat:16} axis-falls med={med_a:8.2f} (n={len(a):4})   "
              f"true-stands med={med_s:8.2f} (n={len(s):4})   delta={med_a-med_s:+.2f}")
    print("\n  A feature that separates these two rows is a candidate new gate.")
    print("  Overlapping medians mean 2D keypoints do not carry the distinction.")

# --- distributions, for threshold calibration ----------------------------
def q(vals, p):
    s = sorted(v for v in vals if v is not None)
    if not s:
        return None
    return s[min(len(s) - 1, int(len(s) * p))]

print("\n\n=== feature distributions by 2023 class (p05 / median / p95) ===")
for feat in ["torsoAngle", "kneeDrop", "kneeAngle", "thighShinRatio",
             "aspect", "hipAnkleDrop", "stanceOffset"]:
    print(f"\n--- {feat}")
    for c in CLASSES:
        vals = [r["f"][feat] for r in matched if r["gt"] == c]
        n = len([v for v in vals if v is not None])
        if not n:
            print(f"  {c:8} (none measurable)")
            continue
        print(f"  {c:8} n={n:5}   p05={q(vals,0.05):8.2f}   med={q(vals,0.5):8.2f}   p95={q(vals,0.95):8.2f}")

# --- does the existing threshold sit in an empty band? -------------------
print("\n\n=== threshold sanity: fraction of each class on each side ===\n")
checks = [
    ("torsoAngle", FALL_TORSO_ANGLE, "fall gate"),
    ("kneeDrop", STAND_KNEE_DROP, "sit/stand gate"),
    ("kneeAngle", STAND_KNEE_ANGLE, "sit/stand gate"),
    ("thighShinRatio", SIT_THIGH_FORESHORTEN, "front-on sit gate"),
]
for feat, thr, label in checks:
    print(f"  {feat} < {thr}  ({label})")
    for c in CLASSES:
        vals = [r["f"][feat] for r in matched if r["gt"] == c and r["f"][feat] is not None]
        if not vals:
            continue
        below = sum(1 for v in vals if v < thr)
        print(f"     {c:8} {below/len(vals):6.1%} below   (n={len(vals)})")
    print()
