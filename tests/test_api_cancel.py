import os
import sys
import tempfile
import unittest
from pathlib import Path

# apps/api/main.py reads API_KEY at import time (fail-fast on missing key) —
# must be set before the module is imported.
os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import HTTPException
from apps.api import main as api_main
from services.history_service import HistoryService

class TestApiCancelEndpoint(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_history.db")
        api_main.history = HistoryService(db_path=self.db_path)

    def test_cancel_unknown_task_returns_404(self):
        with self.assertRaises(HTTPException) as ctx:
            api_main.cancel_download("does-not-exist")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_cancel_already_finished_task_returns_409(self):
        api_main.history.create_task("t1", "https://example.com")
        api_main.history.update_task("t1", status="completed")

        with self.assertRaises(HTTPException) as ctx:
            api_main.cancel_download("t1")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_cancel_pending_task_sets_cancelling_status(self):
        api_main.history.create_task("t2", "https://example.com")

        result = api_main.cancel_download("t2")

        self.assertEqual(result["task_id"], "t2")
        self.assertEqual(api_main.history.get_task("t2")["status"], "cancelling")

    def test_status_lookup_unknown_task_returns_404(self):
        with self.assertRaises(HTTPException) as ctx:
            api_main.get_download_status("does-not-exist")
        self.assertEqual(ctx.exception.status_code, 404)

if __name__ == '__main__':
    unittest.main()
