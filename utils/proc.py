"""
Gửi tín hiệu cho CẢ CÂY tiến trình tải, không chỉ tiến trình con trực tiếp.

yt-dlp thường giao việc tải HLS cho ffmpeg, tức tiến trình thật sự kéo byte về
là CHÁU chứ không phải con. Gửi SIGSTOP riêng cho yt-dlp thì đo được: yt-dlp
dừng (trạng thái T) còn ffmpeg vẫn chạy (trạng thái S) — menu báo "đã tạm dừng"
trong khi file vẫn phình ra.

Bắt buộc đi kèm `start_new_session=True` lúc Popen. Không có nó, tiến trình con
nằm CÙNG nhóm với backend, và `killpg` sẽ dừng luôn chính backend — đã thử và
nó tự treo mình thật.
"""
import os
import signal as _signal
import subprocess
from typing import Optional

from utils.logger import Logger


def signal_tree(process: subprocess.Popen, sig: int) -> bool:
    """
    Gửi `sig` cho cả nhóm tiến trình của `process`.

    Trả về True nếu gửi được. Lùi về gửi riêng cho tiến trình con khi không lấy
    được nhóm (tiến trình vừa chết, hoặc nó không được tạo bằng
    `start_new_session=True`) — có còn hơn không.
    """
    if process.poll() is not None:
        return False
    try:
        pgid = os.getpgid(process.pid)
    except (ProcessLookupError, PermissionError) as e:
        Logger.get_logger().debug(f"Không lấy được nhóm tiến trình {process.pid}: {e}")
        pgid = None

    if pgid is not None and pgid != os.getpgid(0):
        # Chỉ dùng killpg khi nhóm đó KHÁC nhóm của chính mình. Bằng nhau nghĩa
        # là tiến trình con không có phiên riêng, và gửi tín hiệu sẽ tự bắn vào
        # chân mình.
        try:
            os.killpg(pgid, sig)
            return True
        except (ProcessLookupError, PermissionError) as e:
            Logger.get_logger().debug(f"killpg({pgid}) hỏng: {e}")

    try:
        process.send_signal(sig)
        return True
    except (ProcessLookupError, OSError) as e:
        Logger.get_logger().debug(f"Gửi tín hiệu riêng cho {process.pid} hỏng: {e}")
        return False


STOP = _signal.SIGSTOP
CONT = _signal.SIGCONT
TERM = _signal.SIGTERM
