import os
import re
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


def ts_interface_fields(interface_name: str) -> set[str]:
    """
    Extract field names from a TypeScript interface in apps/extension/lib/types.ts.

    Parses the interface definition and extracts field names from lines matching
    `fieldName: type;` pattern. Raises ValueError if interface not found or empty.

    This catches Direction B (TypeScript adds field, backend doesn't): if TypeScript
    interface grows but backend doesn't, this will fail. If regex is broken, we throw
    rather than return empty set that would falsely pass.
    """
    types_file = PROJECT_ROOT / "apps" / "extension" / "lib" / "types.ts"
    content = types_file.read_text()

    # Find the interface block
    pattern = rf"export interface {interface_name}\s*\{{([^}}]*)}}"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        raise ValueError(f"Interface {interface_name} not found in types.ts")

    interface_body = match.group(1)

    # Extract field names: match "fieldName:" at start of line (after whitespace)
    # but exclude comment lines and closing braces
    field_pattern = r"^\s*(\w+)\s*:"
    fields = set()
    for line in interface_body.split('\n'):
        line = line.strip()
        if not line or line.startswith('//') or line == '}':
            continue
        field_match = re.match(field_pattern, line)
        if field_match:
            fields.add(field_match.group(1))

    if not fields:
        raise ValueError(
            f"No fields found in interface {interface_name}. "
            "Regex may be broken or interface is empty."
        )

    return fields


class TestApiContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_ts_interface_fields_extraction_is_correct(self):
        """Validate the regex extraction itself (Direction B protection)."""
        task_fields = ts_interface_fields("TaskRecord")
        # Must contain known fields; must NOT contain noise
        self.assertIn("task_id", task_fields)
        self.assertIn("progress", task_fields)
        self.assertIn("source", task_fields)
        self.assertNotIn("{", task_fields)
        self.assertNotIn("}", task_fields)
        self.assertNotIn("//", task_fields)
        self.assertNotIn("TaskRecord", task_fields)

    def test_active_task_shape_matches_typescript(self):
        """Backend TaskRecord fields must match TypeScript interface."""
        task_fields = ts_interface_fields("TaskRecord")
        self.svc.create_task("t1", "https://example.test/v", source="extension")
        with patch.object(api_main, "history", self.svc):
            out = api_main.get_active_downloads()
        self.assertEqual(set(out["tasks"][0]), task_fields)

    def test_history_row_shape_matches_typescript(self):
        """Backend HistoryRow fields must match TypeScript interface."""
        history_fields = ts_interface_fields("HistoryRow")
        self.svc.save_record(title="T", url="https://example.test/v", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path="/tmp/a.mp4",
                             source="extension")
        with patch.object(api_main, "history", self.svc):
            rows = api_main.get_history(source="extension")
        self.assertEqual(set(rows[0]), history_fields)

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

    def test_format_option_shape_matches_typescript(self):
        """
        list_formats dựng dict này bằng tay, không lấy từ bảng DB nào, nên không
        có migration nào nhắc khi nó đổi. Ghim lại ở đây.
        """
        expected = ts_interface_fields("FormatOption")
        actual = {
            "format_id", "ext", "resolution", "height",
            "filesize", "vcodec", "acodec", "recommended",
        }
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
