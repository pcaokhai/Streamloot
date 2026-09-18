"""
Nhớ kết quả `yt-dlp -J` giữa bước LIỆT KÊ format và bước TẢI.

Vì sao cần: đường "tải theo URL trang" chạy yt-dlp hai lần cho một lượt tải —
một lần để liệt kê chất lượng, một lần nữa khi tải thật (yt-dlp tự extract lại
từ đầu). Đo thật: mỗi lần extract tốn 1.4s trên một site tin tức và 3.0s trên
YouTube, tức 3–6 giây người dùng ngồi chờ đúng một việc làm hai lần.

`yt-dlp --load-info-json` nhận lại kết quả đó và bỏ qua hẳn bước extract — đo
được 0.30s thay vì 1.44s.

**Dùng MỘT LẦN rồi bỏ.** Đây là quyết định an toàn, không phải tiết kiệm bộ nhớ:
URL trong info có chữ ký và hết hạn. Nếu một mục cũ làm lượt tải hỏng, lần thử
lại sẽ không còn mục nào để dùng nên tự động đi đường extract bình thường — tự
lành, không cần cơ chế thử lại nào trong vòng chạy tải.
"""
import threading
import time
from typing import Dict, Optional, Tuple

#: Ngắn có chủ đích. Khoảng cách thật giữa "hiện danh sách" và "người dùng bấm"
#: là vài giây; để dài chỉ tăng khả năng dùng phải URL đã hết hạn.
TTL_SECONDS = 300.0

#: Info của YouTube nặng ~650KB. Giữ vài mục là đủ cho thao tác thật (mở một
#: trang, chọn một chất lượng), còn giữ nhiều chỉ tốn RAM của service.
MAX_ENTRIES = 4


class InfoCache:
    """An toàn khi gọi từ nhiều luồng: endpoint chạy ở threadpool, còn lượt tải
    chạy ở background task — hai luồng khác nhau chạm cùng một dict."""

    def __init__(self, ttl: float = TTL_SECONDS, max_entries: int = MAX_ENTRIES):
        self._ttl = ttl
        self._max = max_entries
        self._lock = threading.Lock()
        self._data: Dict[str, Tuple[float, str]] = {}

    def put(self, url: str, info_json: str) -> None:
        if not url or not info_json:
            return
        with self._lock:
            self._purge_locked()
            if len(self._data) >= self._max:
                # Bỏ mục cũ nhất. dict giữ thứ tự chèn nên phần tử đầu là cũ nhất.
                self._data.pop(next(iter(self._data)))
            self._data[url] = (time.monotonic() + self._ttl, info_json)

    def take(self, url: str) -> Optional[str]:
        """Lấy VÀ XOÁ. `None` khi không có hoặc đã hết hạn."""
        with self._lock:
            self._purge_locked()
            hit = self._data.pop(url, None)
        return hit[1] if hit else None

    def _purge_locked(self) -> None:
        now = time.monotonic()
        for k in [k for k, (exp, _) in self._data.items() if exp <= now]:
            self._data.pop(k, None)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


#: Một bản dùng chung cho cả tiến trình.
info_cache = InfoCache()
