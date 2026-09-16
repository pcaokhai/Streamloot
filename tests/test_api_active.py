import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.api import main as api_main


class TestActiveEndpoint(unittest.TestCase):
    def test_returns_active_tasks(self):
        rows = [{"task_id": "a", "status": "downloading", "source": "extension"}]
        with patch.object(api_main.history, "get_active_tasks", return_value=rows):
            out = api_main.get_active_downloads()
        self.assertEqual(out["tasks"], rows)

    def test_returns_empty_list_when_nothing_runs(self):
        with patch.object(api_main.history, "get_active_tasks", return_value=[]):
            self.assertEqual(api_main.get_active_downloads()["tasks"], [])


class TestHistoryFilter(unittest.TestCase):
    def test_passes_source_through(self):
        with patch.object(api_main.history, "get_history", return_value=[]) as gh:
            api_main.get_history(source="extension")
        self.assertEqual(gh.call_args.kwargs["source"], "extension")

    def test_no_source_means_all(self):
        with patch.object(api_main.history, "get_history", return_value=[]) as gh:
            api_main.get_history()
        self.assertIsNone(gh.call_args.kwargs["source"])


class TestSourceOnCreate(unittest.TestCase):
    def test_prepared_endpoint_marks_extension(self):
        import asyncio

        req = api_main.PreparedDownloadRequest(
            video_info=api_main.VideoInfoPayload(
                title="t", m3u8_url="https://c.test/m.m3u8", page_url="https://p.test/v"
            )
        )
        with patch.object(api_main.history, "create_task") as create:
            asyncio.run(api_main.start_prepared_download(req, MagicMock()))
        self.assertEqual(create.call_args.kwargs["source"], "extension")

    def test_url_endpoint_defaults_to_unknown(self):
        import asyncio

        req = api_main.DownloadRequest(url="https://p.test/v")
        with patch.object(api_main.history, "create_task") as create:
            asyncio.run(api_main.start_download(req, MagicMock()))
        self.assertEqual(create.call_args.kwargs["source"], "unknown")

    def test_url_endpoint_accepts_explicit_source(self):
        import asyncio

        req = api_main.DownloadRequest(url="https://p.test/v", source="desktop")
        with patch.object(api_main.history, "create_task") as create:
            asyncio.run(api_main.start_download(req, MagicMock()))
        self.assertEqual(create.call_args.kwargs["source"], "desktop")


if __name__ == "__main__":
    unittest.main()
