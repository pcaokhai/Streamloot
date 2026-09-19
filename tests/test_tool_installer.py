import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services import tool_installer as ti


class FakeResponse:
    def __init__(self, body: bytes, length: int = None):
        self._body = body
        self._at = 0
        self.headers = {"Content-Length": str(length if length is not None else len(body))}

    def read(self, n):
        chunk = self._body[self._at:self._at + n]
        self._at += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestInstallBinary(unittest.TestCase):
    """
    Cài NGUYÊN TỬ: hỏng nửa chừng không được để lại file cụt mà lần sau tưởng
    là đã cài — đó là loại lỗi im lặng đắt nhất.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.p = patch.object(ti.tools, "tools_dir", return_value=self.dir)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def _ok_run(self, *a, **kw):
        return subprocess.CompletedProcess(a, 0, stdout="2026.01.01", stderr="")

    def test_installs_and_makes_executable(self):
        with patch.object(ti.urllib.request, "urlopen", return_value=FakeResponse(b"#!/bin/sh\n")), \
             patch.object(ti.subprocess, "run", side_effect=self._ok_run):
            path = ti.install("yt-dlp")
        self.assertTrue(Path(path).exists())
        self.assertTrue(os.access(path, os.X_OK))

    def test_reports_progress(self):
        seen = []
        with patch.object(ti.urllib.request, "urlopen", return_value=FakeResponse(b"x" * 600000)), \
             patch.object(ti.subprocess, "run", side_effect=self._ok_run):
            ti.install("yt-dlp", progress=lambda d, t, l: seen.append((d, t, l)))
        self.assertGreater(len(seen), 1)
        self.assertEqual(seen[-1][0], 600000)
        self.assertEqual(seen[0][2], "yt-dlp")

    def test_binary_that_does_not_run_is_not_installed(self):
        bad = subprocess.CompletedProcess([], 1, stdout="", stderr="killed")
        with patch.object(ti.urllib.request, "urlopen", return_value=FakeResponse(b"rac")), \
             patch.object(ti.subprocess, "run", return_value=bad):
            with self.assertRaises(RuntimeError):
                ti.install("yt-dlp")
        self.assertEqual(list(self.dir.iterdir()), [], "để lại file cụt")

    def test_wrong_architecture_is_rejected(self):
        """Đã gặp thật một lần: ffmpeg sai kiến trúc, app vẫn chạy, chỉ chết trên máy khác."""
        def fake_run(cmd, *a, **kw):
            if cmd[0] == "lipo":
                return subprocess.CompletedProcess(cmd, 0, stdout="x86_64", stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

        with patch.object(ti.urllib.request, "urlopen", return_value=FakeResponse(b"bin")), \
             patch.object(ti.platform, "machine", return_value="arm64"), \
             patch.object(ti.subprocess, "run", side_effect=fake_run):
            with self.assertRaises(RuntimeError) as e:
                ti.install("ffmpeg")
        self.assertIn("arm64", str(e.exception))
        self.assertEqual(list(self.dir.iterdir()), [])

    def test_missing_lipo_does_not_block_install(self):
        """Không có lipo thì bỏ qua phép kiểm, không phải lý do để chặn."""
        def fake_run(cmd, *a, **kw):
            if cmd[0] == "lipo":
                raise OSError("khong co lipo")
            return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

        with patch.object(ti.urllib.request, "urlopen", return_value=FakeResponse(b"bin")), \
             patch.object(ti.subprocess, "run", side_effect=fake_run):
            path = ti.install("ffmpeg")
        self.assertTrue(Path(path).exists())

    def test_network_failure_leaves_nothing_behind(self):
        with patch.object(ti.urllib.request, "urlopen", side_effect=OSError("mat mang")):
            with self.assertRaises(OSError):
                ti.install("yt-dlp")
        self.assertEqual(list(self.dir.iterdir()), [])

    def test_unknown_tool_is_rejected(self):
        with self.assertRaises(ValueError):
            ti.install("khong-ton-tai")

    def test_ffmpeg_url_matches_machine(self):
        with patch.object(ti.tools, "ffmpeg_asset", return_value="ffmpeg-darwin-arm64"):
            self.assertIn("ffmpeg-darwin-arm64", ti.FFMPEG_URL.format(asset=ti.tools.ffmpeg_asset()))


if __name__ == "__main__":
    unittest.main()
