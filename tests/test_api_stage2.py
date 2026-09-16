import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# apps/api/main.py đọc API_KEY lúc import — phải đặt trước.
os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import HTTPException

from apps.api import main as api_main
from core.models import VideoInfo

PAYLOAD = {
    "title": "Sample",
    "m3u8_url": "https://cdn.example.com/master.m3u8",
    "page_url": "https://example.com/watch/1",
    "referer": "https://example.com/",
    "origin": "https://example.com",
    "user_agent": "UA/1.0",
}


def run(coro):
    return asyncio.run(coro)


class TestPreparedDownload(unittest.TestCase):
    """B1 — tải từ VideoInfo client dựng sẵn, bỏ qua extract phía server."""

    def test_payload_maps_onto_core_video_info(self):
        """
        Hợp đồng giữa hai ngôn ngữ (ADR 0006 §4.1): thêm field bên Python mà quên
        bên payload thì lỗi chỉ lộ lúc chạy.
        """
        vi = api_main.VideoInfoPayload(**PAYLOAD).to_video_info()
        self.assertIsInstance(vi, VideoInfo)
        self.assertEqual(vi.referer, "https://example.com/")
        self.assertEqual(vi.m3u8_url, PAYLOAD["m3u8_url"])

    def test_prepared_path_sends_no_cookies(self):
        """
        B14 (§7.3): đo được rằng mọi host phục vụ byte media đều không nhận
        cookie, nên đường extension không mang cookie và extension khỏi phải xin
        quyền `cookies` của Chrome. Trường vẫn còn cho đường headless dùng.
        """
        vi = api_main.VideoInfoPayload(**PAYLOAD).to_video_info()
        self.assertIsNone(vi.cookies)
        self.assertFalse(hasattr(api_main.VideoInfoPayload, "cookies"))

    def test_starts_task_without_calling_extractor(self):
        req = api_main.PreparedDownloadRequest(video_info=api_main.VideoInfoPayload(**PAYLOAD))
        bg = MagicMock()
        with patch.object(api_main.history, "create_task"), \
             patch.object(api_main.ExtractorFactory, "get_extractor") as get_extractor:
            result = run(api_main.start_prepared_download(req, bg))

        self.assertIn("task_id", result)
        self.assertTrue(result["stream_token"])
        bg.add_task.assert_called_once()
        # Lý do endpoint này tồn tại: KHÔNG extract lại.
        get_extractor.assert_not_called()

    def test_service_can_download_from_prepared_infos(self):
        """B1 phía service: process_video_infos tải mà không đụng ExtractorFactory."""
        from services.download_service import DownloadService

        svc = DownloadService()
        vi = api_main.VideoInfoPayload(**PAYLOAD).to_video_info()
        with patch.object(svc.downloader, "download", return_value="/tmp/out.mp4") as dl, \
             patch("services.download_service.sync_archive_with_disk"), \
             patch("services.download_service.is_video_on_disk", return_value=False), \
             patch.object(api_main.ExtractorFactory, "get_extractor") as get_extractor:
            ok = svc.process_video_infos([vi], interactive=False)

        self.assertTrue(ok)
        dl.assert_called_once()
        get_extractor.assert_not_called()


