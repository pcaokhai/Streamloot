import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from services.download_service import DownloadService
from services.history_service import HistoryService
from core.models import VideoInfo

def _fake_video_info():
    return VideoInfo(
        title="Test Video",
        m3u8_url="https://example.com/stream.m3u8",
        page_url="https://example.com/watch",
    )

class TestDownloadServiceCancel(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_history.db")
        self.service = DownloadService()
        self.service.history = HistoryService(db_path=self.db_path)

    def test_cancel_requested_before_download_starts(self):
        self.service.history.create_task("t1", "https://example.com/watch")
        self.service.history.update_task("t1", status="cancelling")

        with patch("services.download_service.ExtractorFactory") as mock_factory:
            result = self.service.process_url(
                "https://example.com/watch", interactive=False, task_id="t1"
            )

        self.assertFalse(result)
        self.assertEqual(self.service.history.get_task("t1")["status"], "cancelled")
        mock_factory.get_extractor.assert_not_called()

    def test_cancel_requested_mid_download_wins_race(self):
        """
        Simulates the cancel handler setting status='cancelling' (as the API
        does, before calling terminate()) while a download is in flight. The
        downloader mock stands in for a process that got killed and returned
        no output path. DownloadService must report 'cancelled', not 'failed',
        because the status was already 'cancelling' when it checked.
        """
        self.service.history.create_task("t2", "https://example.com/watch")

        def fake_download(video_info, concurrency, output_dir, format_id,
                           progress_callback=None, process_callback=None):
            # Emulate the cancel handler winning the race: it flips the task
            # to 'cancelling' while yt-dlp is still "running", then the
            # process gets killed and download() returns None.
            self.service.history.update_task("t2", status="cancelling")
            return None

        mock_extractor = MagicMock()
        mock_extractor.extract.return_value = [_fake_video_info()]

        with patch("services.download_service.ExtractorFactory") as mock_factory, \
             patch.object(self.service.downloader, "download", side_effect=fake_download):
            mock_factory.get_extractor.return_value = mock_extractor
            result = self.service.process_url(
                "https://example.com/watch", interactive=False, task_id="t2",
                output_dir=self.tmpdir,
            )

        self.assertFalse(result)
        self.assertEqual(self.service.history.get_task("t2")["status"], "cancelled")

    def test_no_task_id_skips_cancel_bookkeeping(self):
        """CLI/desktop callers pass no task_id; cancel logic must be a no-op."""
        self.assertFalse(self.service._is_cancel_requested(None))

if __name__ == '__main__':
    unittest.main()
