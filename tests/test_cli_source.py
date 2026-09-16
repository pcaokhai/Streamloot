import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import apps.cli.main as cli_main


class TestCliSource(unittest.TestCase):
    """Spec §6.2: 'CLI gửi cli'. Nếu không, mọi bản ghi CLI đội lốt 'unknown'."""

    def test_cli_passes_source_cli(self):
        service = MagicMock()
        service.process_url.return_value = True
        with patch.object(cli_main, "DownloadService", return_value=service), \
             patch.object(sys, "argv", ["main.py", "-u", "https://example.com/v", "--no-interactive"]):
            cli_main.main()

        self.assertEqual(service.process_url.call_args.kwargs["source"], "cli")


if __name__ == "__main__":
    unittest.main()
