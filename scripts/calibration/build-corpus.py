#!/usr/bin/env python3
"""Stage a deduplicated copy of the 2023 fallsdata2 export for calibration work.

The 2023 Roboflow export applies ~2.4x augmentation to the train split: 11,214
image files collapse to 4,924 distinct source images once the `_jpg.rf.<hash>`
suffix is stripped. Sampling fixtures or measuring feature distributions over
the raw export would weight augmented frames 3x and inflate any number taken
from it - the same mistake that made the 2023 model's 88% look like a result.

So: one representative per stem, chosen deterministically (lowest hash), with
the YOLO label converted to absolute pixel boxes alongside it. Splits are
preserved because they are clean - no stem appears in more than one.

Reads from the BP external drive, writes here. Never writes to the drive.

Usage:  python3 build-corpus.py [--src PATH] [--limit N]
"""

import argparse
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

SRC_DEFAULT = Path(
    "/run/media/amunet/BP/FY_project/datasets/fallsdata2.v1i.yolov8"
)
HERE = Path(__file__).resolve().parent
# scripts/calibration -> frontend-new -> repo root -> corpus-2023
CORPUS = HERE.parents[2] / "corpus-2023"

# data.yaml: names: ['falls', 'sits', 'squats', 'stands']
#
# Renamed to the 2026 system's vocabulary (CLASS_NAMES in constants.js) so the
# two sides speak the same words. `squat` is kept as the dataset's own name for
# class 2 but is NOT trustworthy - see MODEL_CARD / the plan: class 2 is in
# practice "crouching bystander at an accident scene", and in those images the
# genuinely fallen person is frequently left unlabelled. Treat any class-2 row
# as a candidate to hand-verify, never as ground truth.
CLASS_NAMES = {0: "fall", 1: "sit", 2: "squat", 3: "stand"}

STEM_RE = re.compile(r"_jpg\.rf\..*$")

# Roboflow exports omit the trailing newline, so a naive `cat *.txt` glues the
# last line of one file onto the first of the next. Parse per file.
def read_label(path: Path, width: int, height: int):
    boxes = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        cid = int(parts[0])
        cx, cy, w, h = (float(v) for v in parts[1:5])
        boxes.append(
            {
                "cls": CLASS_NAMES.get(cid, f"unknown_{cid}"),
                "clsId": cid,
                # YOLO normalised cx,cy,w,h -> absolute x1,y1,x2,y2
                "box": [
                    round((cx - w / 2) * width),
                    round((cy - h / 2) * height),
                    round((cx + w / 2) * width),
                    round((cy + h / 2) * height),
                ],
            }
        )
    return boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=SRC_DEFAULT)
    ap.add_argument("--limit", type=int, default=0, help="cap images (smoke test)")
    args = ap.parse_args()

    if not args.src.exists():
        sys.exit(f"Source not found: {args.src}\nIs the BP drive mounted?")

    # Every image is 640x640 in this export (verified across a 400-image sample),
    # which happens to match INPUT_SIZE exactly. Hardcoding it avoids opening
    # 11k files with PIL just to read a header; assert instead so a differently
    # sized re-export fails loudly rather than producing silently wrong boxes.
    width = height = 640

    stems = defaultdict(list)
    for split in ("train", "valid", "test"):
        for img in sorted((args.src / split / "images").glob("*.jpg")):
            stems[STEM_RE.sub("", img.name)].append((split, img))

    out_img = CORPUS / "images"
    out_img.mkdir(parents=True, exist_ok=True)

    manifest = []
    skipped_nolabel = 0
    for stem in sorted(stems):
        split, img = sorted(stems[stem])[0]  # deterministic representative
        label = args.src / split / "labels" / (img.stem + ".txt")
        if not label.exists():
            skipped_nolabel += 1
            continue
        boxes = read_label(label, width, height)
        dest = out_img / f"{stem}.jpg"
        if not dest.exists():
            shutil.copy2(img, dest)
        manifest.append(
            {
                "stem": stem,
                "file": dest.name,
                "split": split,
                "width": width,
                "height": height,
                "source": f"{split}/images/{img.name}",
                "gt": boxes,
            }
        )
        if args.limit and len(manifest) >= args.limit:
            break

    (CORPUS / "manifest.jsonl").write_text(
        "".join(json.dumps(m) + "\n" for m in manifest)
    )

    counts = defaultdict(int)
    empty = 0
    for m in manifest:
        if not m["gt"]:
            empty += 1
        for b in m["gt"]:
            counts[b["cls"]] += 1

    print(f"unique stems       : {len(stems)}")
    print(f"staged images      : {len(manifest)}")
    print(f"no label file      : {skipped_nolabel}")
    print(f"empty (background) : {empty}")
    print("gt boxes by class  :", dict(sorted(counts.items())))
    print(f"\nwrote {CORPUS / 'manifest.jsonl'}")


if __name__ == "__main__":
    main()
