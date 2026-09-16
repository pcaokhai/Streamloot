import os
import signal
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import HTTPException
from apps.api import main as api_main
from services.history_service import HistoryService

def _running_process():
    p = MagicMock()
    p.poll.return_value = None  # still running
    return p

class TestApiPauseResumeEndpoints(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_history.db")
        api_main.history = HistoryService(db_path=self.db_path)
        api_main.registry = api_main.TaskRegistry()

    def test_pause_unknown_task_returns_404(self):
        with self.assertRaises(HTTPException) as ctx:
            api_main.pause_download("nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_pause_terminal_task_returns_409(self):
        api_main.history.create_task("t1", "https://example.com")
        api_main.history.update_task("t1", status="completed")
        with self.assertRaises(HTTPException) as ctx:
            api_main.pause_download("t1")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_pause_already_paused_returns_409(self):
        api_main.history.create_task("t2", "https://example.com")
        api_main.history.update_task("t2", status="paused")
        with self.assertRaises(HTTPException) as ctx:
            api_main.pause_download("t2")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_pause_without_registered_process_returns_409(self):
        api_main.history.create_task("t3", "https://example.com")
        api_main.history.update_task("t3", status="downloading")
        with self.assertRaises(HTTPException) as ctx:
            api_main.pause_download("t3")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_pause_sends_sigstop_and_updates_status(self):
        api_main.history.create_task("t4", "https://example.com")
        api_main.history.update_task("t4", status="downloading", progress=40.0)
        process = _running_process()
        api_main.registry.set_process("t4", process)

        result = api_main.pause_download("t4")

        process.send_signal.assert_called_once_with(signal.SIGSTOP)
        self.assertEqual(api_main.history.get_task("t4")["status"], "paused")
        self.assertEqual(result["task_id"], "t4")

    def test_resume_unknown_task_returns_404(self):
        with self.assertRaises(HTTPException) as ctx:
            api_main.resume_download("nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_resume_non_paused_task_returns_409(self):
        api_main.history.create_task("t5", "https://example.com")
        api_main.history.update_task("t5", status="downloading")
        with self.assertRaises(HTTPException) as ctx:
            api_main.resume_download("t5")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_resume_sends_sigcont_and_updates_status(self):
        api_main.history.create_task("t6", "https://example.com")
        api_main.history.update_task("t6", status="paused", progress=40.0)
        process = _running_process()
        api_main.registry.set_process("t6", process)

        result = api_main.resume_download("t6")

        process.send_signal.assert_called_once_with(signal.SIGCONT)
        self.assertEqual(api_main.history.get_task("t6")["status"], "downloading")
        self.assertEqual(result["task_id"], "t6")

    def test_cancel_on_paused_task_sends_sigcont_before_terminate(self):
        """
        SIGTERM delivered to a stopped process is queued, not acted on, until
        it resumes — cancel must SIGCONT first or a cancelled-while-paused
        task would hang forever instead of actually terminating.
        """
        api_main.history.create_task("t7", "https://example.com")
        api_main.history.update_task("t7", status="paused")
        process = _running_process()
        api_main.registry.set_process("t7", process)

        api_main.cancel_download("t7")

        process.send_signal.assert_called_once_with(signal.SIGCONT)
        process.terminate.assert_called_once()

if __name__ == '__main__':
    unittest.main()
