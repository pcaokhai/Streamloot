import os
import tempfile
import unittest
from services.history_service import HistoryService

class TestHistoryServiceTasks(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_history.db")
        self.service = HistoryService(db_path=self.db_path)

    def test_create_task_defaults_to_pending(self):
        self.service.create_task("t1", "https://example.com/video")
        task = self.service.get_task("t1")
        self.assertEqual(task["status"], "pending")
        self.assertEqual(task["url"], "https://example.com/video")

    def test_update_task_partial_fields(self):
        self.service.create_task("t2", "https://example.com/video")
        self.service.update_task("t2", status="downloading", progress=42.5)
        task = self.service.get_task("t2")
        self.assertEqual(task["status"], "downloading")
        self.assertEqual(task["progress"], 42.5)
        # url untouched by partial update
        self.assertEqual(task["url"], "https://example.com/video")

    def test_get_task_missing_returns_none(self):
        self.assertIsNone(self.service.get_task("does-not-exist"))

    def test_terminal_statuses(self):
        self.assertEqual(HistoryService.TERMINAL_STATUSES, {"completed", "failed", "cancelled"})

    def test_paused_is_not_terminal(self):
        self.assertNotIn("paused", HistoryService.TERMINAL_STATUSES)

    def test_avg_speed_persists_and_survives_later_updates_without_it(self):
        self.service.create_task("t3", "https://example.com/video")
        self.service.update_task("t3", status="downloading", progress=100.0, avg_speed="5.81MiB/s")
        self.assertEqual(self.service.get_task("t3")["avg_speed"], "5.81MiB/s")

        # A later update that doesn't mention avg_speed must not clear it —
        # this is exactly the completion-write ordering in download_service.py.
        self.service.update_task("t3", status="completed")
        task = self.service.get_task("t3")
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["avg_speed"], "5.81MiB/s")

    def test_fail_interrupted_tasks_clears_phantoms(self):
        """
        Force-quit giữa chừng để lại hàng 'downloading' — giờ nó là nguồn sự thật
        cho ba surface, nên menu bar hiện tải ma mãi mãi nếu không dọn.
        """
        self.service.create_task("live", "https://example.com/a")
        self.service.update_task("live", status="downloading", progress=30.0)
        self.service.create_task("paused", "https://example.com/b")
        self.service.update_task("paused", status="paused")
        self.service.create_task("done", "https://example.com/c")
        self.service.update_task("done", status="completed")

        cleaned = self.service.fail_interrupted_tasks()

        self.assertEqual(cleaned, 2)
        self.assertEqual(self.service.get_active_tasks(), [])
        for task_id in ("live", "paused"):
            task = self.service.get_task(task_id)
            self.assertEqual(task["status"], "failed")
            self.assertEqual(task["error_msg"], "Interrupted by app restart")
        # Bản ghi đã kết thúc không bị đụng vào.
        self.assertEqual(self.service.get_task("done")["status"], "completed")
        self.assertIsNone(self.service.get_task("done")["error_msg"])

    def test_fail_interrupted_tasks_is_idempotent(self):
        self.service.create_task("t", "https://example.com/a")
        self.assertEqual(self.service.fail_interrupted_tasks(), 1)
        self.assertEqual(self.service.fail_interrupted_tasks(), 0)


if __name__ == '__main__':
    unittest.main()
