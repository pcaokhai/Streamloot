import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.ytdlp_progress import (
    ProgressReader, overall_percent, parts_from_format_line, split_updates,
)

# Khối thật do yt-dlp in ra: các lần cập nhật dính liền bằng \r, không có \n.
BLOB = (
    "[download]   0.6% of ~ 117.03KiB at    1.24KiB/s ETA Unknown (frag 0/160)\r"
    "[download]  12.5% of ~  28.00MiB at    2.60MiB/s ETA 00:12 (frag 20/160)\r"
    "[download]  48.2% of ~  28.55MiB at    3.10MiB/s ETA 00:06 (frag 77/160)"
)


class TestSplitUpdates(unittest.TestCase):
    """Không tách thì lấy match đầu tiên = luôn báo con số CŨ NHẤT trong khối."""

    def test_splits_carriage_return_blob(self):
        self.assertEqual(len(split_updates(BLOB)), 3)

    def test_drops_empty_segments(self):
        self.assertEqual(split_updates("\r\n  \r\n"), [])

    def test_last_update_is_the_newest(self):
        r = ProgressReader()
        last = [r.progress(p) for p in split_updates(BLOB)][-1]
        self.assertAlmostEqual(last["percent"], 48.2, places=1)


class TestParts(unittest.TestCase):
    def test_counts_streams_not_videos(self):
        line = "[info] abc: Downloading 1 format(s): hls-687+hls-default-audio-group-128k"
        self.assertEqual(parts_from_format_line(line), 2)

    def test_single_stream(self):
        self.assertEqual(parts_from_format_line("[info] abc: Downloading 1 format(s): 18"), 1)

    def test_unrelated_line(self):
        self.assertIsNone(parts_from_format_line("[download] Destination: /tmp/x.mp4"))


class TestOverallPercent(unittest.TestCase):
    """Thanh tiến trình KHÔNG BAO GIỜ được tụt lùi — đó là cả điểm của việc này."""

    def test_single_part_passes_through(self):
        self.assertEqual(overall_percent(1, 1, 42.0), 42.0)

    def test_first_of_two_parts_maps_to_first_half(self):
        self.assertEqual(overall_percent(1, 2, 100.0), 50.0)

    def test_second_part_continues_instead_of_resetting(self):
        self.assertEqual(overall_percent(2, 2, 0.0), 50.0)
        self.assertEqual(overall_percent(2, 2, 100.0), 100.0)

    def test_never_goes_backwards_across_a_part_boundary(self):
        end_of_first = overall_percent(1, 2, 100.0)
        start_of_second = overall_percent(2, 2, 0.0)
        self.assertGreaterEqual(start_of_second, end_of_first)

    def test_clamps_out_of_range(self):
        self.assertEqual(overall_percent(9, 2, 150.0), 100.0)
        self.assertEqual(overall_percent(0, 2, -5.0), 0.0)


class TestProgressReaderFlow(unittest.TestCase):
    def test_two_part_download_reads_as_one_rising_bar(self):
        r = ProgressReader()
        seen = []
        script = [
            "[info] abc: Downloading 1 format(s): hls-687+hls-default-audio-group-128k",
            "[hlsnative] Downloading m3u8 manifest",
            "[download] Destination: /tmp/t.fhls-687.mp4",
            "[download]  50.0% of ~ 28.00MiB at 3.00MiB/s ETA 00:10",
            "[download] 100.0% of ~ 28.00MiB at 3.00MiB/s ETA 00:00",
            "[download] Destination: /tmp/t.fhls-audio.m4a",
            "[download]  50.0% of ~ 2.00MiB at 3.00MiB/s ETA 00:01",
            "[download] 100.0% of ~ 2.00MiB at 3.00MiB/s ETA 00:00",
        ]
        for line in script:
            ev = r.progress(line)
            if ev:
                seen.append(round(ev["percent"], 1))
            else:
                r.note_line(line)
        self.assertEqual(seen, [25.0, 50.0, 75.0, 100.0])
        self.assertEqual(seen, sorted(seen), "tiến trình không được tụt lùi")

    def test_last_part_only_counts_as_done_at_the_end(self):
        r = ProgressReader()
        r.note_line("[info] x: Downloading 1 format(s): a+b")
        r.note_line("[download] Destination: /tmp/a.mp4")
        self.assertFalse(r.is_last_part())
        r.note_line("[download] Destination: /tmp/b.m4a")
        self.assertTrue(r.is_last_part())

    def test_single_part_download_is_unchanged(self):
        r = ProgressReader()
        r.note_line("[info] x: Downloading 1 format(s): 18")
        r.note_line("[download] Destination: /tmp/a.mp4")
        self.assertAlmostEqual(r.progress("[download]  33.0% of ~ 5MiB at 1MiB/s ETA 00:05")["percent"], 33.0)
        self.assertTrue(r.is_last_part())

    def test_speed_and_eta_survive(self):
        r = ProgressReader()
        ev = r.progress("[download]  10.0% of ~ 5.00MiB at  2.50MiB/s ETA 00:09")
        self.assertEqual(ev["speed"], "2.50MiB/s")
        self.assertEqual(ev["eta"], "00:09")


if __name__ == "__main__":
    unittest.main()


