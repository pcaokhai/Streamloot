import asyncio
import glob
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("API_KEY", "test-key")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.api import main as api_main

MPD = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>'


class FakeBackgroundTasks:
    def __init__(self):
        self.added = []

    def add_task(self, fn, *a, **kw):
        self.added.append((fn, a, kw))


def call(req, bg):
    return asyncio.run(api_main.start_manifest_download(req, bg))


class TestManifestDownload(unittest.TestCase):
    """
    Có site nhúng MPD thẳng vào HTML và không phục vụ nó qua URL nào, nên backend
    không thể tự tải lại — client phải gửi nguyên văn XML sang.
    """

    def setUp(self):
        self.p_create = patch.object(api_main.history, "create_task")
        self.p_token = patch.object(api_main, "issue_stream_token", return_value="tok")
        self.create = self.p_create.start()
        self.p_token.start()

    def tearDown(self):
        self.p_create.stop()
        self.p_token.stop()
        for f in glob.glob(f"{tempfile.gettempdir()}/streamloot-mpd-*"):
            os.remove(f)

    def _req(self, **kw):
        base = dict(manifest_xml=MPD, title="Clip", page_url="https://site.test/p/1")
        base.update(kw)
        return api_main.ManifestDownloadRequest(**base)

    def test_writes_manifest_and_points_ytdlp_at_it(self):
        bg = FakeBackgroundTasks()
        call(self._req(), bg)
        fn, args, _ = bg.added[0]
        prepared, mpd_path = args[1], args[2]
        self.assertTrue(os.path.exists(mpd_path))
        self.assertEqual(Path(mpd_path).read_text(), MPD)
        self.assertEqual(prepared.video_info.m3u8_url, f"file://{mpd_path}")

    def test_enables_file_urls_only_for_this_call(self):
        """Cờ này cho yt-dlp đọc file cục bộ — không bao giờ dùng với đường dẫn từ client."""
        bg = FakeBackgroundTasks()
        call(self._req(), bg)
        prepared = bg.added[0][1][1]
        self.assertIn("--enable-file-urls", prepared.video_info.extra_ytdlp_args)

    def test_passes_format_selector_through(self):
        bg = FakeBackgroundTasks()
        call(self._req(format_id="bv*[height=1200]+ba"), bg)
        self.assertEqual(bg.added[0][1][1].format_id, "bv*[height=1200]+ba")

    def test_records_task_as_extension_source(self):
        """Sai nguồn thì lượt tải biến mất khỏi tab Lịch sử của extension."""
        call(self._req(), FakeBackgroundTasks())
        self.assertEqual(self.create.call_args.kwargs.get("source"), "extension")

    def test_rejects_non_xml(self):
        with self.assertRaises(api_main.HTTPException) as e:
            call(self._req(manifest_xml='{"khong":"phai xml"}'), FakeBackgroundTasks())
        self.assertEqual(e.exception.status_code, 400)

    def test_rejects_oversized_manifest(self):
        big = "<" + "x" * (api_main.MAX_MANIFEST_BYTES + 1)
        with self.assertRaises(api_main.HTTPException) as e:
            call(self._req(manifest_xml=big), FakeBackgroundTasks())
        self.assertEqual(e.exception.status_code, 413)

    def test_no_temp_file_left_when_rejected(self):
        before = set(glob.glob(f"{tempfile.gettempdir()}/streamloot-mpd-*"))
        with self.assertRaises(api_main.HTTPException):
            call(self._req(manifest_xml="khong phai xml"), FakeBackgroundTasks())
        self.assertEqual(set(glob.glob(f"{tempfile.gettempdir()}/streamloot-mpd-*")), before)

    def test_temp_file_removed_after_the_task_runs(self):
        bg = FakeBackgroundTasks()
        call(self._req(), bg)
        fn, args, _ = bg.added[0]
        with patch.object(api_main, "run_prepared_task"):
            fn(*args)
        self.assertFalse(os.path.exists(args[2]))

    def test_temp_file_removed_even_when_the_task_fails(self):
        """Tải hỏng mà để lại file là rác tích dần trong /tmp."""
        bg = FakeBackgroundTasks()
        call(self._req(), bg)
        fn, args, _ = bg.added[0]
        with patch.object(api_main, "run_prepared_task", side_effect=RuntimeError("hỏng")):
            with self.assertRaises(RuntimeError):
                fn(*args)
        self.assertFalse(os.path.exists(args[2]))


if __name__ == "__main__":
    unittest.main()
