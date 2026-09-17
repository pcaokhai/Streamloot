import struct
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "packaging"))

from make_icons import render, write_png

PNG_SIG = b"\x89PNG\r\n\x1a\n"


class TestMakeIcons(unittest.TestCase):
    def test_render_gives_a_square_rgba_grid(self):
        px = render(16)
        self.assertEqual(len(px), 16)
        self.assertEqual(len(px[0]), 16)
        self.assertEqual(len(px[0][0]), 4)

    def test_icon_has_visible_pixels(self):
        """Icon toàn trong suốt là icon không tồn tại — Chrome hiện mảnh ghép."""
        px = render(32)
        opaque = sum(1 for row in px for p in row if p[3] > 0)
        self.assertGreater(opaque, 32 * 32 * 0.15)

    def test_writes_a_valid_png_with_right_dimensions(self):
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            path = Path(f.name)
        write_png(path, 48)
        raw = path.read_bytes()
        self.assertTrue(raw.startswith(PNG_SIG))
        # IHDR: 8 byte chữ ký + 4 byte độ dài + 4 byte 'IHDR' + rộng + cao
        width, height = struct.unpack(">II", raw[16:24])
        self.assertEqual((width, height), (48, 48))
        path.unlink()


if __name__ == "__main__":
    unittest.main()
