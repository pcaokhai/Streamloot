"""
Sinh icon PNG cho extension bằng THƯ VIỆN CHUẨN.

Môi trường này không có PIL, và thêm một phụ thuộc chỉ để vẽ bốn hình vuông là
không đáng. PNG không nén (mức deflate 0 vẫn là PNG hợp lệ) đủ dùng cho ảnh
128x128.

Hình: nền bo tròn + mũi tên chỉ xuống một vạch ngang, đúng nghĩa "tải xuống"
và khớp ký hiệu ⤓ mà menu bar macOS đang dùng.
"""
import struct
import zlib
from pathlib import Path
from typing import List, Tuple

Pixel = Tuple[int, int, int, int]

#: Xanh dương trùng BADGE_BLUE bên lib/tasks.ts.
BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def render(size: int) -> List[List[Pixel]]:
    """Lưới RGBA của icon ở cỡ `size`."""
    px = [[CLEAR for _ in range(size)] for _ in range(size)]
    radius = size * 0.22
    for y in range(size):
        for x in range(size):
            if _inside_rounded_square(x, y, size, radius):
                px[y][x] = BLUE
    _draw_arrow(px, size)
    return px


def _inside_rounded_square(x: int, y: int, size: int, radius: float) -> bool:
    cx = min(max(x + 0.5, radius), size - radius)
    cy = min(max(y + 0.5, radius), size - radius)
    return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2


def _draw_arrow(px: List[List[Pixel]], size: int) -> None:
    """Mũi tên trắng chỉ xuống, đứng trên một vạch ngang."""
    mid = size // 2
    stem_w = max(1, size // 10)
    top = int(size * 0.24)
    head_y = int(size * 0.56)
    for y in range(top, head_y):
        for x in range(mid - stem_w // 2, mid - stem_w // 2 + stem_w):
            _put(px, x, y, size)
    half = int(size * 0.20)
    for i in range(half + 1):
        y = head_y + i
        for x in range(mid - half + i, mid + half - i + 1):
            _put(px, x, y, size)
    bar_y = int(size * 0.82)
    for y in range(bar_y, bar_y + max(1, size // 12)):
        for x in range(int(size * 0.26), int(size * 0.74)):
            _put(px, x, y, size)


def _put(px: List[List[Pixel]], x: int, y: int, size: int) -> None:
    if 0 <= x < size and 0 <= y < size:
        px[y][x] = WHITE


def write_png(path: Path, size: int) -> None:
    """Ghi icon ra PNG. Không phụ thuộc gói ngoài."""
    px = render(size)
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *p) for p in row) for row in px
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "apps/extension/public/icon"
    for s in (16, 32, 48, 128):
        write_png(out / f"{s}.png", s)
        print(f"viết {out / f'{s}.png'}")
