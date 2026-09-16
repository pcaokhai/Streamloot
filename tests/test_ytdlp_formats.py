import json
import subprocess
import unittest
from unittest.mock import patch, MagicMock
from downloaders.ytdlp import YtDlpDownloader
from core.models import VideoInfo

def _video_info(**overrides):
    defaults = dict(
        title="Test Video",
        m3u8_url="https://example.com/stream.m3u8",
        page_url="https://example.com/watch",
    )
    defaults.update(overrides)
    return VideoInfo(**defaults)

FIXTURE_JSON = json.dumps({
    "format_id": "137+140",
    "formats": [
        {"format_id": "140", "ext": "m4a", "height": None, "filesize": 1000, "vcodec": "none", "acodec": "aac"},
        {"format_id": "137", "ext": "mp4", "height": 1080, "resolution": "1920x1080", "filesize_approx": 50000, "vcodec": "avc1", "acodec": "none"},
        {"format_id": "134", "ext": "mp4", "height": 360, "filesize": 5000, "vcodec": "avc1", "acodec": "none"},
    ],
})

class TestBuildHeaders(unittest.TestCase):
    def test_default_user_agent_when_none_set(self):
        args = YtDlpDownloader._build_headers(_video_info())
        self.assertIn("--user-agent", args)
        self.assertNotIn("--add-header", args)

    def test_custom_user_agent_and_cookie_referer_origin(self):
        vi = _video_info(user_agent="CustomUA", cookies="a=b", referer="https://ref", origin="https://orig")
        args = YtDlpDownloader._build_headers(vi)
        self.assertIn("CustomUA", args)
        self.assertIn("Cookie: a=b", args)
        self.assertIn("Referer: https://ref", args)
        self.assertIn("Origin: https://orig", args)

class TestListFormats(unittest.TestCase):
    def test_raises_without_m3u8_url(self):
        vi = _video_info(m3u8_url="")
        with self.assertRaises(ValueError):
            YtDlpDownloader().list_formats(vi)

    def test_parses_formats_and_flags_recommended(self):
        mock_result = MagicMock(returncode=0, stdout=FIXTURE_JSON, stderr="")
        with patch("subprocess.run", return_value=mock_result) as mock_run:
            formats = YtDlpDownloader().list_formats(_video_info())

        self.assertEqual(len(formats), 3)
        # Top-level format_id is "137+140" (merged video+audio pick) —
        # both components should be flagged, the unrelated 360p track shouldn't.
        recommended_ids = {f["format_id"] for f in formats if f["recommended"]}
        self.assertEqual(recommended_ids, {"137", "140"})
        self.assertFalse(next(f for f in formats if f["format_id"] == "134")["recommended"])
        best = next(f for f in formats if f["format_id"] == "137")
        self.assertEqual(best["resolution"], "1920x1080")
        self.assertEqual(best["height"], 1080)
        mock_run.assert_called_once()
        self.assertEqual(mock_run.call_args.kwargs.get("timeout"), 30)

    def test_nonzero_returncode_raises_runtime_error(self):
        mock_result = MagicMock(returncode=1, stdout="", stderr="ERROR: unsupported url")
        with patch("subprocess.run", return_value=mock_result):
            with self.assertRaises(RuntimeError):
                YtDlpDownloader().list_formats(_video_info())

    def test_timeout_propagates(self):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="yt-dlp", timeout=30)):
            with self.assertRaises(subprocess.TimeoutExpired):
                YtDlpDownloader().list_formats(_video_info())

if __name__ == '__main__':
    unittest.main()
