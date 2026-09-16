import os
import queue
import sys
import threading
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("API_KEY", "test-key")
from apps.api.main import TaskRegistry


def drain(q: queue.Queue) -> list:
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except queue.Empty:
            return out


class TestTaskRegistryFanout(unittest.TestCase):
    """
    Trước fan-out: một task = một Queue, `get()` phá huỷ. Hai người nghe (cửa sổ
    app hydrate vào task extension đang stream) chia nhau sự kiện — cả hai sai số,
    và bên trượt sự kiện cuối lặp vô hạn.
    """

    def setUp(self):
        self.reg = TaskRegistry()

    def test_every_subscriber_receives_every_event(self):
        a = self.reg.subscribe("t")
        b = self.reg.subscribe("t")
        for i in range(3):
            self.reg.broadcast_sync("t", {"completed": i})

        self.assertEqual(drain(a), [{"completed": 0}, {"completed": 1}, {"completed": 2}])
        self.assertEqual(drain(b), [{"completed": 0}, {"completed": 1}, {"completed": 2}])

    def test_terminal_event_reaches_all_subscribers(self):
        subs = [self.reg.subscribe("t") for _ in range(3)]
        self.reg.broadcast_sync("t", {"status": "completed"})
        for q in subs:
            self.assertEqual(drain(q), [{"status": "completed"}])

    def test_unsubscribe_mid_stream_leaves_others_intact(self):
        a = self.reg.subscribe("t")
        b = self.reg.subscribe("t")
        self.reg.broadcast_sync("t", {"completed": 1})
        self.reg.unsubscribe("t", a)
        self.reg.broadcast_sync("t", {"status": "completed"})

        self.assertEqual(drain(a), [{"completed": 1}])
        self.assertEqual(drain(b), [{"completed": 1}, {"status": "completed"}])

    def test_unsubscribe_twice_and_unknown_task_are_no_ops(self):
        a = self.reg.subscribe("t")
        self.reg.unsubscribe("t", a)
        self.reg.unsubscribe("t", a)
        self.reg.unsubscribe("khong-ton-tai", a)
        self.assertNotIn("t", self.reg.subscribers)

    def test_broadcast_with_no_subscribers_does_not_raise(self):
        self.reg.broadcast_sync("t", {"status": "completed"})

    def test_cleanup_after_terminal_still_lets_subscribers_drain(self):
        """Worker gọi cleanup() ngay sau sự kiện cuối — không được nuốt nó."""
        q = self.reg.subscribe("t")
        self.reg.broadcast_sync("t", {"status": "failed"})
        self.reg.cleanup("t")
        self.assertEqual(drain(q), [{"status": "failed"}])

    def test_concurrent_subscribe_while_broadcasting(self):
        """broadcast_sync chạy trên thread worker, subscribe từ endpoint async."""
        stop = threading.Event()
        errors = []

        def broadcaster():
            try:
                while not stop.is_set():
                    self.reg.broadcast_sync("t", {"completed": 1})
            except Exception as e:  # pragma: no cover
                errors.append(e)

        th = threading.Thread(target=broadcaster)
        th.start()
        try:
            for _ in range(200):
                q = self.reg.subscribe("t")
                self.reg.unsubscribe("t", q)
        finally:
            stop.set()
            th.join()

        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
