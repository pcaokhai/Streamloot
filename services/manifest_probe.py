"""
Đo thời lượng một playlist HLS.

Việc này phải nằm ở backend chứ không phải trong extension: `fetch` của trình
duyệt KHÔNG cho đặt `Referer` (nó nằm trong danh sách header bị cấm), mà CDN
phát video thường từ chối request thiếu Referer. Python thì đặt được, và đây
cũng chính là tiến trình vốn đã tải những manifest đó để lấy video về.

Dùng để tách phim khỏi quảng cáo khi một trang nạp nhiều stream cùng lúc.
"""
import re
from typing import Dict, List, Optional
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


_ATTR = re.compile(r'([A-Z0-9-]+)=("([^"]*)"|[^,]*)')


def _stream_inf_attrs(line: str) -> Dict[str, str]:
    """Thuộc tính của một dòng #EXT-X-STREAM-INF, giá trị đã bỏ dấu nháy."""
    out = {}
    for key, raw, quoted in _ATTR.findall(line.split(":", 1)[1] if ":" in line else ""):
        out[key] = quoted if raw.startswith('"') else raw
    return out


def list_variants(url: str, referer: Optional[str] = None,
                  user_agent: Optional[str] = None,
                  timeout: float = 6.0) -> List[dict]:
    """
    Các biến thể trong một master playlist HLS, đọc thẳng từ #EXT-X-STREAM-INF.

    Đây là cách IDM/Cốc Cốc liệt kê chất lượng gần như tức thì: một GET và vài
    dòng regex, thay vì spawn yt-dlp (0.4s khởi động + tự tải master + tải thêm
    một biến thể để dò). Rỗng khi không phải master, lỗi mạng, hay không có
    biến thể — caller lùi về yt-dlp, không bao giờ ném.
    """
    headers = {}
    if referer:
        headers["Referer"] = referer
    if user_agent:
        headers["User-Agent"] = user_agent
    try:
        res = requests.get(url, headers=headers, timeout=timeout)
        if not res.ok:
            return []
        text = res.text
    except requests.RequestException as e:
        Logger.get_logger().debug(f"Liệt kê biến thể hỏng cho {url}: {e}")
        return []
    if not _MASTER.search(text):
        return []

    lines = [l.strip() for l in text.splitlines()]
    out: List[dict] = []
    for i, line in enumerate(lines):
        if not _MASTER.match(line):
            continue
        target = next((n for n in lines[i + 1:] if n and not n.startswith("#")), None)
        if not target:
            continue
        a = _stream_inf_attrs(line)
        width = height = None
        if "x" in a.get("RESOLUTION", ""):
            w, h = a["RESOLUTION"].lower().split("x", 1)
            if w.isdigit() and h.isdigit():
                width, height = int(w), int(h)
        codecs = a.get("CODECS", "")
        # Chỉ có codec âm thanh (mp4a/ac-3/ec-3) và không có RESOLUTION -> luồng tiếng.
        audio_only = height is None and bool(codecs) and all(
            c.strip().split(".")[0] in ("mp4a", "ac-3", "ec-3") for c in codecs.split(",")
        )
        bw = a.get("BANDWIDTH", "")
        out.append({
            "url": urljoin(url, target),
            "width": width,
            "height": height,
            "bandwidth": int(bw) if bw.isdigit() else None,
            "audio_only": audio_only,
        })
    return out


def variants_to_formats(variants: List[dict]) -> List[dict]:
    """
    Đổi biến thể manifest sang đúng hình dạng FormatOption mà list_formats của
    yt-dlp trả — để panel không phải biết danh sách đến từ đâu. Khác duy nhất:
    có thêm `url`; client tải bằng cách gửi URL biến thể làm m3u8_url, vì
    format_id kiểu `hls-<bandwidth>` của yt-dlp không ổn định giữa các lần chạy.
    """
    best = max((v["height"] or 0 for v in variants if not v["audio_only"]), default=0)
    out = []
    for v in variants:
        h = v["height"]
        out.append({
            "format_id": f"hls-{v['bandwidth']}" if v["bandwidth"] else "hls",
            "ext": "m4a" if v["audio_only"] else "mp4",
            "resolution": f"{v['width']}x{h}" if h else ("audio only" if v["audio_only"] else "unknown"),
            "height": h,
            "filesize": None,
            "vcodec": "none" if v["audio_only"] else "avc1",
            "acodec": "mp4a",
            "recommended": (not v["audio_only"]) and h == best and best > 0,
            "url": v["url"],
        })
    return out
