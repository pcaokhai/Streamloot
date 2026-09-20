import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.sites import site_folder, FALLBACK


class TestSiteFolder(unittest.TestCase):
    """Mỗi site một thư mục con; trước đây mọi video đổ chung một chỗ."""

    def test_plain_host(self):
        self.assertEqual(site_folder("https://vidu.com/watch/1"), "vidu")

    def test_strips_www(self):
        self.assertEqual(site_folder("https://www.vidu.com/x"), "vidu")

    def test_mobile_and_www_map_to_the_same_folder(self):
        """`m.` và `www.` là cùng một site — tách ra là chia đôi thư mục vô cớ."""
        self.assertEqual(site_folder("https://m.vidu.com/x"), site_folder("https://www.vidu.com/x"))

    def test_multi_level_domain(self):
        self.assertEqual(site_folder("https://play.vidu.co.uk/x"), "play")

    def test_keeps_hyphen_and_digits(self):
        self.assertEqual(site_folder("https://vi-du2.com/x"), "vi-du2")

    def test_strips_unsafe_characters(self):
        self.assertEqual(site_folder("https://ví-dụ.com/x"), "v-d")

    def test_never_returns_empty(self):
        """Tên rỗng sẽ đổ file vào thư mục gốc, lẫn với mọi lượt tải khác."""
        for bad in ("", "khong-phai-url", "file:///tmp/a.mp4", "://"):
            self.assertTrue(site_folder(bad))

    def test_unparseable_uses_fallback(self):
        self.assertEqual(site_folder("khong-phai-url"), FALLBACK)

    def test_host_made_only_of_noise_still_returns_something(self):
        self.assertTrue(site_folder("https://www/x"))

    def test_ip_address_host(self):
        self.assertEqual(site_folder("http://127.0.0.1:8000/x"), "127")


if __name__ == "__main__":
    unittest.main()
