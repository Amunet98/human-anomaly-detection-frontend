#!/usr/bin/env python3
"""Stage a YOLO-format dataset into the manifest shape feature-dump.mjs reads.

Two source profiles, selected with --dataset:

  fallsdata2  the 2023 Roboflow export. Default, and the original reason this
              script exists. Deduplicated: the export applies ~2.4x augmentation
              to the train split, so 11,214 image files collapse to 4,924
              distinct sources once the `_jpg.rf.<hash>` suffix is stripped.
              Sampling fixtures or measuring feature distributions over the raw
              export would weight augmented frames 3x and inflate any number
              taken from it - the same mistake that made the 2023 model's 88%
              look like a result.

  polar       the POLAR posture dataset, added 2026-08-12 to fix a 22:1 class
              imbalance: the 2023 corpus holds 1,970 `fall` boxes against 89
              `sit` and 170 `squat`, which is not enough to train on. POLAR
              supplies 5,101 sit / 4,253 squat / 4,656 stand.

Both write one representative image per stem plus a `manifest.jsonl` whose rows
carry absolute pixel boxes, so feature-dump.mjs treats them identically.

Reads from the source, writes to the corpus dir. Never writes to the source.

Usage:  python3 build-corpus.py [--dataset NAME] [--src PATH] [--limit N]
                                [--per-class N]
"""

import argparse
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
# scripts/calibration -> frontend-new -> repo root
ROOT = HERE.parents[2]

# --- source profiles --------------------------------------------------------
#
# `classes` maps the dataset's own class ids to this system's vocabulary
# (CLASS_NAMES in constants.js). Ids absent from the map are dropped, and an
# image left with no boxes at all is not staged - POLAR carries six categories
# this project has no use for, and copying 21k images of people walking and
# jumping to ignore them later is waste.
#
# **The ids come from each dataset's own dataset.yaml, not from its README.**
# POLAR's README lists the nine classes alphabetically, which does not match the
# file's actual indices - following it would have labelled walk/jump/bendover as
# sit/squat/stand and silently poisoned the training set.
DATASETS = {
    "fallsdata2": {
        "src": Path("/run/media/amunet/BP/FY_project/datasets/fallsdata2.v1i.yolov8"),
        "out": ROOT / "corpus-2023",
        # data.yaml: names: ['falls', 'sits', 'squats', 'stands']
        #
        # `squat` is kept as the dataset's own name for class 2 but is NOT
        # trustworthy - class 2 is in practice "crouching bystander at an
        # accident scene", and in those images the genuinely fallen person is
        # frequently left unlabelled. Treat any class-2 row as a candidate to
        # hand-verify, never as ground truth.
        "classes": {0: "fall", 1: "sit", 2: "squat", 3: "stand"},
        "splits": ("train", "valid", "test"),
        # <split>/images/<name>.jpg, <split>/labels/<name>.txt
        "layout": "split_first",
        # Every image is 640x640 in this export (verified across a 400-image
        # sample), which happens to match INPUT_SIZE exactly. Hardcoding avoids
        # opening 11k files just to read a header.
        "size": (640, 640),
        "stem_re": re.compile(r"_jpg\.rf\..*$"),
    },
    "polar": {
        "src": Path("/home/amunet/Pictures/POLAR"),
        "out": ROOT / "corpus-polar",
        # dataset.yaml: 0 squat, 1 run, 2 sit, 3 stretch, 4 walk, 5 jump,
        #               6 bendover, 7 stand, 8 lying
        #
        # Only the three classes this project is short of. `lying` (8) is
        # deliberately excluded rather than mapped to `fall`: it is a posture,
        # not an event, and conflating the two is the exact labelling error that
        # makes the 2023 corpus's `fall` class unreliable. Stage it separately
        # if you want it as a cross-check.
        "classes": {0: "squat", 2: "sit", 7: "stand"},
        "splits": ("train", "val", "test"),
        # images/<split>/<name>.jpg, labels/<split>/<name>.txt
        "layout": "images_first",
        # Variable: 339x509, 506x338, 594x396 ... read per image.
        "size": None,
        # Filenames are already unique (p1_00001.jpg); no augmentation to fold.
        "stem_re": None,
    },
}


