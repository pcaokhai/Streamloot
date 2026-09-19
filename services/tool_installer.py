"""
Tải công cụ ngoài về lúc chạy, thay cho việc nhúng sẵn vào bundle.

Vì sao: bản build nhúng cả ba nặng 482 MB, riêng Chromium 359 MB — mà Chromium
chỉ phục vụ một đường duy nhất. Xem `docs/2026-09-19-danh-gia-lai-kien-truc.md`.

Nguồn tải dùng ĐÚNG những nguồn `build_app.sh` vẫn dùng, để bản tải lúc chạy và
bản nhúng lúc build không bao giờ lệch nhau.

Nguyên tắc: **cài nguyên tử**. Tải vào thư mục tạm, kiểm tra xong mới chuyển vào
chỗ thật. Nửa chừng mà hỏng thì không để lại một file cụt mà lần sau tưởng là đã
cài — đó là loại lỗi im lặng đắt nhất.
"""
import json
import os
import platform
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Optional

from utils import tools
from utils.logger import Logger

YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
FFMPEG_URL = "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/{asset}"
CFT_JSON_URL = (
    "https://googlechromelabs.github.io/chrome-for-testing/"
    "last-known-good-versions-with-downloads.json"
)

#: Tiến trình: (đã tải, tổng, mô tả). `tổng` là 0 khi máy chủ không khai.
ProgressCb = Callable[[int, int, str], None]


def _download(url: str, dest: Path, progress: Optional[ProgressCb], label: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Streamloot"})
    with urllib.request.urlopen(req, timeout=60) as res, open(dest, "wb") as fh:
        total = int(res.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = res.read(256 * 1024)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            if progress:
                progress(done, total, label)


def _verify_runs(exe: Path, arg: str = "--version") -> None:
    """Chạy thử. Tải về một file hỏng mà không chạy thử là để lỗi lộ ra lúc tải video."""
    r = subprocess.run([str(exe), arg], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"{exe.name} tải về nhưng không chạy: {r.stderr.strip()[:200]}")


def _verify_arch(exe: Path) -> None:
    """
    Kiểm kiến trúc. Tải nhầm kiến trúc là lỗi THẦM LẶNG: app vẫn chạy, chỉ hỏng
    trên máy người dùng. Đã gặp một lần với ffmpeg (nhật ký thử tay #8).
    """
    host = platform.machine()
    try:
        got = subprocess.run(["lipo", "-archs", str(exe)], capture_output=True,
                             text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return  # không có lipo thì bỏ qua, không phải lý do để chặn
    if got and host not in got:
        raise RuntimeError(f"{exe.name} là '{got}' nhưng máy này là '{host}'")


def _install_binary(name: str, url: str, progress: Optional[ProgressCb],
                    check_arch: bool = False) -> Path:
    dest = tools.tools_dir() / name
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / name
        _download(url, tmp, progress, name)
        os.chmod(tmp, 0o755)
        if check_arch:
            _verify_arch(tmp)
        _verify_runs(tmp)
        shutil.move(str(tmp), str(dest))  # chỉ chuyển vào chỗ thật khi đã chắc
    Logger.info(f"Đã cài {name} vào {dest}")
    return dest


def _chromium_url() -> str:
    req = urllib.request.Request(CFT_JSON_URL, headers={"User-Agent": "Streamloot"})
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.load(res)
    plat = "mac-arm64" if platform.machine().lower() in ("arm64", "aarch64") else "mac-x64"
    for entry in data["channels"]["Stable"]["downloads"]["chrome"]:
        if entry.get("platform") == plat:
            return entry["url"]
    raise RuntimeError(f"Chrome for Testing không có bản cho {plat}")


def _install_chromium(progress: Optional[ProgressCb]) -> Path:
    url = _chromium_url()
    dest = tools.tools_dir() / "chrome"
    with tempfile.TemporaryDirectory() as td:
        zip_path = Path(td) / "chrome.zip"
        _download(url, zip_path, progress, "chromium")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(td)
        # Zip giải ra một thư mục con (chrome-mac-arm64/) chứa bundle .app.
        inner = next((p for p in Path(td).iterdir() if p.is_dir() and p.name.startswith("chrome-mac")), None)
        if inner is None:
            raise RuntimeError("Gói Chromium không có thư mục như mong đợi")
        exe = inner / "Google Chrome for Testing.app" / "Contents" / "MacOS" / "Google Chrome for Testing"
        if not exe.exists():
            raise RuntimeError("Gói Chromium thiếu file thực thi")
        # zipfile của Python KHÔNG giữ cờ thực thi — không chmod thì bundle
        # giải nén xong vẫn không chạy được.
        for p in inner.rglob("*"):
            if p.is_file() and not p.suffix:
                os.chmod(p, 0o755)
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(inner), str(dest))
    Logger.info(f"Đã cài Chromium vào {dest}")
    return dest


def install(name: str, progress: Optional[ProgressCb] = None) -> str:
    """Cài một công cụ. Trả đường dẫn. Ném khi hỏng — người gọi hiện lỗi cho người dùng."""
    if name == "yt-dlp":
        return str(_install_binary("yt-dlp", YTDLP_URL, progress))
    if name == "ffmpeg":
        return str(_install_binary("ffmpeg", FFMPEG_URL.format(asset=tools.ffmpeg_asset()),
                                   progress, check_arch=True))
    if name == "chromium":
        return str(_install_chromium(progress))
    raise ValueError(f"Không biết công cụ '{name}'")
