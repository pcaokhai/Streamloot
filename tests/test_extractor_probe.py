import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.api import main as api_main
from extractors.ytdlp_default import YtDlpDefaultExtractor


class _FakePlugin(YtDlpDefaultExtractor.__bases__[0]):
    """Giả một plugin riêng — không kế thừa YtDlpDefaultExtractor."""

    def extract(self, url):
        return []


class TestExtractorProbe(unittest.TestCase):
    """
    Extension hỏi endpoint này để chọn đường: manifest (site có plugin) hay
    yt-dlp theo URL trang (site không có).
    """

    def test_site_without_plugin_reports_false(self):
        with patch.object(api_main.ExtractorFactory, "get_extractor",
                          return_value=YtDlpDefaultExtractor()):
            self.assertEqual(
                api_main.describe_extractor("https://example.test/watch/1"),
                {"plugin": False},
            )

    def test_site_with_plugin_reports_true(self):
        with patch.object(api_main.ExtractorFactory, "get_extractor",
                          return_value=_FakePlugin()):
            self.assertEqual(
                api_main.describe_extractor("https://example.test/watch/1"),
                {"plugin": True},
            )

    def test_response_never_leaks_domains_or_class_names(self):
        """
        Chỉ boolean. Trả tên plugin hay tên miền là làm rò chính thứ repo này
        phải giữ kín (CLAUDE.md §3.1).
        """
        with patch.object(api_main.ExtractorFactory, "get_extractor",
                          return_value=_FakePlugin()):
            out = api_main.describe_extractor("https://example.test/watch/1")
        self.assertEqual(set(out), {"plugin"})
        self.assertIsInstance(out["plugin"], bool)


if __name__ == "__main__":
    unittest.main()
