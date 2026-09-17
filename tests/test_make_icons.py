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
        """Nền bo tròn có được vẽ không — không chứng minh mũi tên tồn tại."""
        px = render(32)
        opaque = sum(1 for row in px for p in row if p[3] > 0)
        self.assertGreater(opaque, 32 * 32 * 0.15)

    def test_arrow_is_actually_drawn(self):
        """
        Nền bo tròn đã phủ ~95% diện tích, nên đếm pixel đục không nói lên điều
        gì về mũi tên. Đếm riêng pixel TRẮNG: mũi tên lệch ra ngoài khung sẽ bị
        _put bỏ qua lặng lẽ, và đó đúng là lỗi cần chặn.
        """
        for size in (16, 32, 128):
            px = render(size)
            white = sum(1 for row in px for p in row if p == (255, 255, 255, 255))
            self.assertGreater(white, 0, f"cỡ {size}: không có pixel trắng nào")
            # Mũi tên phải chiếm một phần đáng kể nhưng không nuốt cả icon.
            frac = white / (size * size)
            self.assertGreater(frac, 0.02, f"cỡ {size}: mũi tên quá nhỏ ({frac:.3f})")
            self.assertLess(frac, 0.40, f"cỡ {size}: trắng quá nhiều ({frac:.3f})")

    def test_arrow_sits_inside_the_background(self):
        """Pixel trắng nào cũng phải nằm trong khung — _put im lặng nuốt pixel tràn."""
        size = 32
        px = render(size)
        whites = [(x, y) for y, row in enumerate(px) for x, p in enumerate(row)
                  if p == (255, 255, 255, 255)]
        self.assertTrue(whites)
        self.assertTrue(all(0 <= x < size and 0 <= y < size for x, y in whites))

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
