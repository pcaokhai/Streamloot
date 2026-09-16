import os
import sys
import queue
import secrets
import signal
import subprocess
import threading
import uuid
import json
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from threading import Lock
from typing import List, Optional, Dict
import asyncio
from sse_starlette.sse import EventSourceResponse

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.download_service import DownloadService
from services.history_service import HistoryService
from extractors.factory import ExtractorFactory
from downloaders.ytdlp import YtDlpDownloader
from core.models import VideoInfo
from utils.ytdlp_version import check_ytdlp_update
from utils.logger import Logger

# --- Configuration & Security ---
# Fail fast rather than silently accepting a well-known default token.
API_KEY = os.environ["API_KEY"]

# Fail closed: with no explicit allowlist, allow no origins rather than "*".
_allowed_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]

# B5 (ADR 0005) — origin của extension khai riêng để không phải nhét chung vào
# CORS_ALLOWED_ORIGINS mà desktop app đang tự đặt lúc khởi động.
#
# CỐ Ý không dùng allow_origin_regex "chrome-extension://.*": như thế BẤT KỲ
# extension nào người dùng cài cũng gọi được backend này. Phải ghi cứng đúng ID.
# Muốn ID cố định giữa các lần load unpacked thì pin `key` trong manifest
# (ADR 0006 §4.2).
_extension_ids = [i.strip() for i in os.getenv("STREAMLOOT_EXTENSION_IDS", "").split(",") if i.strip()]
_allowed_origins += [
    i if i.startswith("chrome-extension://") else f"chrome-extension://{i}"
    for i in _extension_ids
]

security = HTTPBearer()

# B13 (ADR 0005 §6.3.1) — EventSource của trình duyệt không set được header
# Authorization, nên endpoint stream trước đây là endpoint DUY NHẤT không xác
# thực. Với desktop app tự gọi chính nó thì tạm chấp nhận được; với extension
# chạy trên mọi trang người dùng mở thì bề mặt tấn công rộng hơn hẳn.
#
# Thay vì bỏ EventSource (phải viết lại phần đọc stream ở cả desktop UI lẫn
# extension), phát một token dùng-một-lần gắn với đúng task_id, truyền qua query
# string. Token bị huỷ ngay khi dùng.
_stream_tokens: Dict[str, str] = {}
_stream_tokens_lock = Lock()


def issue_stream_token(task_id: str) -> str:
    token = secrets.token_urlsafe(32)
    with _stream_tokens_lock:
        _stream_tokens[task_id] = token
    return token


def consume_stream_token(task_id: str, token: Optional[str]) -> bool:
    """Đổi token lấy quyền đọc stream. So sánh hằng thời gian, dùng xong là huỷ."""
    if not token:
        return False
    with _stream_tokens_lock:
        expected = _stream_tokens.get(task_id)
        if expected is None or not secrets.compare_digest(expected, token):
            return False
        del _stream_tokens[task_id]
        return True

def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API Key")
    return credentials.credentials

# NOTE: single-worker deployment only. Task state (running subprocess handles,
# SSE queues) lives in this process's memory; running uvicorn with --workers > 1
# splits requests across processes that don't share this state, breaking both
# cancel and progress streaming. HistoryService.download_tasks persists status
# across restarts, but a restart still loses the live subprocess handle for any
# task that was in flight.
app = FastAPI(title="Downloader API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,  # e.g. "chrome-extension://<id>" via CORS_ALLOWED_ORIGINS
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bound simultaneous background downloads so a burst of requests can't spawn
# unlimited concurrent yt-dlp processes.
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("MAX_CONCURRENT_DOWNLOADS", "3"))
_download_slots = threading.Semaphore(MAX_CONCURRENT_DOWNLOADS)

history = HistoryService()


@app.on_event("startup")
def _startup_ytdlp_update_check():
    # Non-blocking: log a warning, never fail startup over this.
    try:
        status = check_ytdlp_update()
        if status["update_available"]:
            Logger.warning(
                f"yt-dlp update available: {status['current']} -> {status['latest']}. "
                "Update via your package manager (brew/pip/binary) — not auto-applied."
            )
    except Exception as e:
        Logger.get_logger().debug(f"yt-dlp update check failed at startup: {e}")


