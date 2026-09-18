"""
Đọc tiến trình từ output của yt-dlp.

Tách khỏi `downloaders/ytdlp.py` để TEST ĐƯỢC: phần này toàn quyết định (đang ở
phần mấy, phần trăm chung là bao nhiêu, trạng thái nào) còn phần kia là vòng
đọc tiến trình con — không gọi riêng được.

Hai chuyện yt-dlp làm mà bản đọc cũ không lường:

1. **Tiến trình được in bằng `\\r`, không phải `\\n`.** Một "dòng" đọc ra từ
   stdout có thể chứa hàng chục lần cập nhật dính liền nhau. Lấy match ĐẦU tiên
   trong khối đó là luôn báo con số cũ nhất — thanh tiến trình nhảy lùi và trông
   như đang treo.

2. **Một lượt tải có thể gồm NHIỀU PHẦN.** Từ khi ghép tiếng vào hình
   (`<id>+bestaudio`), yt-dlp tải hình xong rồi tải tiếng, mỗi phần chạy 0→100%
   riêng. Báo thẳng phần trăm của từng phần ra giao diện thì người dùng thấy
   chạy tới 100% rồi tụt về 0 — đúng cái "loop" đã gặp.
"""
import re
import time
from typing import Optional

_PROGRESS = re.compile(
    r'\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d\.]+\w+)\s+at\s+([\w\./\s]+?)\s+ETA\s+([\d:]+|\w+)'
)
_FORMATS = re.compile(r'Downloading\s+\d+\s+format\(s\):\s*(\S+)')
_DESTINATION = re.compile(r'\[download\] Destination: ')


def split_updates(chunk: str) -> list:
    """Tách một khối stdout thành từng lần cập nhật. Bỏ đoạn rỗng."""
    return [p for p in re.split(r'[\r\n]+', chunk) if p.strip()]


def parts_from_format_line(line: str) -> Optional[int]:
    """
    Số phần sẽ tải, đọc từ dòng `Downloading N format(s): a+b`.

    `None` khi dòng này không nói về việc đó. Đếm theo dấu `+` chứ không theo N:
    N là số *video*, còn `a+b` mới là số *luồng* thực sự phải tải.
    """
    m = _FORMATS.search(line)
    if not m:
        return None
    return len([p for p in m.group(1).split('+') if p])


def overall_percent(part_index: int, parts: int, pct: float) -> float:
    """
    Phần trăm CHUNG của cả lượt tải.

    `part_index` đếm từ 1. Mỗi phần chiếm một khoảng bằng nhau — không chính xác
    tuyệt đối (luồng tiếng nhẹ hơn hình nhiều) nhưng đơn điệu tăng, mà đó mới là
    thứ người dùng cần: thanh tiến trình không bao giờ tụt lùi.
    """
    if parts <= 1:
        return max(0.0, min(100.0, pct))
    i = max(1, min(parts, part_index))
    return max(0.0, min(100.0, ((i - 1) + pct / 100.0) / parts * 100.0))


#: Khoảng cách tối thiểu giữa hai lần báo tiến trình, giây.
#:
#: Đo thật: một lượt tải 17 giây sinh 2563 dòng tiến trình. Mỗi lần báo là một
#: lần ghi SQLite, nên báo hết là biến việc tải thành việc ghi DB — chính là
#: "chậm hơn" người dùng thấy. Mắt người không đọc nổi quá vài lần mỗi giây.
EMIT_INTERVAL_S = 0.4


class ProgressReader:
    """Giữ trạng thái giữa các dòng: đang ở phần mấy, tổng bao nhiêu phần."""

    def __init__(self, emit_interval: float = EMIT_INTERVAL_S):
        self.parts = 1
        self.part_index = 0
        self._emit_interval = emit_interval
        self._last_emit = 0.0
        self._max_pct = 0.0

    def note_line(self, line: str) -> None:
        """Cập nhật trạng thái từ một dòng không phải tiến trình."""
        n = parts_from_format_line(line)
        if n:
            self.parts = n
        if _DESTINATION.search(line):
            self.part_index += 1

    def progress(self, line: str) -> Optional[dict]:
        """
        Sự kiện tiến trình từ một dòng, hoặc `None` nếu dòng đó không phải tiến trình.
        """
        m = _PROGRESS.search(line)
        if not m:
            return None
        pct = float(m.group(1))
        # Không cho tụt lùi. yt-dlp tính phần trăm theo TỔNG SỐ ƯỚC LƯỢNG, mà ước
        # lượng đó đổi liên tục khi tải HLS theo mảnh — nên con số thật sự có lúc
        # nhỏ đi. Người dùng đọc đó là "đang chạy ngược".
        overall = overall_percent(self.part_index or 1, self.parts, pct)
        self._max_pct = max(self._max_pct, overall)
        return {
            "percent": self._max_pct,
            "size": m.group(2),
            "speed": m.group(3).strip(),
            "eta": m.group(4).strip(),
        }

    def is_last_part(self) -> bool:
        """Phần cuối đã xong chưa — chỉ lúc đó `100%` mới thật sự là 100%."""
        return self.part_index >= self.parts
    def should_emit(self, now: Optional[float] = None) -> bool:
        """
        Đã tới lúc báo tiến trình chưa.

        Gọi hàm này mới tính là đã báo — nó tự ghi lại mốc. Người gọi phải hỏi
        đúng một lần cho mỗi lần định báo.
        """
        t = time.monotonic() if now is None else now
        if t - self._last_emit < self._emit_interval:
            return False
        self._last_emit = t
        return True

    def force_next_emit(self) -> None:
        """Cho phép báo ngay lần tới, bỏ qua nhịp — dùng khi sang phần mới."""
        self._last_emit = 0.0