class TestStreamToken(unittest.TestCase):
    """B13 — siết xác thực cho luồng SSE."""

    def test_token_is_single_use(self):
        token = api_main.issue_stream_token("task-1")
        self.assertTrue(api_main.consume_stream_token("task-1", token))
        # Lần hai phải trượt: token rò ra mà dùng lại được mãi thì vô nghĩa.
        self.assertFalse(api_main.consume_stream_token("task-1", token))

    def test_token_is_bound_to_its_task(self):
        token = api_main.issue_stream_token("task-2")
        self.assertFalse(api_main.consume_stream_token("task-other", token))

    def test_missing_or_wrong_token_rejected(self):
        api_main.issue_stream_token("task-3")
        self.assertFalse(api_main.consume_stream_token("task-3", None))
        self.assertFalse(api_main.consume_stream_token("task-3", "wrong"))

    def test_stream_endpoint_rejects_bad_token(self):
        with self.assertRaises(HTTPException) as ctx:
            run(api_main.stream_progress("task-4", token="nope", authorization=None, origin=None))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_stream_accepts_bearer_header(self):
        """
        MV3 service worker không có EventSource, nên extension buộc dùng fetch —
        và fetch set được header. Đường này phải hoạt động, nếu không extension
        không nhận được tiến trình.
        """
        res = run(api_main.stream_progress(
            "task-5", token=None, authorization=f"Bearer {os.environ['API_KEY']}", origin=None
        ))
        self.assertIsNotNone(res)

    def test_bearer_header_does_not_consume_the_token(self):
        """Client fetch nối lại stream nhiều lần được; token vẫn nguyên cho client khác."""
        token = api_main.issue_stream_token("task-6")
        run(api_main.stream_progress(
            "task-6", token=None, authorization=f"Bearer {os.environ['API_KEY']}", origin=None
        ))
        self.assertTrue(api_main.consume_stream_token("task-6", token))

    def test_stream_rejects_wrong_bearer(self):
        with self.assertRaises(HTTPException) as ctx:
            run(api_main.stream_progress("task-7", token=None, authorization="Bearer wrong", origin=None))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_refresh_rejects_unknown_task(self):
        with patch.object(api_main.history, "get_task", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                api_main.refresh_stream_token("nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_refresh_rejects_finished_task(self):
        with patch.object(api_main.history, "get_task", return_value={"status": "completed"}):
            with self.assertRaises(HTTPException) as ctx:
                api_main.refresh_stream_token("done")
        self.assertEqual(ctx.exception.status_code, 409)

    def test_refresh_issues_usable_token_for_running_task(self):
        """Đường khôi phục sau khi mở lại app — token cũ đã tiêu, phải xin được cái mới."""
        with patch.object(api_main.history, "get_task", return_value={"status": "downloading"}):
            out = api_main.refresh_stream_token("live")
        self.assertTrue(api_main.consume_stream_token("live", out["stream_token"]))


class TestOriginAuth(unittest.TestCase):
    """
    Xác thực qua `Origin` cho extension — bỏ được bước dán API key.

    An toàn với đúng mô hình đe dọa của ADR 0004 (trang web độc hại gọi ngầm tới
    localhost): trình duyệt LUÔN tự đặt Origin và JS của trang không ghi đè được.
    """

    OFFICIAL = f"chrome-extension://{api_main.OFFICIAL_EXTENSION_ID}"

    def test_official_extension_origin_is_accepted(self):
        self.assertEqual(api_main.verify_client(credentials=None, origin=self.OFFICIAL), "extension")

    def test_valid_api_key_still_accepted(self):
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=os.environ["API_KEY"])
        self.assertEqual(api_main.verify_client(credentials=creds, origin=None), "api-key")

    def test_web_page_origin_is_rejected(self):
        """Đây là đe dọa chính: một trang web bất kỳ gọi ngầm tới localhost."""
        with self.assertRaises(HTTPException) as ctx:
            api_main.verify_client(credentials=None, origin="https://evil.example.com")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_other_extension_origin_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            api_main.verify_client(credentials=None, origin="chrome-extension://someotherextension")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_no_credentials_at_all_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            api_main.verify_client(credentials=None, origin=None)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_wrong_api_key_rejected(self):
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrong")
        with self.assertRaises(HTTPException) as ctx:
            api_main.verify_client(credentials=creds, origin=None)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_stream_accepts_official_origin(self):
        res = run(api_main.stream_progress(
            "task-origin", token=None, authorization=None, origin=self.OFFICIAL
        ))
        self.assertIsNotNone(res)

    def test_stream_rejects_web_origin(self):
        with self.assertRaises(HTTPException) as ctx:
            run(api_main.stream_progress(
                "task-evil", token=None, authorization=None, origin="https://evil.example.com"
            ))
        self.assertEqual(ctx.exception.status_code, 401)


class TestExtensionCors(unittest.TestCase):
    """B5 — allowlist origin của extension."""

    def test_bare_id_is_normalised_to_an_origin(self):
        ids = ["abcdefghijklmnop", "chrome-extension://already"]
        origins = [
            i if i.startswith("chrome-extension://") else f"chrome-extension://{i}"
            for i in ids
        ]
        self.assertEqual(
            origins,
            ["chrome-extension://abcdefghijklmnop", "chrome-extension://already"],
        )

    def test_no_wildcard_extension_origin_configured(self):
        """
        Cố ý KHÔNG dùng allow_origin_regex 'chrome-extension://.*': như thế bất kỳ
        extension nào người dùng cài cũng gọi được backend này.
        """
        for origin in api_main._allowed_origins:
            self.assertNotIn("*", origin)


if __name__ == "__main__":
    unittest.main()
