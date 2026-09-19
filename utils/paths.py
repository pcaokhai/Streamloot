"""
Runtime path resolution for both source runs and frozen .app bundles.

Every module that needs "where do I read bundled files" or "where do I write
state" routes through here. Nothing else in the codebase should call
Path(__file__).parent.parent to find the project root — inside a .app that
path points into the read-only bundle.
"""
import os
import sys
from pathlib import Path
from typing import Optional

APP_NAME = "Streamloot"


def is_frozen() -> bool:
    """True when running from a PyInstaller bundle."""
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def resource_dir() -> Path:
    """
    Read-only bundled files (UI dist, plugins/, vendored binaries).

    Frozen: the PyInstaller extraction dir. Source: the project root.
    """
    if is_frozen():
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def user_data_dir() -> Path:
    """
    Writable state (history.db, logs/, yt-dlp archive).

    Frozen: ~/Library/Application Support/Streamloot, because the bundle
    itself is read-only once the app is signed and installed to /Applications.
    Source: the project root, so dev runs keep using ./db and ./logs and
    nothing about the existing workflow changes.
    """
    if is_frozen():
        d = Path.home() / "Library" / "Application Support" / APP_NAME
    else:
        d = Path(__file__).resolve().parent.parent
    d.mkdir(parents=True, exist_ok=True)
    return d


def db_dir() -> Path:
    d = user_data_dir() / "db"
    d.mkdir(parents=True, exist_ok=True)
    return d


def logs_dir() -> Path:
    d = user_data_dir() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def bundled_bin_dir() -> Path:
    """Vendored yt-dlp / ffmpeg shipped inside the bundle."""
    return resource_dir() / "bin"


def ensure_tool_path() -> None:
    """
    Put yt-dlp and ffmpeg on PATH before any subprocess call.

    An app launched from Finder inherits a minimal PATH (/usr/bin:/bin:
    /usr/sbin:/sbin) — not the shell's. Homebrew is invisible there, so
    downloaders/ytdlp.py's bare ["yt-dlp", ...] would fail with FileNotFoundError
    on a machine where yt-dlp works fine in Terminal.

    Order: bundled binaries first (known-good versions we ship), then the
    usual Homebrew prefixes as a fallback for anything we didn't vendor.
    Idempotent — safe to call more than once.
    """
    # Thứ tự có ý nghĩa: bản nhúng (ta tự chọn) -> bản đã tải (ta tự tải, biết
    # phiên bản) -> Homebrew (không kiểm soát được). Thư mục tải nằm ở
    # user_data_dir vì bundle là chỉ-đọc sau khi ký.
    # Thư mục công cụ nằm ở đường CỐ ĐỊNH của máy, không theo user_data_dir():
    # hàm kia trả về gốc repo khi chạy từ source, mà công cụ thì bản dev và bản
    # .app phải dùng chung. Viết thẳng ở đây thay vì import utils.tools để tránh
    # import vòng (utils.tools đã import utils.paths).
    machine_tools = Path.home() / "Library" / "Application Support" / APP_NAME / "tools"
    candidates = [
        str(bundled_bin_dir()),
        str(machine_tools),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    current = os.environ.get("PATH", "").split(os.pathsep)
    additions = [c for c in candidates if c not in current and os.path.isdir(c)]
    if additions:
        os.environ["PATH"] = os.pathsep.join(additions + current)


def bundled_chrome_path() -> Optional[Path]:
    """
    Đường dẫn tới Chromium đóng gói kèm, hoặc None nếu không có.

    Đóng gói riêng để extractor không phải điều khiển Chrome trong /Applications:
    app chỉ ký ad-hoc nên macOS App Management chặn và hiện cảnh báo bảo mật.
    Kèm hai lợi ích khác: không đòi người dùng phải cài sẵn Chrome, và phiên bản
    trình duyệt bị ghim nên Chrome tự cập nhật không làm vỡ plugin.

    Trả None khi chạy từ source hoặc build với --no-chromium — lúc đó
    DrissionPage tự dò trình duyệt hệ thống như trước.
    """
    exe = (
        resource_dir()
        / "chrome"
        / "Google Chrome for Testing.app"
        / "Contents"
        / "MacOS"
        / "Google Chrome for Testing"
    )
    return exe if exe.exists() else None


def plugins_dir() -> Path:
    """
    Where ExtractorFactory scans for plugins.

    Returned even when it does not exist — the factory treats a missing
    directory as "no plugins" and falls back to YtDlpDefaultExtractor, which
    is the behavior CLAUDE.md requires.
    """
    return resource_dir() / "plugins"
