#!/usr/bin/env python3
"""Pick thresholds for the squat gate (and the two smaller fixes) by replaying
posture.js's actual decision chain over the measured corpus.

Medians are not enough to place a gate. What matters is what the gate does *in
position* - after the fall check and the front-on sit gate have already claimed
their cases - and how much of every other class it steals on the way. So this
reimplements the chain and sweeps.

Ground-truth caveat, unchanged from analyse-features.py: the corpus's `squat`
class is crouching bystanders at accident scenes, not clean exercise squats, and
its `fall` class marks "person is down" including seated-on-ground. Treat the
squat column as "does the gate fire on deep-knee-bend crouches" - which is the
posture squat shares - and not as a squat accuracy figure.

Usage:  python3 calibrate-squat.py
"""

import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
# scripts/calibration -> frontend-new -> repo root -> corpus-2023
CORPUS = HERE.parents[2] / "corpus-2023"
rows = [json.loads(l) for l in open(CORPUS / "features.jsonl") if l.strip()]
matched = [r for r in rows if r["gt"]]

CLASSES = ["fall", "sit", "squat", "stand"]

FALL_TORSO_ANGLE = 50
FALL_ASPECT = 1.5
FALL_ASPECT_TORSO_ANGLE = 30
STAND_KNEE_DROP = 0.5
STAND_KNEE_ANGLE = 150
SIT_THIGH_FORESHORTEN = 0.75


def classify(f, squat=None, kneel=None, tiebreak="kneeDrop", squat_first=True):
    """Mirror of classifyPosture's branch order. Returns a class name.

    squat:    (kneeAngle_max, hipAnkleDrop_max, stanceOffset_max) or None
    kneel:    thighShinRatio_min above which a kneel reads as a fall, or None
    tiebreak: which feature wins when kneeDrop and kneeAngle disagree
    """
    t = f["torsoAngle"]
    if t is None:
        return "stand"  # tier D

    if t >= FALL_TORSO_ANGLE or (f["aspect"] >= FALL_ASPECT and t >= FALL_ASPECT_TORSO_ANGLE):
        return "fall"

    if f["kneeDrop"] is None:
        return "stand"  # tier C

    # Shin foreshortened far past any in-plane pose: the shin points at the lens,
    # which is kneeling. Placed before the thigh gate because the thigh ratio is
    # the same quantity read the other way and would otherwise never see it.
    if kneel is not None and f["thighShinRatio"] is not None and f["thighShinRatio"] >= kneel:
        return "fall"

    # Squat: deep knee bend with the body folded down over the feet. Needs the
    # full leg chain - hipAnkleDrop and stanceOffset both require ankles - so it
    # is unreachable in tier B by construction.
    def is_squat():
        if squat is None:
            return False
        if None in (f["kneeAngle"], f["hipAnkleDrop"], f["stanceOffset"]):
            return False
        ka_max, had_max, so_max = squat
        return (f["kneeAngle"] < ka_max and f["hipAnkleDrop"] < had_max
                and f["stanceOffset"] < so_max)

    # Placement matters: a deep crouch foreshortens the thigh too, so the
    # front-on sit gate claims 40% of crouches before a squat gate placed after
    # it ever sees them.
    if squat_first and is_squat():
        return "squat"

    if f["thighShinRatio"] is not None and f["thighShinRatio"] < SIT_THIGH_FORESHORTEN:
        return "sit"

    if not squat_first and is_squat():
        return "squat"

    drop_says_sit = f["kneeDrop"] < STAND_KNEE_DROP

    if f["kneeAngle"] is None:
        return "sit" if drop_says_sit else "stand"  # tier B

    angle_says_sit = f["kneeAngle"] < STAND_KNEE_ANGLE
    if drop_says_sit == angle_says_sit:
        return "sit" if drop_says_sit else "stand"
    if tiebreak == "kneeDrop":
        return "sit" if drop_says_sit else "stand"
    if tiebreak == "kneeAngle":
        return "sit" if angle_says_sit else "stand"
    if tiebreak == "either":  # either signal claiming sit wins
        return "sit"
    raise ValueError(tiebreak)


def score(**kw):
    cm = {c: Counter() for c in CLASSES}
    for r in matched:
        cm[r["gt"]][classify(r["f"], **kw)] += 1
    return cm


def line(cm, label):
    parts = []
    for c in CLASSES:
        n = sum(cm[c].values())
        parts.append(f"{c} {cm[c][c]}/{n}" if n else f"{c} -")
    print(f"  {label:44} " + "   ".join(p.ljust(13) for p in parts))


base = score()
print("=== baseline (current posture.js, no squat class) ===\n")
line(base, "current")

# --- squat gate sweep ----------------------------------------------------
print("\n\n=== squat gate sweep ===")
print("  gate: kneeAngle < A  and  hipAnkleDrop < H  and  stanceOffset < S\n")
print("  Reading: `squat n/N` is how many crouches the gate catches. The other")
print("  three columns must not fall relative to baseline - that is what the")
print("  gate costs. Baseline squat is 0/170 because the class does not exist.\n")

best = None
for A in (110, 120, 130):
    for H in (0.8, 1.0, 1.2):
        for S in (0.35, 0.5, 0.7):
            cm = score(squat=(A, H, S))
            caught = cm["squat"]["squat"]
            # cost = correct predictions lost on the three existing classes
            cost = sum(base[c][c] - cm[c][c] for c in ("fall", "sit", "stand"))
            if best is None or (caught - cost) > best[0]:
                best = (caught - cost, A, H, S, cost, caught)
            line(cm, f"A={A} H={H} S={S}   (cost {cost:+d})")

print(f"\n  best net: A={best[1]} H={best[2]} S={best[3]}  "
      f"catches {best[5]} crouches, costs {best[4]} elsewhere")

# --- kneeling gate -------------------------------------------------------
print("\n\n=== kneeling gate: thighShinRatio >= K reads as fall ===\n")
print("  What fraction of each class has a shin foreshortened past K:\n")
for K in (2.0, 2.5, 3.0, 4.0):
    counts = {}
    for c in CLASSES:
        vals = [r["f"]["thighShinRatio"] for r in matched
                if r["gt"] == c and r["f"]["thighShinRatio"] is not None]
        counts[c] = (sum(1 for v in vals if v >= K), len(vals))
    desc = "  ".join(f"{c} {n}/{t}" for c, (n, t) in counts.items())
    print(f"  K={K}   {desc}")

print()
for K in (2.5, 3.0):
    line(score(kneel=K), f"kneel K={K}")

# --- disagreement tie-break ---------------------------------------------
print("\n\n=== kneeDrop/kneeAngle disagreement tie-break ===\n")
dis = [r for r in matched
       if r["f"]["kneeDrop"] is not None and r["f"]["kneeAngle"] is not None
       and (r["f"]["kneeDrop"] < STAND_KNEE_DROP) != (r["f"]["kneeAngle"] < STAND_KNEE_ANGLE)]
print(f"  cases where they disagree: {len(dis)}")
print("  gt breakdown:", dict(Counter(r["gt"] for r in dis)), "\n")
for tb in ("kneeDrop", "kneeAngle", "either"):
    line(score(tiebreak=tb), f"tiebreak = {tb}")

# --- combined ------------------------------------------------------------
print("\n\n=== combined candidate ===\n")
line(base, "baseline")
line(score(squat=(best[1], best[2], best[3]), kneel=2.5), "squat + kneel")
line(score(squat=(best[1], best[2], best[3]), kneel=2.5, tiebreak="kneeAngle"),
     "squat + kneel + tiebreak=kneeAngle")