# --- State Management for SSE + live process handles ---
class TaskRegistry:
    def __init__(self):
        self.queues: Dict[str, queue.Queue] = {}
        self.processes: Dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def get_queue(self, task_id: str) -> queue.Queue:
        with self._lock:
            if task_id not in self.queues:
                self.queues[task_id] = queue.Queue()
            return self.queues[task_id]

    def broadcast_sync(self, task_id: str, data: dict):
        with self._lock:
            q = self.queues.get(task_id)
        if q:
            q.put(data)

    def set_process(self, task_id: str, process: subprocess.Popen):
        with self._lock:
            self.processes[task_id] = process

    def get_process(self, task_id: str) -> Optional[subprocess.Popen]:
        with self._lock:
            return self.processes.get(task_id)

    def cleanup(self, task_id: str):
        with self._lock:
            self.queues.pop(task_id, None)
            self.processes.pop(task_id, None)

registry = TaskRegistry()


# --- Schemas ---
class DownloadRequest(BaseModel):
    url: str
    concurrency: int = 4
    output_dir: Optional[str] = None
    format_id: Optional[str] = None


class VideoInfoPayload(BaseModel):
    """
    VideoInfo do client dựng sẵn — phản chiếu core.models.VideoInfo (ADR 0005 B1).

    Không có `cookies`: phép đo B14 (§7.3) cho thấy mọi host phục vụ byte media
    đều không nhận cookie, nên extension không cần xin quyền `cookies` của Chrome.
    Trường `cookies` vẫn còn trong core.models.VideoInfo cho đường headless dùng.
    """
    title: str
    m3u8_url: str
    page_url: str
    referer: Optional[str] = None
    origin: Optional[str] = None
    user_agent: Optional[str] = None
    playlist_name: Optional[str] = None
    video_id: Optional[str] = None
    disable_fixup: bool = False
    embed_metadata: bool = True
    clean_disguised_ts: bool = False
    extra_ytdlp_args: List[str] = []

    def to_video_info(self) -> VideoInfo:
        return VideoInfo(**self.model_dump())


class PreparedDownloadRequest(BaseModel):
    video_info: VideoInfoPayload
    concurrency: int = 4
    output_dir: Optional[str] = None
    format_id: Optional[str] = None


# --- Background Task Worker ---
def run_download_task(task_id: str, req: DownloadRequest):
    service = DownloadService()

    def progress_callback(data: dict):
        registry.broadcast_sync(task_id, data)
        if "completed" in data:
            # status="completed" here is the final call from YtDlpDownloader
            # carrying the true average speed (bytes/elapsed) — earlier
            # transient "completed" ticks (e.g. the raw "[download] 100%"
            # line, before postprocessing) get overwritten by this one
            # since it always fires last.
            avg_speed = data.get("speed") if data.get("status") == "completed" else None
            history.update_task(task_id, status="downloading", progress=data["completed"], avg_speed=avg_speed)

    def process_callback(process: subprocess.Popen):
        registry.set_process(task_id, process)

    with _download_slots:
        try:
            service.process_url(
                url=req.url,
                concurrency=req.concurrency,
                output_dir=req.output_dir,
                interactive=False,  # Disable interactive prompt for API mode
                format_id=req.format_id,
                progress_callback=progress_callback,
                task_id=task_id,
                process_callback=process_callback,
            )
        finally:
            # process_url doesn't push a terminal SSE event on failure/cancel
            # (only success flows through progress_callback) — without this,
            # a client's EventSource waits forever. Synthesize one from the
            # final task record so the stream always closes.
            final_task = history.get_task(task_id)
            final_status = final_task["status"] if final_task else "failed"
            registry.broadcast_sync(task_id, {
                "status": final_status,
                "description": final_status.capitalize(),
                "completed": (final_task or {}).get("progress") or 0.0,
                "speed": (final_task or {}).get("avg_speed") or "--",
                "eta": "--",
                "title": (final_task or {}).get("title"),
                "output_path": (final_task or {}).get("output_path"),
            })
            registry.cleanup(task_id)


