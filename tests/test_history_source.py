import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.history_service import HistoryService


class TestSourceColumn(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def _columns(self, table):
        with sqlite3.connect(self.tmp.name) as conn:
            return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}

    def test_both_tables_have_source_column(self):
        self.assertIn("source", self._columns("download_history"))
        self.assertIn("source", self._columns("download_tasks"))

    def test_save_record_stores_source(self):
        self.svc.save_record(
            title="T", url="u", m3u8_url="m", format_id="best",
            status="SUCCESS", output_path="/tmp/f.mp4", source="extension",
        )
        self.assertEqual(self.svc.get_history()[0]["source"], "extension")

    def test_save_record_defaults_to_unknown(self):
        self.svc.save_record(
            title="T", url="u", m3u8_url="m", format_id="best",
            status="SUCCESS", output_path="/tmp/f.mp4",
        )
        self.assertEqual(self.svc.get_history()[0]["source"], "unknown")

    def test_create_task_stores_source(self):
        self.svc.create_task("t1", "https://x.test/v", source="desktop")
        self.assertEqual(self.svc.get_task("t1")["source"], "desktop")


class TestMigrationOnExistingDb(unittest.TestCase):
    def test_adds_column_to_db_created_without_it(self):
        """CSDL đã có dữ liệu từ bản cũ phải migrate được, không mất bản ghi."""
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        # Dựng bảng theo schema CŨ, không có cột source.
        with sqlite3.connect(tmp.name) as conn:
            conn.execute("""
                CREATE TABLE download_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL, url TEXT NOT NULL, m3u8_url TEXT,
                    format_id TEXT, status TEXT NOT NULL, output_path TEXT,
                    playlist_name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "INSERT INTO download_history (title, url, status) VALUES ('cũ', 'u', 'SUCCESS')"
            )
            conn.commit()

        svc = HistoryService(db_path=tmp.name)
        rows = svc.get_history()
        self.assertEqual(len(rows), 1, "bản ghi cũ không được mất")
        self.assertEqual(rows[0]["title"], "cũ")
        # Không backfill: không có cách nào biết ngược nguồn của bản ghi cũ.
        self.assertIn(rows[0]["source"], (None, "unknown"))
        os.unlink(tmp.name)


class TestActiveAndFilter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_active_excludes_terminal_statuses(self):
        self.svc.create_task("running", "u1")
        self.svc.create_task("done", "u2")
        self.svc.update_task("running", status="downloading")
        self.svc.update_task("done", status="completed")

        ids = {t["task_id"] for t in self.svc.get_active_tasks()}
        self.assertIn("running", ids)
        self.assertNotIn("done", ids)

    def test_active_includes_paused(self):
        """Task tạm dừng chưa kết thúc — người dùng cần thấy để bấm tiếp tục."""
        self.svc.create_task("held", "u")
        self.svc.update_task("held", status="paused")
        self.assertIn("held", {t["task_id"] for t in self.svc.get_active_tasks()})

    def test_active_includes_pending(self):
        self.svc.create_task("waiting", "u")
        self.assertIn("waiting", {t["task_id"] for t in self.svc.get_active_tasks()})

    def test_active_carries_source(self):
        self.svc.create_task("x", "u", source="extension")
        self.svc.update_task("x", status="downloading")
        self.assertEqual(self.svc.get_active_tasks()[0]["source"], "extension")

    def test_history_filters_by_source(self):
        for src in ("extension", "desktop", "cli"):
            self.svc.save_record(title=src, url="u", m3u8_url="m", format_id="best",
                                 status="SUCCESS", output_path="/tmp/f", source=src)

        only_ext = self.svc.get_history(source="extension")
        self.assertEqual(len(only_ext), 1)
        self.assertEqual(only_ext[0]["source"], "extension")

    def test_history_without_filter_returns_all_sources(self):
        """Cửa sổ app hiện mọi nguồn (D6)."""
        for src in ("extension", "desktop", "cli"):
            self.svc.save_record(title=src, url="u", m3u8_url="m", format_id="best",
                                 status="SUCCESS", output_path="/tmp/f", source=src)
        self.assertEqual(len(self.svc.get_history()), 3)

    def test_active_tasks_ordered_newest_first(self):
        """Verify get_active_tasks returns tasks ordered by created_at DESC (newest first).

        Must explicitly set created_at to avoid wall-clock timing flakiness.
        This test ensures the ORDER BY clause is not accidentally removed or reversed.
        """
        with self._get_connection() as conn:
            # Insert tasks with explicit created_at timestamps (microsecond precision to avoid ties)
            conn.execute(
                "INSERT INTO download_tasks (task_id, url, status, created_at) "
                "VALUES (?, ?, ?, ?)",
                ("older", "u1", "downloading", "2026-01-01 10:00:00.000000")
            )
            conn.execute(
                "INSERT INTO download_tasks (task_id, url, status, created_at) "
                "VALUES (?, ?, ?, ?)",
                ("middle", "u2", "downloading", "2026-01-01 10:00:01.000000")
            )
            conn.execute(
                "INSERT INTO download_tasks (task_id, url, status, created_at) "
                "VALUES (?, ?, ?, ?)",
                ("newest", "u3", "downloading", "2026-01-01 10:00:02.000000")
            )
            conn.commit()

        tasks = self.svc.get_active_tasks()
        task_ids = [t["task_id"] for t in tasks]
        # Newest first (DESC order)
        self.assertEqual(task_ids, ["newest", "middle", "older"])

    def test_history_with_nonexistent_source_returns_empty(self):
        """get_history(source="bogus") should return [] for a source that matches no rows."""
        self.svc.save_record(title="t", url="u", m3u8_url="m", format_id="best",
                             status="SUCCESS", output_path="/tmp/f", source="extension")
        result = self.svc.get_history(source="bogus")
        self.assertEqual(result, [])

    def _get_connection(self):
        """Helper to get a direct database connection for explicit timestamp insertion."""
        return sqlite3.connect(self.tmp.name)


class TestProgressDoesNotClobberUserIntent(unittest.TestCase):
    """
    Bấm tạm dừng xong, một dòng tiến trình còn sót trong bộ đệm stdout được đọc
    ra là đủ để lật status về 'downloading' — nhìn từ ngoài đúng như nút tạm
    dừng không ăn. Cùng cơ chế nuốt 'cancelling' nên bản ghi kết thúc thành
    'failed' thay vì 'cancelled'. Đo bằng test để không tái diễn.
    """

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.svc = HistoryService(db_path=self.tmp.name)
        self.svc.create_task("t1", "https://example.com/v", source="desktop")

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_progress_does_not_resurrect_a_paused_task(self):
        self.svc.update_task("t1", status="paused")
        self.svc.update_progress("t1", 55.0, avg_speed="1MiB/s")
        task = self.svc.get_task("t1")
        self.assertEqual(task["status"], "paused")
        # Tiến trình vẫn phải được ghi — chỉ status là bất khả xâm phạm.
        self.assertEqual(task["progress"], 55.0)

    def test_progress_does_not_cancel_a_cancellation(self):
        self.svc.update_task("t1", status="cancelling")
        self.svc.update_progress("t1", 80.0)
        self.assertEqual(self.svc.get_task("t1")["status"], "cancelling")

    def test_progress_still_moves_pending_to_downloading(self):
        self.assertEqual(self.svc.get_task("t1")["status"], "pending")
        self.svc.update_progress("t1", 5.0)
        self.assertEqual(self.svc.get_task("t1")["status"], "downloading")


if __name__ == "__main__":
    unittest.main()
