import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.manifest_probe import probe_duration, _first_variant

MEDIA = """#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,
seg0.ts
#EXTINF:9.009,
seg1.ts
#EXTINF:3.5,
seg2.ts
#EXT-X-ENDLIST"""

MASTER = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720
720p/index.m3u8"""


def _res(text, ok=True, status=200):
    m = MagicMock()
    m.ok = ok
    m.status_code = status
    m.text = text
    return m


class TestProbeDuration(unittest.TestCase):
    """Đây là tín hiệu tách phim khỏi quảng cáo, nên nó phải đúng và không ném."""

    def test_sums_media_playlist(self):
        with patch("services.manifest_probe.requests.get", return_value=_res(MEDIA)):
            self.assertAlmostEqual(probe_duration("https://cdn.test/v.m3u8"), 21.518, places=3)

    def test_follows_master_into_first_variant(self):
        calls = []

        def fake_get(url, **kw):
            calls.append(url)
            return _res(MASTER if len(calls) == 1 else MEDIA)

        with patch("services.manifest_probe.requests.get", side_effect=fake_get):
            got = probe_duration("https://cdn.test/dir/master.m3u8")
        self.assertAlmostEqual(got, 21.518, places=3)
        # Đường dẫn tương đối phải được giải theo URL của master.
        self.assertEqual(calls[1], "https://cdn.test/dir/360p/index.m3u8")

    def test_sends_referer_which_is_the_whole_point(self):
        """`fetch` của trình duyệt không đặt được Referer — đó là lý do hàm này ở backend."""
        with patch("services.manifest_probe.requests.get", return_value=_res(MEDIA)) as get:
            probe_duration("https://cdn.test/v.m3u8", referer="https://page.test/watch/1")
        self.assertEqual(get.call_args.kwargs["headers"]["Referer"], "https://page.test/watch/1")

    def test_returns_none_on_http_error(self):
        with patch("services.manifest_probe.requests.get", return_value=_res("", ok=False, status=403)):
            self.assertIsNone(probe_duration("https://cdn.test/v.m3u8"))

    def test_never_raises_on_network_failure(self):
        import requests as r

        with patch("services.manifest_probe.requests.get", side_effect=r.Timeout("boom")):
            self.assertIsNone(probe_duration("https://cdn.test/v.m3u8"))

    def test_master_pointing_at_master_stops_instead_of_looping(self):
        with patch("services.manifest_probe.requests.get", return_value=_res(MASTER)):
            self.assertIsNone(probe_duration("https://cdn.test/v.m3u8"))

    def test_playlist_without_segments_is_none_not_zero(self):
        with patch("services.manifest_probe.requests.get", return_value=_res("#EXTM3U\n")):
            self.assertIsNone(probe_duration("https://cdn.test/v.m3u8"))

    def test_first_variant_skips_comment_lines(self):
        self.assertEqual(_first_variant(MASTER), "360p/index.m3u8")


if __name__ == "__main__":
    unittest.main()
