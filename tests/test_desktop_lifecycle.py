import unittest

from webview.event import Event

from apps.desktop.main import close_verdict


class TestPywebviewCloseContract(unittest.TestCase):
    """
    Pin hợp đồng của pywebview mà B2 dựa vào.

    Hai điều dưới đây không có trong tài liệu ở chỗ dễ thấy, và cả hai đều hỏng
    âm thầm: nếu pywebview đổi ngữ nghĩa, đóng cửa sổ sẽ giết backend trở lại và
    không có lỗi nào được ném ra. Test này là thứ duy nhất báo động.
    """

    def test_returning_false_cancels_the_close(self):
        e = Event(None, True)
        e += lambda: False
        # set() trả True nghĩa là "huỷ đóng" — ngược với trực giác.
        self.assertTrue(e.set())

    def test_returning_true_does_not_cancel(self):
        e = Event(None, True)
        e += lambda: True
        self.assertFalse(e.set())

    def test_returning_none_does_not_cancel(self):
        e = Event(None, True)
        e += lambda: None
        self.assertFalse(e.set())

    def test_closing_event_is_locked(self):
        """
        `closing` bắt buộc phải được dựng với should_lock=True. Không có lock thì
        handler chạy ở thread khác và tập giá trị trả về còn rỗng lúc pywebview
        tính toán — việc huỷ đóng bị bỏ qua, im lặng.

        Khẳng định trên Window thật chứ không mô phỏng lại hành vi thread: chạy
        đua với thread cho ra test lúc xanh lúc đỏ, còn cờ này thì tất định.
        """
        import webview

        w = webview.create_window("lifecycle-contract-check", html="<p></p>", hidden=True)
        try:
            self.assertTrue(
                w.events.closing._should_lock,
                "pywebview đổi closing thành unlocked — B2 sẽ hỏng âm thầm",
            )
        finally:
            webview.windows.remove(w)


class TestCloseVerdict(unittest.TestCase):
    def test_normal_close_is_cancelled_so_backend_survives(self):
        # Đây là hành vi B2: đóng cửa sổ không được giết backend.
        self.assertIs(close_verdict(quitting=False), False)

    def test_explicit_quit_is_allowed_through(self):
        # Không có nhánh này thì NSApp.terminate_() bị chính handler chặn lại
        # và app không bao giờ thoát được.
        self.assertIsNone(close_verdict(quitting=True))


if __name__ == "__main__":
    unittest.main()
