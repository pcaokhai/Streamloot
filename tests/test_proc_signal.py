import os
import signal
import subprocess
import sys
import time
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.proc import signal_tree


def _state(pid: int) -> str:
    r = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True)
    return r.stdout.strip() or "gone"


def _child_of(pid: int, tries: int = 40):
    for _ in range(tries):
        r = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True)
        if r.stdout.split():
            return int(r.stdout.split()[0])
        time.sleep(0.05)
    return None


class TestSignalTree(unittest.TestCase):
    """
    yt-dlp giao việc tải cho ffmpeg, nên tiến trình kéo byte là CHÁU. Gửi tín
    hiệu riêng cho con thì cháu chạy tiếp — menu báo đã tạm dừng mà file vẫn
    phình. Test này giữ cho bản vá không lặng lẽ mất tác dụng.
    """

    def setUp(self):
        self.p = subprocess.Popen(["sh", "-c", "sleep 30 & wait"], start_new_session=True)
        self.kid = _child_of(self.p.pid)
        self.assertIsNotNone(self.kid, "không tạo được tiến trình cháu để thử")

    def tearDown(self):
        try:
            os.killpg(os.getpgid(self.p.pid), signal.SIGCONT)
            os.killpg(os.getpgid(self.p.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        self.p.wait(timeout=5)

    def test_download_runs_in_its_own_group(self):
        """Không có nhóm riêng thì killpg sẽ dừng luôn backend — đã tự treo mình thật."""
        self.assertNotEqual(os.getpgid(self.p.pid), os.getpgid(0))

    def test_signalling_only_the_child_leaves_the_grandchild_running(self):
        """Đây chính là lỗi: đo lại để biết chắc nó có thật."""
        self.p.send_signal(signal.SIGSTOP)
        time.sleep(0.4)
        self.assertTrue(_state(self.p.pid).startswith("T"))
        self.assertFalse(_state(self.kid).startswith("T"), "cháu đáng lẽ vẫn chạy")
        self.p.send_signal(signal.SIGCONT)

    def test_signal_tree_stops_the_whole_tree(self):
        self.assertTrue(signal_tree(self.p, signal.SIGSTOP))
        time.sleep(0.4)
        self.assertTrue(_state(self.p.pid).startswith("T"), "con phải dừng")
        self.assertTrue(_state(self.kid).startswith("T"), "CHÁU cũng phải dừng")

    def test_signal_tree_resumes_the_whole_tree(self):
        signal_tree(self.p, signal.SIGSTOP)
        time.sleep(0.3)
        self.assertTrue(signal_tree(self.p, signal.SIGCONT))
        time.sleep(0.3)
        self.assertFalse(_state(self.p.pid).startswith("T"))
        self.assertFalse(_state(self.kid).startswith("T"))

    def test_terminate_kills_the_grandchild_too(self):
        """Huỷ mà để ffmpeg mồ côi thì nó vẫn ghi file tiếp."""
        signal_tree(self.p, signal.SIGTERM)
        time.sleep(0.5)
        self.assertEqual(_state(self.kid), "gone", "cháu phải chết theo")

    def test_returns_false_for_a_process_already_finished(self):
        self.p.kill()
        self.p.wait(timeout=5)
        self.assertFalse(signal_tree(self.p, signal.SIGSTOP))


if __name__ == "__main__":
    unittest.main()
