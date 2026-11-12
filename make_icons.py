"""Draw the app icon (sound-wave bars, blue -> orange) as PNGs with no extra libraries."""
import struct
import zlib
from pathlib import Path

BARS = [0.30, 0.55, 0.85, 0.45, 0.95, 0.60, 0.35]   # bar heights (fraction of icon)
BG, BLUE, ORANGE = (15, 23, 42), (56, 189, 248), (251, 146, 60)


def pixel(x, y, n):
    u, v = x / n, y / n
    # bars live in the middle 64% so the icon survives Android "maskable" cropping
    left, width = 0.18, 0.64
    if left <= u < left + width:
        slot = (u - left) / width * len(BARS)
        i, frac = int(slot), slot - int(slot)
        h = BARS[i] * 0.62
        cy = 0.5
        if 0.18 < frac < 0.82 and abs(v - cy) <= h / 2:
            t = i / (len(BARS) - 1)
            return tuple(round(BLUE[k] * (1 - t) + ORANGE[k] * t) for k in range(3))
    return BG


def png(n, path):
    rows = b"".join(b"\x00" + bytes(c for x in range(n) for c in pixel(x, y, n)) for y in range(n))
    chunk = lambda tag, data: struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


out = Path(__file__).parent / "icons"
out.mkdir(exist_ok=True)
for size in (180, 192, 512):
    png(size, out / f"icon-{size}.png")
print("icons written")
