"""
Đo thời lượng một playlist HLS.

Việc này phải nằm ở backend chứ không phải trong extension: `fetch` của trình
duyệt KHÔNG cho đặt `Referer` (nó nằm trong danh sách header bị cấm), mà CDN
phát video thường từ chối request thiếu Referer. Python thì đặt được, và đây
cũng chính là tiến trình vốn đã tải những manifest đó để lấy video về.

Dùng để tách phim khỏi quảng cáo khi một trang nạp nhiều stream cùng lúc.
"""
import re
from typing import Optional
from urllib.parse import urljoin

import requests

from utils.logger import Logger

_EXTINF = re.compile(r"#EXTINF:\s*([\d.]+)", re.IGNORECASE)
_MASTER = re.compile(r"#EXT-X-STREAM-INF", re.IGNORECASE)

#: Master playlist chỉ liệt kê các biến thể, không chứa #EXTINF — phải đi tiếp
#: vào một biến thể mới đo được. Chỉ đi đúng một tầng để không lạc vào vòng lặp.
_MAX_DEPTH = 1


def probe_duration(url: str, referer: Optional[str] = None,
                   user_agent: Optional[str] = None,
                   timeout: float = 6.0, _depth: int = 0) -> Optional[float]:
    """
    Tổng thời lượng của playlist, tính bằng giây. `None` khi không đo được.

    Không bao giờ ném: đo thời lượng chỉ để xếp hạng cho tốt hơn, hỏng nó không
    được phép làm hỏng việc tải.
    """
    if _depth > _MAX_DEPTH:
        return None

    headers = {}
    if referer:
        headers["Referer"] = referer
    if user_agent:
        headers["User-Agent"] = user_agent

    try:
        res = requests.get(url, headers=headers, timeout=timeout)
        if not res.ok:
            Logger.get_logger().debug(f"Đo thời lượng: {url} trả {res.status_code}")
            return None
        text = res.text
    except requests.RequestException as e:
        Logger.get_logger().debug(f"Đo thời lượng hỏng cho {url}: {e}")
        return None

    if _MASTER.search(text):
        variant = _first_variant(text)
        if not variant:
            return None
        return probe_duration(urljoin(url, variant), referer, user_agent,
                              timeout, _depth + 1)

    total = sum(float(m) for m in _EXTINF.findall(text))
    return total if total > 0 else None


def _first_variant(text: str) -> Optional[str]:
    """URL của biến thể đầu tiên trong master playlist (có thể là đường dẫn tương đối)."""
    lines = [l.strip() for l in text.splitlines()]
    for i, line in enumerate(lines):
        if _MASTER.match(line):
            for nxt in lines[i + 1:]:
                if nxt and not nxt.startswith("#"):
                    return nxt
    return None
