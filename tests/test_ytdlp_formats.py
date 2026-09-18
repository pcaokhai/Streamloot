import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from downloaders.ytdlp import YtDlpDownloader


class TestMergeableFormats(unittest.TestCase):
    """
    Luồng hình không tiếng mà trả format_id trần thì người dùng nhận video câm.
    Đo thật trên một site tin tức: master HLS tách tiếng thành rendition riêng,
    mọi biến thể hình đều acodec=none.
    """

    def test_video_only_gets_audio_merged(self):
        got = YtDlpDownloader._mergeable(
            {"format_id": "hls-973", "vcodec": "avc1.640029", "acodec": "none"}
        )
        self.assertEqual(got["format_id"], "hls-973+bestaudio/hls-973")

    def test_fallback_keeps_the_stream_when_nothing_to_merge(self):
        """Dấu `/` là đường lùi của yt-dlp: không có tiếng thì vẫn tải được hình."""
        got = YtDlpDownloader._mergeable(
            {"format_id": "hls-973", "vcodec": "avc1", "acodec": None}
        )
        self.assertTrue(got["format_id"].endswith("/hls-973"))

    def test_muxed_stream_is_left_alone(self):
        got = YtDlpDownloader._mergeable(
            {"format_id": "18", "vcodec": "avc1", "acodec": "mp4a.40.2"}
        )
        self.assertEqual(got["format_id"], "18")

    def test_audio_only_is_left_alone(self):
        """Ghép tiếng vào luồng tiếng là vô nghĩa và sẽ làm hỏng lựa chọn."""
        got = YtDlpDownloader._mergeable(
            {"format_id": "140", "vcodec": "none", "acodec": "mp4a.40.2"}
        )
        self.assertEqual(got["format_id"], "140")

    def test_other_fields_survive_untouched(self):
        src = {"format_id": "hls-1", "vcodec": "avc1", "acodec": "none",
               "height": 720, "ext": "mp4", "recommended": True}
        got = YtDlpDownloader._mergeable(src)
        self.assertEqual(got["height"], 720)
        self.assertEqual(got["ext"], "mp4")
        self.assertTrue(got["recommended"])

    def test_does_not_mutate_the_input(self):
        src = {"format_id": "hls-1", "vcodec": "avc1", "acodec": "none"}
        YtDlpDownloader._mergeable(src)
        self.assertEqual(src["format_id"], "hls-1")

    def test_missing_format_id_does_not_crash(self):
        got = YtDlpDownloader._mergeable({"format_id": None, "vcodec": "avc1", "acodec": "none"})
        self.assertIsNone(got["format_id"])


if __name__ == "__main__":
    unittest.main()


class TestPathFromLine(unittest.TestCase):
    """
    Đọc tên file thật từ output yt-dlp. Ba phép khớp này từng nằm lọt trong
    nhánh "extracting" nên không bao giờ chạy — đường dẫn lưu vào DB là mẫu
    "...%(ext)s" và "Hiện trong Finder" báo không tìm thấy file.
    """

    def test_reads_destination(self):
        got = YtDlpDownloader._path_from_line("[download] Destination: /tmp/Phim hay.mp4")
        self.assertEqual(got, "/tmp/Phim hay.mp4")

    def test_merger_line_wins_because_it_changes_the_extension(self):
        got = YtDlpDownloader._path_from_line('[Merger] Merging formats into "/tmp/Phim hay.mkv"')
        self.assertEqual(got, "/tmp/Phim hay.mkv")

    def test_reads_already_downloaded(self):
        got = YtDlpDownloader._path_from_line("[download] /tmp/cũ.mp4 has already been downloaded")
        self.assertEqual(got, "/tmp/cũ.mp4")

    def test_progress_line_says_nothing_about_the_name(self):
        self.assertIsNone(
            YtDlpDownloader._path_from_line("[download]  42.0% of ~10.00MiB at 1.00MiB/s ETA 00:10")
        )

    def test_extracting_line_says_nothing_about_the_name(self):
        """Đúng dòng mà khối này từng bị khoá vào — nó KHÔNG mang tên file."""
        self.assertIsNone(YtDlpDownloader._path_from_line("[info] Downloading webpage"))

    def test_blank_line(self):
        self.assertIsNone(YtDlpDownloader._path_from_line(""))