def run_prepared_task(task_id: str, req: PreparedDownloadRequest):
    """Giống run_download_task nhưng bỏ qua extract (ADR 0005 B1)."""
    service = DownloadService()

    def progress_callback(data: dict):
        registry.broadcast_sync(task_id, data)
        if "completed" in data:
            avg_speed = data.get("speed") if data.get("status") == "completed" else None
            history.update_task(task_id, status="downloading", progress=data["completed"], avg_speed=avg_speed)

    def process_callback(process: subprocess.Popen):
        registry.set_process(task_id, process)

    with _download_slots:
        try:
            service.process_video_infos(
                [req.video_info.to_video_info()],
                concurrency=req.concurrency,
                output_dir=req.output_dir,
                interactive=False,
                format_id=req.format_id,
                progress_callback=progress_callback,
                task_id=task_id,
                process_callback=process_callback,
            )
        finally:
            final_task = history.get_task(task_id)
            final_status = final_task["status"] if final_task else "failed"
            registry.broadcast_sync(task_id, {
                "status": final_status,
                "description": final_status.capitalize(),
                "completed": (final_task or {}).get("progress") or 0.0,
                "speed": (final_task or {}).get("avg_speed") or "--",
                "eta": "--",
                "title": (final_task or {}).get("title"),
                "output_path": (final_task or {}).get("output_path"),
            })
            registry.cleanup(task_id)


# --- Endpoints ---
@app.post("/api/v1/downloads", dependencies=[Depends(verify_api_key)])
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())

    # Write the task record up front so a status/history lookup right after
    # this call (or a server restart mid-download) has something to find.
    history.create_task(task_id, req.url)

    background_tasks.add_task(run_download_task, task_id, req)

    return {
        "task_id": task_id,
        "message": "Download started",
        # B13: EventSource không gửi được header, nên stream dùng token này.
        "stream_token": issue_stream_token(task_id),
    }


@app.post("/api/v1/downloads/prepared", dependencies=[Depends(verify_api_key)])
async def start_prepared_download(req: PreparedDownloadRequest, background_tasks: BackgroundTasks):
    """
    Tải từ VideoInfo client đã dựng sẵn — bỏ qua bước extract phía server.

    Dành cho browser extension: nó đã quan sát được manifest trong session thật
    của người dùng, nên bắt app mở lại Chromium và vượt Cloudflare lần nữa là
    lãng phí ~30s và tự chuốc thêm một lớp lỗi.

    Endpoint cũ /api/v1/downloads VẪN GIỮ (ADR 0005 B9): extension không bắt được
    manifest thì gửi URL trần sang đó để app dùng đường headless như cũ.
    """
    task_id = str(uuid.uuid4())
    history.create_task(task_id, req.video_info.page_url)
    background_tasks.add_task(run_prepared_task, task_id, req)
    return {
        "task_id": task_id,
        "message": "Download started",
        "stream_token": issue_stream_token(task_id),
    }


@app.get("/api/v1/downloads/{task_id}", dependencies=[Depends(verify_api_key)])
def get_download_status(task_id: str):
    task = history.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    return task


@app.post("/api/v1/downloads/{task_id}/cancel", dependencies=[Depends(verify_api_key)])
def cancel_download(task_id: str):
    task = history.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if task["status"] in HistoryService.TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Task already {task['status']}")

    # Set status BEFORE signalling the process: DownloadService checks this
    # status after process.wait() returns, so this ordering makes the outcome
    # deterministic regardless of whether the process finishes naturally or
    # is killed first.
    history.update_task(task_id, status="cancelling")

    process = registry.get_process(task_id)
    if process and process.poll() is None:
        # SIGTERM delivered to a SIGSTOP'd (paused) process is queued, not
        # acted on, until the process resumes — so a cancel on a paused task
        # would otherwise hang forever. SIGCONT first is a harmless no-op if
        # the process wasn't paused.
        process.send_signal(signal.SIGCONT)
        process.terminate()

    return {"task_id": task_id, "message": "Cancellation requested"}


@app.post("/api/v1/downloads/{task_id}/pause", dependencies=[Depends(verify_api_key)])
def pause_download(task_id: str):
    """
    Pauses via SIGSTOP on the real yt-dlp subprocess — not a fake status
    flag. The process (and its open connections/partial file) freezes in
    place; SIGCONT resumes it exactly where it was. If the remote server
    drops an idle connection during a long pause, yt-dlp's own retry +
    resumable-byte-range logic (already configured) reconnects and picks
    back up — same end state, just via reconnect instead of instant resume.
    """
    task = history.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if task["status"] in HistoryService.TERMINAL_STATUSES or task["status"] == "paused":
        raise HTTPException(status_code=409, detail=f"Task cannot be paused from status '{task['status']}'")

    process = registry.get_process(task_id)
    if not process or process.poll() is not None:
        raise HTTPException(status_code=409, detail="No running process for this task yet")

    process.send_signal(signal.SIGSTOP)
    history.update_task(task_id, status="paused")
    # The download loop is a blocking `for line in process.stdout` read —
    # while paused, no new line arrives, so the frontend won't hear about
    # the pause unless we push it directly.
    registry.broadcast_sync(task_id, {
        "status": "paused", "description": "Paused",
        "completed": task.get("progress") or 0.0, "speed": "--", "eta": "--",
    })
    return {"task_id": task_id, "message": "Paused"}


