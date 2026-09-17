import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.api import main as api_main
from services.history_service import HistoryService

#: Field mà apps/extension/lib/types.ts khai báo. Đổi một bên phải đổi bên kia.
TASK_RECORD_FIELDS = {
    "task_id", "url", "title", "status", "progress", "output_path",
    "error_msg", "created_at", "updated_at", "avg_speed", "source",
}
HISTORY_ROW_FIELDS = {
    "id", "title", "url", "m3u8_url", "format_id", "status",
    "output_path", "playlist_name", "created_at", "source",
}


class TestApiContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_active_task_shape_matches_typescript(self):
        self.svc.create_task("t1", "https://example.test/v", source="extension")
        with patch.object(api_main, "history", self.svc):
            out = api_main.get_active_downloads()
        self.assertEqual(set(out["tasks"][0]), TASK_RECORD_FIELDS)

    def test_history_row_shape_matches_typescript(self):
        self.svc.save_record(title="T", url="https://example.test/v", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path="/tmp/a.mp4",
                             source="extension")
        with patch.object(api_main, "history", self.svc):
            rows = api_main.get_history(source="extension")
        self.assertEqual(set(rows[0]), HISTORY_ROW_FIELDS)

    def test_history_filters_to_extension_only(self):
        self.svc.save_record(title="A", url="https://example.test/a", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path=None,
                             source="extension")
        self.svc.save_record(title="B", url="https://example.test/b", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path=None,
                             source="cli")
        with patch.object(api_main, "history", self.svc):
            rows = api_main.get_history(source="extension")
        self.assertEqual([r["title"] for r in rows], ["A"])


if __name__ == "__main__":
    unittest.main()
