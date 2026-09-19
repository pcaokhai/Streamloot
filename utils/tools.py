"""
Tìm và kiểm tra các công cụ ngoài: yt-dlp, ffmpeg, Chromium.

Trước đây cả ba được nhúng thẳng vào `.app`, khiến bản build nặng 482 MB mà
359 MB trong đó là Chromium — thứ chỉ dùng cho một đường duy nhất (dán URL vào
app, với vài site cần vượt Cloudflare). Xem
`docs/2026-09-19-danh-gia-lai-kien-truc.md`.

Giờ chúng được tải về lúc chạy, vào thư mục ghi được của người dùng. Module này
chỉ lo TÌM và ĐÁNH GIÁ; phần tải nằm ở `services/tool_installer.py`.

Thứ tự tìm, và lý do:
 1. Bản nhúng trong bundle — nếu build vẫn nhúng thì đó là bản ta tự chọn, tin được nhất.
 2. Bản đã tải về — do chính ta tải, phiên bản đã biết.
 3. Bản của hệ thống (PATH) — không kiểm soát được phiên bản, nhưng có còn hơn không.
"""
import os
import platform
import shutil
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional

from utils import paths

#: yt-dlp và ffmpeg là BẮT BUỘC — thiếu là không tải được gì.
#: Chromium là TUỲ CHỌN — chỉ cần cho đường dán-URL ở vài site.
REQUIRED = ("yt-dlp", "ffmpeg")
OPTIONAL = ("chromium",)


class ToolStatus(NamedTuple):
    name: str
    path: Optional[str]
    #: 'bundled' | 'downloaded' | 'system' | None
    source: Optional[str]
    required: bool

    @property
    def found(self) -> bool:
        return self.path is not None


def tools_dir() -> Path:
    """Nơi chứa công cụ tải về. Ghi được, nằm ngoài bundle chỉ-đọc."""
    d = paths.user_data_dir() / "tools"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ffmpeg_asset(machine: Optional[str] = None) -> str:
    """
    Tên asset ffmpeg-static ứng với kiến trúc máy.

    Tải nhầm kiến trúc thì binary chạy được trên máy build mà chết trên máy
    người dùng — đúng lỗi đã gặp một lần (nhật ký thử tay #8).
    """
    m = (machine or platform.machine()).lower()
    return "ffmpeg-darwin-arm64" if m in ("arm64", "aarch64") else "ffmpeg-darwin-x64"


def _chromium_exe(root: Path) -> Path:
    """Đường dẫn tới file thực thi bên trong bản Chrome for Testing đã giải nén."""
    return root / "Google Chrome for Testing.app" / "Contents" / "MacOS" / "Google Chrome for Testing"


def find(name: str) -> ToolStatus:
    """Tìm một công cụ theo thứ tự ưu tiên ở đầu file."""
    required = name in REQUIRED

    if name == "chromium":
        bundled = paths.bundled_chrome_path()
        if bundled:
            return ToolStatus(name, str(bundled), "bundled", required)
        downloaded = _chromium_exe(tools_dir() / "chrome")
        if downloaded.exists():
            return ToolStatus(name, str(downloaded), "downloaded", required)
        return ToolStatus(name, None, None, required)

    bundled = paths.bundled_bin_dir() / name
    if bundled.exists() and os.access(bundled, os.X_OK):
        return ToolStatus(name, str(bundled), "bundled", required)

    downloaded = tools_dir() / name
    if downloaded.exists() and os.access(downloaded, os.X_OK):
        return ToolStatus(name, str(downloaded), "downloaded", required)

    on_path = shutil.which(name)
    if on_path:
        return ToolStatus(name, on_path, "system", required)

    return ToolStatus(name, None, None, required)


def status_all() -> List[ToolStatus]:
    return [find(n) for n in (*REQUIRED, *OPTIONAL)]


def missing_required(statuses: Optional[List[ToolStatus]] = None) -> List[str]:
    """
    Công cụ BẮT BUỘC còn thiếu. Rỗng nghĩa là tải được.

    Tách riêng khỏi `missing_optional` vì hai nhóm này dẫn tới hai hành vi khác
    hẳn nhau: thiếu bắt buộc thì phải chặn và mời cài; thiếu tuỳ chọn thì chỉ
    ảnh hưởng một đường, không được phép chặn app.
    """
    return [s.name for s in (statuses or status_all()) if s.required and not s.found]


def missing_optional(statuses: Optional[List[ToolStatus]] = None) -> List[str]:
    return [s.name for s in (statuses or status_all()) if not s.required and not s.found]


def as_dict(statuses: Optional[List[ToolStatus]] = None) -> Dict[str, dict]:
    """Hình dạng cho API/giao diện."""
    return {
        s.name: {"found": s.found, "source": s.source, "required": s.required}
        for s in (statuses or status_all())
    }