class TestDownloadLoopIntegration(unittest.TestCase):
    """
    Chạy vòng đọc THẬT của download() trên output thật của yt-dlp, để bắt đúng
    cái người dùng thấy: trạng thái nhấp nháy downloading <-> processing và
    thanh tiến trình tụt về 0 giữa chừng.
    """

    def _statuses(self, chunks):
        import subprocess as sp
        from unittest.mock import patch
        from core.models import VideoInfo
        from downloaders.ytdlp import YtDlpDownloader

        events = []

        class FakeProc:
            returncode = 0

            def __init__(self):
                self.stdout = iter(chunks)

            def wait(self):
                return 0

        with patch.object(sp, "Popen", lambda *a, **kw: FakeProc()):
            YtDlpDownloader().download(
                VideoInfo(title="X", m3u8_url="https://s.test/v", page_url="https://s.test/v"),
                output_dir="/tmp/streamloot-test-out",
                progress_callback=events.append,
            )
        return events

    def test_two_part_download_never_flips_back_to_downloading_after_finalizing(self):
        chunks = [
            "[info] x: Downloading 1 format(s): hls-687+hls-audio\n",
            "[download] Destination: /tmp/t.f1.mp4\n",
            "[download]  50.0% of ~ 28.00MiB at 3.00MiB/s ETA 00:10\r"
            "[download] 100.0% of ~ 28.00MiB at 3.00MiB/s ETA 00:00\n",
            "[download] 100% of 28.00MiB\n",
            "[download] Destination: /tmp/t.f2.m4a\n",
            "[download]  50.0% of ~ 2.00MiB at 3.00MiB/s ETA 00:01\n",
            "[download] 100% of 2.00MiB\n",
            '[Merger] Merging formats into "/tmp/t.mp4"\n',
        ]
        seq = [e["status"] for e in self._statuses(chunks)]
        # Sau khi báo "processing" thì KHÔNG được quay lại "downloading".
        if "processing" in seq:
            first = seq.index("processing")
            self.assertNotIn("downloading", seq[first:],
                             f"trạng thái nhấp nháy: {seq}")

    def test_percent_never_goes_backwards(self):
        chunks = [
            "[info] x: Downloading 1 format(s): a+b\n",
            "[download] Destination: /tmp/t.f1.mp4\n",
            "[download]  40.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:10\n",
            "[download] 100.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:00\n",
            "[download] Destination: /tmp/t.f2.m4a\n",
            "[download]  10.0% of ~ 1.00MiB at 1.00MiB/s ETA 00:01\n",
            "[download]  90.0% of ~ 1.00MiB at 1.00MiB/s ETA 00:00\n",
        ]
        pcts = [e["completed"] for e in self._statuses(chunks) if e["status"] == "downloading"]
        self.assertEqual(pcts, sorted(pcts), f"tiến trình tụt lùi: {pcts}")

    def test_mid_download_info_line_does_not_reset_to_zero(self):
        chunks = [
            "[info] x: Downloading 1 format(s): a\n",
            "[download] Destination: /tmp/t.mp4\n",
            "[download]  70.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:03\n",
            "[info] x: something mid-flight\n",
        ]
        seq = [e["status"] for e in self._statuses(chunks)]
        # "extracting" lúc ĐẦU là đúng; sau khi đã tải rồi mới là sai.
        after = seq[seq.index("downloading"):]
        self.assertNotIn("extracting", after,
                         f"dòng [info] giữa chừng kéo tiến trình về 0: {seq}")

    def test_one_callback_per_chunk_not_per_update(self):
        """Mỗi callback ghi DB; một lượt tải sinh hàng nghìn dòng tiến trình."""
        blob = "".join(
            f"[download]  {i}.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:10\r" for i in range(1, 60)
        )
        chunks = ["[download] Destination: /tmp/t.mp4\n", blob + "\n"]
        evs = [e for e in self._statuses(chunks) if e["status"] == "downloading"]
        self.assertEqual(len(evs), 1)
        self.assertAlmostEqual(evs[0]["completed"], 59.0, places=1)


class TestEmitThrottle(unittest.TestCase):
    """2563 lần báo cho một lượt tải 17 giây = 2563 lần ghi SQLite."""

    def test_first_emit_passes(self):
        self.assertTrue(ProgressReader().should_emit(now=100.0))

    def test_second_emit_too_soon_is_blocked(self):
        r = ProgressReader(emit_interval=0.4)
        r.should_emit(now=100.0)
        self.assertFalse(r.should_emit(now=100.1))

    def test_emit_allowed_after_the_interval(self):
        r = ProgressReader(emit_interval=0.4)
        r.should_emit(now=100.0)
        self.assertTrue(r.should_emit(now=100.5))

    def test_force_lets_the_next_one_through(self):
        r = ProgressReader(emit_interval=0.4)
        r.should_emit(now=100.0)
        r.force_next_emit()
        self.assertTrue(r.should_emit(now=100.1))

    def test_percent_never_decreases_even_when_ytdlp_estimate_shrinks(self):
        """yt-dlp tính % theo tổng ƯỚC LƯỢNG, mà ước lượng đổi liên tục."""
        r = ProgressReader()
        r.note_line("[download] Destination: /tmp/a.mp4")
        a = r.progress("[download]  30.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:05")["percent"]
        b = r.progress("[download]  22.0% of ~ 14.00MiB at 1.00MiB/s ETA 00:09")["percent"]
        self.assertGreaterEqual(b, a)
