import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("API_KEY", "test-key")

from fastapi import BackgroundTasks

import apps.api.main as api_main
import apps.cli.main as cli_main
from apps.desktop.statusbar_menu import build_menu_model
from services.history_service import HistoryService


class TestSourceEndToEnd(unittest.TestCase):
    """
    Nối cả chuỗi thật trên một DB tạm: POST /downloads -> create_task ->
    get_active_tasks() -> build_menu_model. Mỗi task đều đã có test riêng, nhưng
    các mối nối thì chưa — và đúng chỗ nối là nơi `source` bị rơi.
    """

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.history = HistoryService(db_path=os.path.join(self.tmpdir, "e2e.db"))
        patcher = patch.object(api_main, "history", self.history)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_desktop_download_is_visible_and_tagged_desktop(self):
        req = api_main.DownloadRequest(url="https://example.com/v", source="desktop")
        # BackgroundTasks không bao giờ được chạy: ta chỉ quan tâm bản ghi
        # start_download ghi ra trước khi giao việc cho worker.
        res = asyncio.run(api_main.start_download(req, BackgroundTasks()))

        active = self.history.get_active_tasks()
        self.assertEqual([t["task_id"] for t in active], [res["task_id"]])
        self.assertEqual(active[0]["source"], "desktop")

        model = build_menu_model(active)
        self.assertEqual(model["download"]["task_id"], res["task_id"])
        # Vừa tạo nên còn 'pending' — chưa có tiến trình con để tạm dừng.
        self.assertFalse(model["download"]["enabled"])

        # Khởi động lại app: task dở dang phải biến mất khỏi menu bar.
        self.history.fail_interrupted_tasks()
        self.assertEqual(self.history.get_active_tasks(), [])
        self.assertIsNone(build_menu_model(self.history.get_active_tasks())["download"])

    def test_missing_source_falls_back_to_unknown(self):
        req = api_main.DownloadRequest(url="https://example.com/v")
        res = asyncio.run(api_main.start_download(req, BackgroundTasks()))
        self.assertEqual(self.history.get_task(res["task_id"])["source"], "unknown")

    def test_cli_source_lands_in_the_same_chain(self):
        """CLI không đi qua HTTP; nó gọi thẳng DownloadService với source='cli'."""
        service = MagicMock()
        service.process_url.side_effect = lambda **kw: self.history.create_task(
            "cli-task", kw["url"], source=kw["source"]
        ) or True
        with patch.object(cli_main, "DownloadService", return_value=service), \
             patch.object(sys, "argv", ["main.py", "-u", "https://example.com/c", "--no-interactive"]):
            cli_main.main()

        active = self.history.get_active_tasks()
        self.assertEqual([t["source"] for t in active], ["cli"])


if __name__ == "__main__":
    unittest.main()
