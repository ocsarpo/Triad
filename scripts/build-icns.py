#!/usr/bin/env python3
import io
import struct
import sys
from pathlib import Path

from PIL import Image


PNG_CHUNKS = [
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
]

LEGACY_CHUNKS = [
    (b"is32", b"s8mk", 16),
    (b"il32", b"l8mk", 32),
]


def png_data(source: Image.Image, size: int) -> bytes:
    image = source.resize((size, size), Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    image.save(stream, format="PNG", optimize=True)
    return stream.getvalue()


def pack_channel(data: bytes) -> bytes:
    packed = bytearray()
    for offset in range(0, len(data), 128):
        block = data[offset:offset + 128]
        packed.append(len(block) - 1)
        packed.extend(block)
    return bytes(packed)


def legacy_rgb_data(image: Image.Image) -> bytes:
    return b"".join(pack_channel(image.getchannel(channel).tobytes()) for channel in "RGB")


def build(source_path: Path, output_path: Path) -> None:
    source = Image.open(source_path).convert("RGBA")
    images = {size: png_data(source, size) for _, size in PNG_CHUNKS}
    entries = [(kind, images[size]) for kind, size in PNG_CHUNKS]
    for rgb_kind, alpha_kind, size in LEGACY_CHUNKS:
        image = source.resize((size, size), Image.Resampling.LANCZOS)
        entries.append((rgb_kind, legacy_rgb_data(image)))
        entries.append((alpha_kind, image.getchannel("A").tobytes()))
    toc_length = 8 + 8 * len(entries)
    total_length = 8 + toc_length + sum(8 + len(data) for _, data in entries)

    with output_path.open("wb") as output:
        output.write(b"icns")
        output.write(struct.pack(">I", total_length))
        output.write(b"TOC ")
        output.write(struct.pack(">I", toc_length))
        for kind, data in entries:
            output.write(kind)
            output.write(struct.pack(">I", 8 + len(data)))
        for kind, data in entries:
            output.write(kind)
            output.write(struct.pack(">I", 8 + len(data)))
            output.write(data)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-icns.py INPUT.png OUTPUT.icns")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
