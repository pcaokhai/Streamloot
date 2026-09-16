import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from utils import paths


class TestPaths(unittest.TestCase):
    """
    The frozen branches are what the .app depends on and what no dev run ever
    exercises, so they are the ones worth pinning.
    """

    def test_source_run_uses_project_root(self):
        self.assertFalse(paths.is_frozen())
        expected = Path(paths.__file__).resolve().parent.parent
        self.assertEqual(paths.resource_dir(), expected)
        self.assertEqual(paths.user_data_dir(), expected)

    def test_frozen_reads_from_meipass_and_writes_to_app_support(self):
        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "_MEIPASS", "/tmp/meipass-fake", create=True), \
             patch.object(Path, "mkdir"):
            self.assertTrue(paths.is_frozen())
            # Bundled files come out of the extraction dir...
            self.assertEqual(paths.resource_dir(), Path("/tmp/meipass-fake"))
            self.assertEqual(paths.plugins_dir(), Path("/tmp/meipass-fake/plugins"))
            self.assertEqual(paths.bundled_bin_dir(), Path("/tmp/meipass-fake/bin"))
            # ...but writes must NOT, or they land in the read-only bundle.
            data = paths.user_data_dir()
            self.assertEqual(
                data, Path.home() / "Library" / "Application Support" / "Streamloot"
            )
            self.assertNotIn("meipass-fake", str(data))

    def test_ensure_tool_path_prepends_existing_dirs_once(self):
        """The Finder-launched app has no Homebrew on PATH; this is the fix."""
        with patch.dict(os.environ, {"PATH": "/usr/bin:/bin"}, clear=False), \
             patch.object(paths, "bundled_bin_dir", return_value=Path("/tmp")):
            paths.ensure_tool_path()
            first = os.environ["PATH"]
            self.assertTrue(first.startswith("/tmp"))
            self.assertIn("/usr/bin", first)
            # Idempotent — main.py and the downloader module may both call it.
            paths.ensure_tool_path()
            self.assertEqual(os.environ["PATH"], first)

    def test_ensure_tool_path_skips_missing_dirs(self):
        with patch.dict(os.environ, {"PATH": "/usr/bin"}, clear=False), \
             patch.object(
                 paths, "bundled_bin_dir",
                 return_value=Path("/nonexistent-downloader-bin")
             ):
            paths.ensure_tool_path()
            self.assertNotIn("/nonexistent-downloader-bin", os.environ["PATH"])


if __name__ == "__main__":
    unittest.main()
