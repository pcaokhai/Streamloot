import sys
import time
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from utils.info_cache import InfoCache


class TestInfoCache(unittest.TestCase):
    """
    Nhớ kết quả extract giữa bước liệt kê format và bước tải, để không chạy
    yt-dlp hai lần cho cùng một việc (đo: 1.4s -> 0.3s).
    """

    def test_stores_and_returns(self):
        c = InfoCache()
        c.put("https://a.test/v", '{"x":1}')
        self.assertEqual(c.take("https://a.test/v"), '{"x":1}')

    def test_take_removes_so_a_retry_re_extracts(self):
        """
        Dùng MỘT LẦN là chốt an toàn, không phải tối ưu bộ nhớ: info chứa URL có
        chữ ký và hết hạn. Mục cũ làm hỏng lượt tải thì lần thử lại phải tự đi
        đường extract bình thường.
        """
        c = InfoCache()
        c.put("https://a.test/v", '{"x":1}')
        c.take("https://a.test/v")
        self.assertIsNone(c.take("https://a.test/v"))

    def test_miss_returns_none_not_empty_string(self):
        """`None` và `''` phải phân biệt được: một cái là 'không có', một cái là dữ liệu."""
        self.assertIsNone(InfoCache().take("https://chua-co.test/v"))

    def test_expired_entry_is_not_served(self):
        c = InfoCache(ttl=-1.0)
        c.put("https://a.test/v", '{"x":1}')
        self.assertIsNone(c.take("https://a.test/v"))

    def test_evicts_oldest_when_full(self):
        c = InfoCache(max_entries=2)
        for i in range(3):
            c.put(f"https://a.test/{i}", str(i))
        self.assertIsNone(c.take("https://a.test/0"))
        self.assertEqual(c.take("https://a.test/2"), "2")

    def test_empty_values_are_ignored(self):
        """Nhớ một info rỗng rồi tải bằng nó là hỏng lượt tải mà không rõ vì sao."""
        c = InfoCache()
        c.put("https://a.test/v", "")
        c.put("", '{"x":1}')
        self.assertIsNone(c.take("https://a.test/v"))

    def test_keys_do_not_collide(self):
        c = InfoCache()
        c.put("https://a.test/v1", "một")
        c.put("https://a.test/v2", "hai")
        self.assertEqual(c.take("https://a.test/v2"), "hai")
        self.assertEqual(c.take("https://a.test/v1"), "một")

    def test_concurrent_use_does_not_double_serve(self):
        """
        Endpoint chạy ở threadpool còn lượt tải chạy ở background task — hai
        luồng chạm cùng một dict. Không ai được nhận cùng một mục hai lần.
        """
        import threading

        c = InfoCache()
        c.put("https://a.test/v", "duy-nhat")
        got = []
        lock = threading.Lock()

        def worker():
            r = c.take("https://a.test/v")
            if r is not None:
                with lock:
                    got.append(r)

        ts = [threading.Thread(target=worker) for _ in range(20)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(len(got), 1)


if __name__ == "__main__":
    unittest.main()


class TestDownloadUsesCache(unittest.TestCase):
    """
    Kiểm ĐÚNG DÒNG LỆNH gửi cho yt-dlp. Chỉ kiểm "cache có dữ liệu" thì không
    chứng minh được gì: cache đầy mà download() không đọc thì vẫn chậm y như cũ.
    """

    def _run_download(self, seed_cache: bool):
        import subprocess as sp
        from unittest.mock import patch
        from core.models import VideoInfo
        from downloaders.ytdlp import YtDlpDownloader
        from utils.info_cache import info_cache

        info_cache.clear()
        url = "https://site.test/video/abc"
        if seed_cache:
            info_cache.put(url, '{"id":"abc","formats":[]}')

        captured = {}

        class FakeProc:
            stdout = iter(["[download] Destination: /tmp/x.mp4\n"])
            returncode = 0

            def wait(self):
                return 0

        def fake_popen(cmd, *a, **kw):
            captured["cmd"] = cmd
            return FakeProc()

        vi = VideoInfo(title="X", m3u8_url=url, page_url=url)
        with patch.object(sp, "Popen", fake_popen):
            YtDlpDownloader().download(vi, output_dir="/tmp/streamloot-test-out")
        return captured["cmd"]

    def test_uses_load_info_json_and_drops_the_url(self):
        cmd = self._run_download(seed_cache=True)
        self.assertIn("--load-info-json", cmd)
        # Truyền cả URL lẫn info-json là bảo yt-dlp extract lại — mất sạch cái lợi.
        self.assertNotIn("https://site.test/video/abc", cmd)

    def test_without_cache_passes_the_url_as_before(self):
        cmd = self._run_download(seed_cache=False)
        self.assertNotIn("--load-info-json", cmd)
        self.assertIn("https://site.test/video/abc", cmd)

    def test_temp_info_file_is_removed(self):
        import glob
        import tempfile as tf

        before = set(glob.glob(f"{tf.gettempdir()}/streamloot-info-*"))
        self._run_download(seed_cache=True)
        after = set(glob.glob(f"{tf.gettempdir()}/streamloot-info-*"))
        self.assertEqual(after - before, set())
