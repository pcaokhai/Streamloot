import os
import signal
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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

        # Đi qua signal_tree nên với process giả (không có nhóm riêng) nó lùi về
        # send_signal. Điều PHẢI giữ là thứ tự: CONT trước, TERM sau.
        sent = [c.args[0] for c in process.send_signal.call_args_list]
        self.assertEqual(sent, [signal.SIGCONT, signal.SIGTERM])

    def test_cancel_signals_the_whole_process_group(self):
        """
        yt-dlp giao việc tải cho ffmpeg, nên tiến trình kéo byte là CHÁU. Huỷ mà
        chỉ giết yt-dlp thì ffmpeg thành mồ côi và vẫn ghi file tiếp.
        """
        api_main.history.create_task("t8", "https://example.com")
        process = _running_process()
        api_main.registry.set_process("t8", process)

        with patch("utils.proc.os.getpgid", side_effect=lambda pid: 4242 if pid else 1), \
             patch("utils.proc.os.killpg") as killpg:
            api_main.cancel_download("t8")

        self.assertEqual([c.args for c in killpg.call_args_list],
                         [(4242, signal.SIGCONT), (4242, signal.SIGTERM)])
        # Đã bắn vào cả nhóm thì không gửi riêng cho tiến trình con nữa.
        process.send_signal.assert_not_called()

    def test_pause_signals_the_whole_process_group(self):
        """
        Đúng lỗi người dùng gặp: menu báo "đã tạm dừng" mà video vẫn tải tiếp,
        vì SIGSTOP chỉ tới yt-dlp còn ffmpeg (tiến trình cháu) chạy tiếp.
        """
        api_main.history.create_task("t9", "https://example.com")
        api_main.history.update_task("t9", status="downloading")
        process = _running_process()
        api_main.registry.set_process("t9", process)

        with patch("utils.proc.os.getpgid", side_effect=lambda pid: 777 if pid else 1), \
             patch("utils.proc.os.killpg") as killpg:
            api_main.pause_download("t9")

        killpg.assert_called_once_with(777, signal.SIGSTOP)
        process.send_signal.assert_not_called()

    def test_resume_signals_the_whole_process_group(self):
        api_main.history.create_task("t10", "https://example.com")
        api_main.history.update_task("t10", status="paused")
        process = _running_process()
        api_main.registry.set_process("t10", process)

        with patch("utils.proc.os.getpgid", side_effect=lambda pid: 778 if pid else 1), \
             patch("utils.proc.os.killpg") as killpg:
            api_main.resume_download("t10")

        killpg.assert_called_once_with(778, signal.SIGCONT)
        process.send_signal.assert_not_called()


if __name__ == '__main__':
    unittest.main()
