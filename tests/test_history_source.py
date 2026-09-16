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


if __name__ == "__main__":
    unittest.main()
