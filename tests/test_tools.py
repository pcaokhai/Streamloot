import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils import tools


class TestFfmpegAsset(unittest.TestCase):
    """Tải nhầm kiến trúc là lỗi thầm lặng — app chạy, chỉ chết trên máy người dùng."""

    def test_apple_silicon(self):
        self.assertEqual(tools.ffmpeg_asset("arm64"), "ffmpeg-darwin-arm64")

    def test_aarch64_alias(self):
        self.assertEqual(tools.ffmpeg_asset("aarch64"), "ffmpeg-darwin-arm64")

    def test_intel(self):
        self.assertEqual(tools.ffmpeg_asset("x86_64"), "ffmpeg-darwin-x64")

    def test_unknown_falls_back_to_intel_not_crash(self):
        self.assertEqual(tools.ffmpeg_asset("mips"), "ffmpeg-darwin-x64")


class TestToolsDirLocation(unittest.TestCase):
    """
    Thư mục công cụ phải nằm NGOÀI repo, kể cả khi chạy từ source.

    Bản đầu dùng paths.user_data_dir(), mà hàm đó trả về gốc repo khi chạy từ
    source — cài Chromium từ bản dev là nhét ~400MB vào dự án, và tải trùng một
    lần nữa bản mà .app đã có.
    """

    def test_outside_the_repo(self):
        repo = Path(__file__).resolve().parent.parent
        self.assertNotIn(repo, tools.tools_dir().parents)

    def test_same_place_for_dev_and_app(self):
        """Bản dev và bản .app phải dùng chung, nếu không là tải hai lần."""
        expected = Path.home() / "Library" / "Application Support" / "Streamloot" / "tools"
        self.assertEqual(tools.tools_dir(), expected)

    def test_on_path_after_ensure(self):
        """Cài xong mà PATH không thấy thì coi như chưa cài."""
        import os
        from utils import paths
        paths.ensure_tool_path()
        self.assertIn(str(tools.tools_dir()), os.environ["PATH"])


class TestFind(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "tools").mkdir()
        (self.root / "bin").mkdir()
        self.p_tools = patch.object(tools, "tools_dir", return_value=self.root / "tools")
        self.p_bin = patch.object(tools.paths, "bundled_bin_dir", return_value=self.root / "bin")
        self.p_chrome = patch.object(tools.paths, "bundled_chrome_path", return_value=None)
        for p in (self.p_tools, self.p_bin, self.p_chrome):
            p.start()

    def tearDown(self):
        for p in (self.p_tools, self.p_bin, self.p_chrome):
            p.stop()
        self.tmp.cleanup()

    def _make(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/bin/sh\n")
        os.chmod(path, 0o755)

    def test_missing_everywhere(self):
        with patch.object(tools.shutil, "which", return_value=None):
            s = tools.find("yt-dlp")
        self.assertFalse(s.found)
        self.assertIsNone(s.source)

    def test_finds_system_when_nothing_else(self):
        with patch.object(tools.shutil, "which", return_value="/usr/local/bin/yt-dlp"):
            s = tools.find("yt-dlp")
        self.assertEqual(s.source, "system")

    def test_downloaded_beats_system(self):
        """Bản ta tải là bản ta biết phiên bản; bản hệ thống thì không."""
        self._make(self.root / "tools" / "yt-dlp")
        with patch.object(tools.shutil, "which", return_value="/usr/local/bin/yt-dlp"):
            s = tools.find("yt-dlp")
        self.assertEqual(s.source, "downloaded")

    def test_bundled_beats_downloaded(self):
        self._make(self.root / "bin" / "yt-dlp")
        self._make(self.root / "tools" / "yt-dlp")
        s = tools.find("yt-dlp")
        self.assertEqual(s.source, "bundled")

    def test_non_executable_file_is_not_a_tool(self):
        """File tải dở dang còn nguyên quyền mặc định — coi nó là đã cài thì hỏng lúc tải video."""
        p = self.root / "tools" / "ffmpeg"
        p.write_text("noi dung do dang")
        os.chmod(p, 0o644)
        with patch.object(tools.shutil, "which", return_value=None):
            self.assertFalse(tools.find("ffmpeg").found)

    def test_chromium_is_optional_the_others_required(self):
        with patch.object(tools.shutil, "which", return_value=None):
            self.assertTrue(tools.find("yt-dlp").required)
            self.assertTrue(tools.find("ffmpeg").required)
            self.assertFalse(tools.find("chromium").required)

    def test_missing_required_excludes_chromium(self):
        """Thiếu Chromium KHÔNG được chặn app — nó chỉ phục vụ một đường."""
        with patch.object(tools.shutil, "which", return_value=None):
            st = tools.status_all()
        self.assertEqual(sorted(tools.missing_required(st)), ["ffmpeg", "yt-dlp"])
        self.assertEqual(tools.missing_optional(st), ["chromium"])

    def test_as_dict_shape(self):
        with patch.object(tools.shutil, "which", return_value=None):
            d = tools.as_dict()
        self.assertEqual(sorted(d.keys()), ["chromium", "ffmpeg", "yt-dlp"])
        self.assertEqual(sorted(d["yt-dlp"].keys()), ["found", "required", "source"])


if __name__ == "__main__":
    unittest.main()
