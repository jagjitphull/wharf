#!/usr/bin/env python3
"""Regenerates resources/icons/*.png, resources/icon.ico and resources/icon.icns
from resources/src/icon.svg. Run after editing the master SVG.

Requires: pip install cairosvg"""
import os
import struct

import cairosvg

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "src", "icon.svg")
ICONS_DIR = os.path.join(HERE, "icons")

# electron-builder's Linux target wants a directory of size-named PNGs.
LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def render(size: int) -> bytes:
    return cairosvg.svg2png(url=SVG, output_width=size, output_height=size)


def write_linux_set():
    os.makedirs(ICONS_DIR, exist_ok=True)
    for size in LINUX_SIZES:
        path = os.path.join(ICONS_DIR, f"{size}x{size}.png")
        with open(path, "wb") as f:
            f.write(render(size))
        print(f"wrote {path}")
    # electron-builder's default single-file fallback (mac/win DMG artwork,
    # README/store listings) — same 1024 master, just also at the flat path.
    with open(os.path.join(HERE, "icon.png"), "wb") as f:
        f.write(render(1024))


def write_ico():
    # Hand-rolled instead of Pillow's ICO writer: passing already-distinct
    # per-size renders via append_images silently collapses to a single
    # 16x16 entry (Pillow expects to generate the other sizes itself by
    # resizing the base image). PNG-compressed ICO entries (BITMAPINFOHEADER
    # size left at 0, data is a full PNG) have been valid since Vista, so
    # each entry below is just our own crisp per-size PNG render.
    pngs = [render(s) for s in ICO_SIZES]
    count = len(ICO_SIZES)
    header = struct.pack("<HHH", 0, 1, count)
    dir_entries = b""
    image_data = b""
    offset = 6 + 16 * count
    for size, png in zip(ICO_SIZES, pngs):
        wh = size if size < 256 else 0  # 0 means 256 per the ICO spec
        dir_entries += struct.pack("<BBBBHHII", wh, wh, 0, 0, 1, 32, len(png), offset)
        image_data += png
        offset += len(png)
    with open(os.path.join(HERE, "icon.ico"), "wb") as f:
        f.write(header + dir_entries + image_data)
    print(f"wrote {os.path.join(HERE, 'icon.ico')}")


def write_icns():
    # Minimal hand-rolled ICNS writer: png-backed OSType chunks (ic07..ic10 +
    # 16/32/128/256 legacy PNG-backed types), no external icnsutils needed.
    type_for_size = {
        16: b"icp4",
        32: b"icp5",
        64: b"icp6",
        128: b"ic07",
        256: b"ic08",
        512: b"ic09",
        1024: b"ic10",
    }
    entries = []
    for size in ICNS_SIZES:
        png = render(size)
        ostype = type_for_size[size]
        entries.append((ostype, png))

    body = b"".join(ostype + struct.pack(">I", len(png) + 8) + png for ostype, png in entries)
    total_len = 8 + len(body)
    header = b"icns" + struct.pack(">I", total_len)
    with open(os.path.join(HERE, "icon.icns"), "wb") as f:
        f.write(header + body)
    print(f"wrote {os.path.join(HERE, 'icon.icns')}")


if __name__ == "__main__":
    write_linux_set()
    write_ico()
    write_icns()
