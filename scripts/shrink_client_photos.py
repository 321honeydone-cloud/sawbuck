#!/usr/bin/env python3
"""Shrink a client's photos into a Small/ subfolder, keeping EXIF dates.

Same job as the shrink-client-photos recipe (50% size, 80% JPG quality, same
filename, Small/ subfolder, originals untouched), with two fixes the photo
loader depends on:

  1. EXIF survives. The old recipe called im.save(...) without exif=, so the
     Small copies (and anything converted from HEIC) lost DateTimeOriginal.
     Files like Sarah's 01.jpg with no date anywhere are exactly what that
     causes. The EXIF block is now carried over on every save, and the
     orientation tag is reset to 1 after exif_transpose so the image is not
     rotated twice.
  2. Optional --rename gives files with no date in the name SawBUCK's own
     name, YYYY-MM-DD_HHMM_##.jpg in Eastern time, taken from EXIF. Only the
     Small copy is renamed. Originals are never touched, and nothing is
     renamed without --rename.

Usage:
  python3 scripts/shrink_client_photos.py "H:/My Drive/1. Clients/Sarah Rohling" [scale] [quality] [--rename] [--heic]

Requires Pillow. HEIC input needs pillow-heif (pip install pillow-heif).
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps

EASTERN = ZoneInfo("America/New_York")
EXIF_DATETIME_ORIGINAL = 0x9003
EXIF_ORIENTATION = 0x0112


def exif_taken_at(im):
    """DateTimeOriginal from EXIF as an aware Eastern datetime, or None."""
    try:
        exif = im.getexif()
        raw = exif.get_ifd(0x8769).get(EXIF_DATETIME_ORIGINAL) or exif.get(0x0132)
    except Exception:
        return None
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw)[:19], "%Y:%m:%d %H:%M:%S").replace(tzinfo=EASTERN)
    except ValueError:
        return None


def sawbuck_name(taken_at, index, ext="jpg"):
    return f"{taken_at.strftime('%Y-%m-%d_%H%M')}_{index:02d}.{ext}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if not args:
        print(__doc__)
        sys.exit(1)
    src = args[0]
    scale = float(args[1]) if len(args) > 1 else 0.5
    quality = int(args[2]) if len(args) > 2 else 80
    rename = "--rename" in flags
    if "--heic" in flags:
        try:
            import pillow_heif  # type: ignore

            pillow_heif.register_heif_opener()
        except ImportError:
            print("pillow-heif is not installed; HEIC files will be skipped")

    out = os.path.join(src, "Small")
    os.makedirs(out, exist_ok=True)
    done, skipped, undated = [], [], []
    exts = (".jpg", ".jpeg") + ((".heic", ".heif") if "--heic" in flags else ())
    index = 0
    for name in sorted(os.listdir(src)):
        if not name.lower().endswith(exts):
            continue
        path = os.path.join(src, name)
        if not os.path.isfile(path):
            continue
        with Image.open(path) as opened:
            exif = opened.getexif()
            taken = exif_taken_at(opened)
            im = ImageOps.exif_transpose(opened).convert("RGB")
        # exif_transpose already applied the rotation; reset the tag so viewers do not rotate again.
        if EXIF_ORIENTATION in exif:
            exif[EXIF_ORIENTATION] = 1
        base, _ = os.path.splitext(name)
        dst_name = base + ".jpg"
        if rename and taken is not None and not base[:4].isdigit():
            index += 1
            dst_name = sawbuck_name(taken, index)
        if taken is None:
            undated.append(name)
        dst = os.path.join(out, dst_name)
        if os.path.exists(dst):
            skipped.append(name)
            continue
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        # THE fix: keep the EXIF block so DateTimeOriginal survives the shrink.
        im.save(dst, "JPEG", quality=quality, optimize=True, exif=exif.tobytes())
        done.append((name, dst_name, os.path.getsize(path), os.path.getsize(dst)))

    for n, d, a, b in done:
        arrow = "" if n == d else f" -> {d}"
        print(f"{n}{arrow}: {a / 1e6:.1f} MB -> {b / 1e3:.0f} KB")
    print(f"resized {len(done)}, skipped {len(skipped)} already in Small")
    if undated:
        print(f"no EXIF date (photo loader will mark these LOW): {', '.join(undated)}")


if __name__ == "__main__":
    main()