@app.post("/api/v1/downloads/{task_id}/resume", dependencies=[Depends(verify_api_key)])
def resume_download(task_id: str):
    task = history.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if task["status"] != "paused":
        raise HTTPException(status_code=409, detail=f"Task is not paused (status: '{task['status']}')")

    process = registry.get_process(task_id)
    if not process or process.poll() is not None:
        raise HTTPException(status_code=409, detail="Paused process is no longer available — cancel and restart the download")

    process.send_signal(signal.SIGCONT)
    history.update_task(task_id, status="downloading")
    registry.broadcast_sync(task_id, {
        "status": "downloading", "description": "Downloading",
        "completed": task.get("progress") or 0.0, "speed": "--", "eta": "--",
    })
    return {"task_id": task_id, "message": "Resumed"}


@app.post("/api/v1/downloads/{task_id}/stream-token", dependencies=[Depends(verify_api_key)])
def refresh_stream_token(task_id: str):
    """
    Cấp token stream mới cho một task đang chạy.

    Cần vì token là dùng-một-lần: sau khi mở lại app, client khôi phục các task
    còn dở và phải nối lại stream, nhưng token cũ đã bị tiêu thụ. Endpoint này
    được bảo vệ bằng Bearer API key như mọi endpoint khác, nên việc cấp lại
    không nới lỏng gì.
    """
    task = history.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if task["status"] in HistoryService.TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail="Task already finished")
    return {"stream_token": issue_stream_token(task_id)}


@app.get("/api/v1/downloads/{task_id}/stream")
async def stream_progress(task_id: str, token: Optional[str] = None):
    # Không dùng Depends(verify_api_key) được: EventSource không gửi header.
    # Token dùng-một-lần do endpoint tạo task phát ra (B13).
    if not consume_stream_token(task_id, token):
        raise HTTPException(status_code=401, detail="Invalid or missing stream token")
    q = registry.get_queue(task_id)

    async def event_generator():
        while True:
            try:
                # Use to_thread to prevent blocking the async event loop
                data = await asyncio.to_thread(q.get, timeout=1.0)
                yield {"data": json.dumps(data)}
                if data.get("status") in ["completed", "failed", "cancelled"]:
                    break
            except queue.Empty:
                continue

    return EventSourceResponse(event_generator())


@app.get("/api/v1/history", dependencies=[Depends(verify_api_key)])
def get_history():
    return history.get_history(limit=50)


@app.delete("/api/v1/history/{record_id}", dependencies=[Depends(verify_api_key)])
def delete_history_item(record_id: int, delete_file: bool = False):
    output_path = history.delete_record(record_id)
    if delete_file and output_path and os.path.exists(output_path):
        try:
            os.remove(output_path)
        except OSError as e:
            Logger.error(f"Failed to delete file '{output_path}': {e}", exc_info=True)
    return {"message": "deleted"}


@app.delete("/api/v1/history", dependencies=[Depends(verify_api_key)])
def clear_history():
    history.clear_history()
    return {"message": "cleared"}


@app.get("/api/v1/formats", dependencies=[Depends(verify_api_key)])
def get_formats(url: str):
    """
    Resolves the URL (same extraction path as a real download) and lists
    available yt-dlp formats without downloading. NOTE: for anti-bot sites
    the extraction step itself is the expensive/riskable part (page fetch,
    cookie harvest) — this costs nearly the same site-load risk as an
    actual download, it just skips the file write.
    """
    try:
        extractor = ExtractorFactory.get_extractor(url)
        video_infos = extractor.extract(url)
        if not video_infos:
            raise HTTPException(status_code=400, detail="Video information extraction failed.")

        video_info = video_infos[0]
        downloader = YtDlpDownloader()
        formats = downloader.list_formats(video_info)
        return {"title": video_info.title, "formats": formats}
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timed out listing formats.")
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/system/ytdlp-version", dependencies=[Depends(verify_api_key)])
def get_ytdlp_version():
    return check_ytdlp_update()


if __name__ == "__main__":
    import uvicorn
    # Bind only to localhost for security. Single worker — see NOTE above.
    uvicorn.run(app, host="127.0.0.1", port=8000)
