import unittest
from unittest.mock import patch, MagicMock
from utils.ytdlp_version import check_ytdlp_update, get_current_version, get_latest_version

class TestYtdlpVersionCheck(unittest.TestCase):
    def test_update_available_when_versions_differ(self):
        with patch("utils.ytdlp_version.get_current_version", return_value="2026.01.01"), \
             patch("utils.ytdlp_version.get_latest_version", return_value="2026.08.19"):
            status = check_ytdlp_update()
        self.assertTrue(status["update_available"])
        self.assertEqual(status["current"], "2026.01.01")
        self.assertEqual(status["latest"], "2026.08.19")

    def test_up_to_date_when_versions_match(self):
        with patch("utils.ytdlp_version.get_current_version", return_value="2026.08.19"), \
             patch("utils.ytdlp_version.get_latest_version", return_value="2026.08.19"):
            status = check_ytdlp_update()
        self.assertFalse(status["update_available"])

    def test_unknown_when_either_lookup_fails(self):
        with patch("utils.ytdlp_version.get_current_version", return_value=None), \
             patch("utils.ytdlp_version.get_latest_version", return_value="2026.08.19"):
            status = check_ytdlp_update()
        self.assertFalse(status["update_available"])
        self.assertIsNone(status["current"])

    def test_get_current_version_handles_missing_binary(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            self.assertIsNone(get_current_version())

    def test_get_latest_version_strips_leading_v(self):
        fake_response = MagicMock()
        fake_response.__enter__ = MagicMock(return_value=fake_response)
        fake_response.__exit__ = MagicMock(return_value=False)
        fake_response.read.return_value = b'{"tag_name": "v2026.08.19"}'
        with patch("urllib.request.urlopen", return_value=fake_response):
            self.assertEqual(get_latest_version(), "2026.08.19")

    def test_get_latest_version_handles_network_failure(self):
        with patch("urllib.request.urlopen", side_effect=OSError("no network")):
            self.assertIsNone(get_latest_version())

if __name__ == '__main__':
    unittest.main()