# Roboflow exports omit the trailing newline, so a naive `cat *.txt` glues the
# last line of one file onto the first of the next. Parse per file.
def read_label(path: Path, width: int, height: int, classes: dict):
    boxes = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        cid = int(parts[0])
        if cid not in classes:
            continue  # a category this project has no use for
        cx, cy, w, h = (float(v) for v in parts[1:5])
        boxes.append(
            {
                "cls": classes[cid],
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


def collect(src: Path, splits, layout: str, stem_re):
    """Group source images by stem, one entry per (split, path)."""
    stems = defaultdict(list)
    for split in splits:
        if layout == "split_first":
            img_dir, lbl_dir = src / split / "images", src / split / "labels"
        else:
            img_dir, lbl_dir = src / "images" / split, src / "labels" / split
        if not img_dir.is_dir():
            continue
        for img in sorted(img_dir.glob("*.jpg")):
            stem = stem_re.sub("", img.name) if stem_re else img.name
            stems[stem].append((split, img, lbl_dir / (img.stem + ".txt")))
    return stems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=sorted(DATASETS), default="fallsdata2")
    ap.add_argument("--src", type=Path, help="override the profile's source path")
    ap.add_argument("--limit", type=int, default=0, help="cap images (smoke test)")
    ap.add_argument(
        "--per-class",
        type=int,
        default=0,
        help="cap boxes per class; images left with none are skipped. "
        "Use it to match a smaller class rather than subsampling later.",
    )
    args = ap.parse_args()

    cfg = DATASETS[args.dataset]
    src = args.src or cfg["src"]
    corpus = cfg["out"]
    classes = cfg["classes"]

    if not src.exists():
        hint = "\nIs the BP drive mounted?" if args.dataset == "fallsdata2" else ""
        sys.exit(f"Source not found: {src}{hint}")

    size = cfg["size"]
    if size is None:
        try:
            from PIL import Image
        except ImportError:
            sys.exit(
                f"{args.dataset} has variable image sizes and needs Pillow to read "
                "them.\n  pip install Pillow"
            )

    stems = collect(src, cfg["splits"], cfg["layout"], cfg["stem_re"])
    out_img = corpus / "images"
    out_img.mkdir(parents=True, exist_ok=True)

    manifest = []
    skipped_nolabel = 0
    skipped_nowanted = 0
    per_class = defaultdict(int)

    for stem in sorted(stems):
        split, img, label = sorted(stems[stem])[0]  # deterministic representative
        if not label.exists():
            skipped_nolabel += 1
            continue

        if size is not None:
            width, height = size
        else:
            with Image.open(img) as im:
                width, height = im.size

        boxes = read_label(label, width, height, classes)

        # Per-class cap. Applied after reading so the cap counts boxes, not
        # files - an image with two sits contributes two.
        if args.per_class:
            boxes = [b for b in boxes if per_class[b["cls"]] < args.per_class]

        # An image whose every box was dropped carries no signal this project
        # can use, so it is not copied. For fallsdata2 the map covers all four
        # classes and nothing is dropped, preserving the original behaviour
        # including genuinely empty background frames.
        if not boxes and classes.keys() != {0, 1, 2, 3}:
            skipped_nowanted += 1
            continue

        for b in boxes:
            per_class[b["cls"]] += 1

        dest = out_img / (stem if stem.endswith(".jpg") else f"{stem}.jpg")
        if not dest.exists():
            shutil.copy2(img, dest)
        manifest.append(
            {
                "stem": dest.stem,
                "file": dest.name,
                "split": split,
                "width": width,
                "height": height,
                "source": f"{args.dataset}:{img.relative_to(src)}",
                "gt": boxes,
            }
        )
        if args.limit and len(manifest) >= args.limit:
            break

    (corpus / "manifest.jsonl").write_text(
        "".join(json.dumps(m) + "\n" for m in manifest)
    )

    counts = defaultdict(int)
    empty = 0
    for m in manifest:
        if not m["gt"]:
            empty += 1
        for b in m["gt"]:
            counts[b["cls"]] += 1

    print(f"dataset            : {args.dataset}")
    print(f"source             : {src}")
    print(f"unique stems       : {len(stems)}")
    print(f"staged images      : {len(manifest)}")
    print(f"no label file      : {skipped_nolabel}")
    if skipped_nowanted:
        print(f"no wanted class    : {skipped_nowanted}")
    print(f"empty (background) : {empty}")
    print("gt boxes by class  :", dict(sorted(counts.items())))
    print(f"\nwrote {corpus / 'manifest.jsonl'}")


if __name__ == "__main__":
    main()
