import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.desktop.statusbar_menu import build_menu_model


class TestMenuModel(unittest.TestCase):
    """
    Tách phần quyết định NỘI DUNG menu khỏi phần dựng NSMenu, để test được mà
    không cần AppKit và không cần chạy vòng lặp giao diện.
    """

    def test_no_downloads_hides_the_progress_block(self):
        model = build_menu_model([])
        self.assertIsNone(model["download"])

    def test_shows_most_recent_task(self):
        """get_active_tasks trả mới nhất trước, nên lấy phần tử đầu."""
        model = build_menu_model([
            {"task_id": "new", "title": "Mới", "status": "downloading", "progress": 10.0},
            {"task_id": "old", "title": "Cũ", "status": "downloading", "progress": 90.0},
        ])
        self.assertEqual(model["download"]["task_id"], "new")

    def test_downloading_offers_pause(self):
        model = build_menu_model(
            [{"task_id": "a", "title": "T", "status": "downloading", "progress": 42.0}]
        )
        self.assertEqual(model["download"]["action"], "pause")
        self.assertIn("42%", model["download"]["label"])

    def test_paused_offers_resume(self):
        model = build_menu_model(
            [{"task_id": "a", "title": "T", "status": "paused", "progress": 42.0}]
        )
        self.assertEqual(model["download"]["action"], "resume")
        self.assertIn("Tạm dừng", model["download"]["label"])

    def test_long_title_is_truncated(self):
        model = build_menu_model(
            [{"task_id": "a", "title": "x" * 200, "status": "downloading", "progress": 1.0}]
        )
        self.assertLessEqual(len(model["download"]["label"]), 60)

    def test_missing_title_does_not_crash(self):
        """Task vừa tạo chưa có title — không được ném."""
        model = build_menu_model(
            [{"task_id": "a", "title": None, "status": "pending", "progress": None}]
        )
        self.assertIsNotNone(model["download"]["label"])


if __name__ == "__main__":
    unittest.main()
