import os
import sys
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import HTTPException
from apps.api import main as api_main
from core.models import VideoInfo

class TestApiFormatsEndpoint(unittest.TestCase):
    def test_extraction_failure_returns_400(self):
        mock_extractor = MagicMock()
        mock_extractor.extract.return_value = []
        with patch.object(api_main.ExtractorFactory, "get_extractor", return_value=mock_extractor):
            with self.assertRaises(HTTPException) as ctx:
                api_main.get_formats(url="https://example.com/bad")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_timeout_returns_504(self):
        mock_extractor = MagicMock()
        mock_extractor.extract.return_value = [VideoInfo(title="T", m3u8_url="https://x/s.m3u8", page_url="https://x")]
        with patch.object(api_main.ExtractorFactory, "get_extractor", return_value=mock_extractor), \
             patch.object(api_main.YtDlpDownloader, "list_formats", side_effect=subprocess.TimeoutExpired(cmd="yt-dlp", timeout=30)):
            with self.assertRaises(HTTPException) as ctx:
                api_main.get_formats(url="https://example.com/slow")
        self.assertEqual(ctx.exception.status_code, 504)

    def test_success_returns_title_and_formats(self):
        mock_extractor = MagicMock()
        mock_extractor.extract.return_value = [VideoInfo(title="My Video", m3u8_url="https://x/s.m3u8", page_url="https://x")]
        fake_formats = [{"format_id": "137", "recommended": True}]
        with patch.object(api_main.ExtractorFactory, "get_extractor", return_value=mock_extractor), \
             patch.object(api_main.YtDlpDownloader, "list_formats", return_value=fake_formats):
            result = api_main.get_formats(url="https://example.com/watch")
        self.assertEqual(result["title"], "My Video")
        self.assertEqual(result["formats"], fake_formats)

class TestApiVersionEndpoint(unittest.TestCase):
    def test_returns_version_check_shape(self):
        with patch.object(api_main, "check_ytdlp_update", return_value={"current": "1", "latest": "2", "update_available": True}):
            result = api_main.get_ytdlp_version()
        self.assertEqual(result, {"current": "1", "latest": "2", "update_available": True})

if __name__ == '__main__':
    unittest.main()
