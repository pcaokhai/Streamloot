import os
import sys
import queue
import secrets
import signal
import subprocess
import tempfile
import threading
import uuid
import json
from pathlib import Path
from fastapi import FastAPI, Depends, Header, HTTPException, BackgroundTasks, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from threading import Lock
from typing import List, Literal, Optional, Dict
import asyncio
from sse_starlette.sse import EventSourceResponse

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.download_service import DownloadService
from services.manifest_probe import probe_duration
from utils.proc import signal_tree
from services.history_service import HistoryService
from extractors.factory import ExtractorFactory
from extractors.ytdlp_default import YtDlpDefaultExtractor
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
# ID của extension chính thức, suy ra từ public key ghim trong manifest của nó
# (packaging/extension-key/). Ghim cứng nên không cần người dùng cấu hình gì —
# đó là toàn bộ lý do bỏ được bước dán API key.
OFFICIAL_EXTENSION_ID = "mafcgkfdagbgihegabddjhmobieiipdd"

_extension_ids = [i.strip() for i in os.getenv("STREAMLOOT_EXTENSION_IDS", "").split(",") if i.strip()]
_extension_ids.append(OFFICIAL_EXTENSION_ID)
_extension_origins = [
    i if i.startswith("chrome-extension://") else f"chrome-extension://{i}"
    for i in _extension_ids
]
_allowed_origins += _extension_origins

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

security_optional = HTTPBearer(auto_error=False)


EXTENSION_ID_HEADER = "x-streamloot-extension-id"


def verify_client(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_optional),
    origin: Optional[str] = Header(default=None),
    x_streamloot_extension_id: Optional[str] = Header(default=None),
):
    """
    Nhận HAI cách, đều nhắm đúng mô hình đe dọa của ADR 0004: một trang web độc
    hại gọi ngầm tới localhost.

    1. `Authorization: Bearer <API_KEY>` — desktop UI và client ngoài trình duyệt.
    2. Header `X-Streamloot-Extension-Id` khớp ID đã ghim — browser extension.

    **Vì sao dùng custom header chứ không phải `Origin`:** extension khai
    `host_permissions` cho host này, mà với host đã được cấp quyền thì Chrome cho
    gọi thẳng, KHÔNG ràng buộc CORS, và **không gửi header `Origin`**. Một nhánh
    chấp nhận qua `Origin` vì thế không bao giờ khớp cho extension thật — đã đo:
    request từ service worker tới đây có `Origin: None`. Tham số `origin` vẫn
    được giữ và ghi log khi từ chối — đó là manh mối chẩn đoán khi request bị
    401 mà không rõ vì sao.

    **Vì sao (2) chặn được trang web độc hại:** trình duyệt KHÔNG cho trang
    đặt header tuỳ ý trên request cross-origin nếu chưa qua preflight, mà
    preflight thì bị CORS allowlist chặn (origin của trang không nằm trong đó).
    Trang gửi request đơn giản không kèm header thì rơi thẳng vào 401.

    Yếu hơn ở đâu, nói thẳng: một tiến trình local (curl) giả được header này.
    Nhưng tiến trình local cũng đọc được API_KEY từ môi trường của app, nên
    khoản (1) vốn đã không bảo vệ nổi trường hợp đó.

    CORSMiddleware KHÔNG thay thế được hàm này: nó chỉ bỏ header CORS khiến
    trình duyệt không đọc được response, còn request thì đã thực thi xong rồi.
    """
    if credentials is not None and secrets.compare_digest(credentials.credentials, API_KEY):
        return "api-key"
    if x_streamloot_extension_id and x_streamloot_extension_id in _extension_ids:
        return "extension"
    # Một 401 không để lại dấu vết là không chẩn được: người dùng chỉ thấy "app
    # từ chối" mà không ai biết origin nào bị từ chối và đang mong đợi origin nào.
    Logger.error(
        f"Từ chối client. Extension-Id nhận được: {x_streamloot_extension_id!r}, "
        f"Origin nhận được: {origin!r}. "
        f"Extension-Id được chấp nhận: {_extension_ids}"
    )
    raise HTTPException(status_code=401, detail="Invalid or missing credentials")


# Giữ tên cũ: mọi endpoint đang tham chiếu nó.
verify_api_key = verify_client

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
def _startup_fail_interrupted_tasks():
    # Không tiến trình con nào sống sót qua lần thoát trước, nên mọi task chưa
    # kết thúc trong DB là tải ma — ba surface đều đọc get_active_tasks() làm
    # nguồn sự thật, để nguyên là chúng hiện một download không thể điều khiển.
    history.fail_interrupted_tasks()


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
    """
    Fan-out: MỖI người nghe một hàng đợi riêng.

    Trước đây một task chỉ có MỘT Queue và `stream_progress` `get()` phá huỷ —
    hai người nghe cùng lúc (cửa sổ app `hydrate()` nối vào task do extension
    khởi động và đang stream) thì mỗi sự kiện chỉ rơi vào một trong hai, cả hai
    cùng nhảy số sai, và bên không nhận được sự kiện cuối sẽ lặp `get()` mãi mãi
    — rò thread, stream không bao giờ đóng.

    Thread-safety: `broadcast_sync` chạy trên thread worker tải, còn
    subscribe/unsubscribe chạy từ endpoint async. Lock chỉ bảo vệ danh sách và
    KHÔNG giữ khi đang `put` (Queue vô hạn nên `put` không chặn, nhưng vẫn chụp
    ảnh danh sách rồi mới đẩy để không ôm lock qua lời gọi bên ngoài).
    """

    def __init__(self):
        self.subscribers: Dict[str, List[queue.Queue]] = {}
        self.processes: Dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def subscribe(self, task_id: str) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            self.subscribers.setdefault(task_id, []).append(q)
        return q

    def unsubscribe(self, task_id: str, q: queue.Queue):
        with self._lock:
            qs = self.subscribers.get(task_id)
            if not qs:
                return
            if q in qs:
                qs.remove(q)
            if not qs:
                self.subscribers.pop(task_id, None)

    def broadcast_sync(self, task_id: str, data: dict):
        with self._lock:
            qs = list(self.subscribers.get(task_id, ()))
        for q in qs:
            q.put(data)

    def set_process(self, task_id: str, process: subprocess.Popen):
        with self._lock:
            self.processes[task_id] = process

    def get_process(self, task_id: str) -> Optional[subprocess.Popen]:
        with self._lock:
            return self.processes.get(task_id)

    def cleanup(self, task_id: str):
        # An toàn khi gọi ngay sau sự kiện cuối: mỗi subscriber giữ tham chiếu
        # hàng đợi của chính nó, sự kiện đã nằm trong đó và vẫn rút ra được.
        with self._lock:
            self.subscribers.pop(task_id, None)
            self.processes.pop(task_id, None)

registry = TaskRegistry()


# --- Schemas ---
class DownloadRequest(BaseModel):
    url: str
    concurrency: int = 4
    output_dir: Optional[str] = None
    format_id: Optional[str] = None
    source: Optional[Literal["cli", "desktop", "extension", "unknown"]] = None


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


class ManifestDownloadRequest(BaseModel):
    """
    Tải từ manifest DASH client đã có sẵn trong tay.

    Dành cho site nhúng thẳng MPD vào HTML trang (ADR 0007): extension đã có
    nguyên văn XML, không cần ai tải lại. Ghi ra file tạm rồi để yt-dlp đọc —
    đo thật: nó nhận đúng 9 luồng của một manifest Facebook và tự ghép hình
    với tiếng, nên ta không phải tự dựng info.json.
    """
    manifest_xml: str
    title: str
    page_url: str
    format_id: Optional[str] = None
    concurrency: int = 4
    output_dir: Optional[str] = None


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
            # update_progress, KHÔNG phải update_task: một dòng tiến trình không
            # được phép kéo task ra khỏi trạng thái người dùng vừa đặt (paused,
            # cancelling). Xem HistoryService.update_progress.
            history.update_progress(task_id, data["completed"], avg_speed=avg_speed)

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
                source=req.source or "unknown",
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
            # update_progress, KHÔNG phải update_task: một dòng tiến trình không
            # được phép kéo task ra khỏi trạng thái người dùng vừa đặt (paused,
            # cancelling). Xem HistoryService.update_progress.
            history.update_progress(task_id, data["completed"], avg_speed=avg_speed)

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
                source="extension",
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
    history.create_task(task_id, req.url, source=req.source or "unknown")

    background_tasks.add_task(run_download_task, task_id, req)

    return {
        "task_id": task_id,
        "message": "Download started",
        # B13: EventSource không gửi được header, nên stream dùng token này.
        "stream_token": issue_stream_token(task_id),
    }


#: Trần kích thước manifest nhận từ client. MPD thật đo được ~13KB; đặt rộng
#: gấp nhiều lần nhưng vẫn chặn, vì đây là dữ liệu từ ngoài vào.
MAX_MANIFEST_BYTES = 2 * 1024 * 1024


def _run_manifest_task(task_id: str, req: PreparedDownloadRequest, mpd_path: str):
    """Chạy như tải-đã-dựng-sẵn, rồi xoá file manifest tạm dù thành hay bại."""
    try:
        run_prepared_task(task_id, req)
    finally:
        try:
            os.remove(mpd_path)
        except OSError:
            pass


#: Tiến trình cài công cụ, theo tên. Sống trong RAM của tiến trình backend —
#: mất khi app tắt, và đó là đúng: cài dở thì lần sau cài lại từ đầu, vì
#: tool_installer không để lại file cụt.
_installing: dict = {}
_install_lock = threading.Lock()


def _do_install(name: str):
    def progress(done: int, total: int, label: str):
        with _install_lock:
            _installing[name] = {"done": done, "total": total, "label": label, "error": None}

    try:
        from services.tool_installer import install
        install(name, progress)
        with _install_lock:
            _installing.pop(name, None)
    except Exception as e:
        Logger.error(f"Cài {name} thất bại: {e}", exc_info=True)
        with _install_lock:
            _installing[name] = {"done": 0, "total": 0, "label": name, "error": str(e)}


@app.get("/api/v1/tools", dependencies=[Depends(verify_api_key)])
def get_tools():
    """
    Công cụ nào đã có, đến từ đâu, và cái nào đang tải.

    `required` phân biệt hai nhóm hành xử khác hẳn nhau: thiếu yt-dlp/ffmpeg thì
    không tải được gì; thiếu Chromium chỉ ảnh hưởng đường dán-URL ở vài site nên
    KHÔNG được chặn app.
    """
    from utils import tools as tool_mod
    with _install_lock:
        busy = dict(_installing)
    return {"tools": tool_mod.as_dict(), "installing": busy}


@app.post("/api/v1/tools/{name}/install", dependencies=[Depends(verify_api_key)])
def install_tool(name: str):
    """
    Bắt đầu tải một công cụ. Trả ngay, tiến trình xem ở `GET /tools`.

    Không chạy đồng bộ: Chromium ~180MB, giữ một request HTTP mở suốt thời gian
    đó là mời timeout ở mọi tầng trung gian.
    """
    from utils import tools as tool_mod
    if name not in (*tool_mod.REQUIRED, *tool_mod.OPTIONAL):
        raise HTTPException(status_code=400, detail=f"Không biết công cụ '{name}'.")
    with _install_lock:
        if name in _installing and not _installing[name].get("error"):
            return {"started": False, "message": "Đang cài rồi."}
        _installing[name] = {"done": 0, "total": 0, "label": name, "error": None}
    threading.Thread(target=_do_install, args=(name,), daemon=True).start()
    return {"started": True}


@app.post("/api/v1/downloads/manifest", dependencies=[Depends(verify_api_key)])
async def start_manifest_download(req: ManifestDownloadRequest, background_tasks: BackgroundTasks):
    """
    Tải từ manifest DASH do client cung cấp.

    Vì sao cần: có site nhúng MPD thẳng vào HTML và KHÔNG phục vụ nó qua URL nào
    (ADR 0007 §1.1), nên không có gì để backend tự tải lại. Client gửi nguyên
    văn XML sang đây.

    `--enable-file-urls` chỉ bật cho ĐÚNG lời gọi này, trên ĐÚNG file ta vừa
    ghi ra. Cờ đó cho phép yt-dlp đọc file cục bộ, nên không bao giờ được dùng
    với đường dẫn đến từ client.
    """
    if not req.manifest_xml.lstrip().startswith("<"):
        raise HTTPException(status_code=400, detail="manifest_xml không phải XML.")
    if len(req.manifest_xml.encode("utf-8")) > MAX_MANIFEST_BYTES:
        raise HTTPException(status_code=413, detail="Manifest quá lớn.")

    fd, mpd_path = tempfile.mkstemp(prefix="streamloot-mpd-", suffix=".mpd")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(req.manifest_xml)

    task_id = str(uuid.uuid4())
    history.create_task(task_id, req.page_url, source="extension")

    prepared = PreparedDownloadRequest(
        video_info=VideoInfoPayload(
            title=req.title,
            # Đường dẫn do CHÍNH TA dựng, không phải từ client.
            m3u8_url=f"file://{mpd_path}",
            page_url=req.page_url,
            extra_ytdlp_args=["--enable-file-urls"],
        ),
        concurrency=req.concurrency,
        output_dir=req.output_dir,
        format_id=req.format_id,
    )
    background_tasks.add_task(_run_manifest_task, task_id, prepared, mpd_path)
    return {
        "task_id": task_id,
        "message": "Download started",
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
    history.create_task(task_id, req.video_info.page_url, source="extension")
    background_tasks.add_task(run_prepared_task, task_id, req)
    return {
        "task_id": task_id,
        "message": "Download started",
        "stream_token": issue_stream_token(task_id),
    }


@app.get("/api/v1/downloads/active", dependencies=[Depends(verify_api_key)])
def get_active_downloads():
    """
    Mọi task chưa kết thúc, gồm cả `paused`.

    Nguồn sự thật cho "đang có gì chạy". Client dựng lại trạng thái từ đây sau
    khi khởi động lại thay vì tự nhớ — xem spec D1 và D6.
    """
    return {"tasks": history.get_active_tasks()}


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
        # Cả NHÓM, không riêng yt-dlp: ffmpeg mới là tiến trình kéo byte, giết
        # mỗi yt-dlp thì ffmpeg thành mồ côi và vẫn tải tiếp.
        signal_tree(process, signal.SIGCONT)
        signal_tree(process, signal.SIGTERM)

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

    signal_tree(process, signal.SIGSTOP)
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

    signal_tree(process, signal.SIGCONT)
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
async def stream_progress(
    task_id: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
    origin: Optional[str] = Header(default=None),
    x_streamloot_extension_id: Optional[str] = Header(default=None),
):
    """
    Nhận BA cách xác thực, vì các loại client có khả năng khác nhau:

    - `Authorization: Bearer <API_KEY>` — cho client gọi bằng `fetch`. MV3
      service worker KHÔNG có `EventSource`, nên extension buộc phải dùng
      `fetch` + `ReadableStream`, và `fetch` thì set được header bình thường.
    - `X-Streamloot-Extension-Id` — extension, cùng cơ chế như mọi endpoint
      khác (xem `verify_client`).
    - `?token=` dùng-một-lần — cho client dùng `EventSource` (desktop UI), vì
      `EventSource` không set được header.

    Header được ưu tiên: nó không tiêu thụ token, nên client fetch nối lại
    stream bao nhiêu lần cũng được.
    """
    if authorization and secrets.compare_digest(
        authorization.removeprefix("Bearer ").strip(), API_KEY
    ):
        pass
    elif x_streamloot_extension_id and x_streamloot_extension_id in _extension_ids:
        pass  # extension: cùng cơ chế như mọi endpoint khác (xem verify_client)
    elif not consume_stream_token(task_id, token):
        # Ghi lại manh mối trước khi từ chối: một lần 401 không dấu vết ở đúng
        # đường này từng tốn ba vòng gỡ lỗi mới tìm ra nguyên nhân là
        # `Origin: None`. Không log secret, chỉ log có/không và origin nhận được.
        Logger.error(
            f"Từ chối stream task {task_id}: "
            f"Bearer={'có' if authorization else 'không'}, "
            f"ext-id={x_streamloot_extension_id!r}, "
            f"token={'có' if token else 'không'}, Origin={origin!r}"
        )
        raise HTTPException(status_code=401, detail="Invalid or missing stream credentials")
    q = registry.subscribe(task_id)

    async def event_generator():
        try:
            while True:
                try:
                    # Use to_thread to prevent blocking the async event loop
                    data = await asyncio.to_thread(q.get, timeout=1.0)
                    yield {"data": json.dumps(data)}
                    if data.get("status") in ["completed", "failed", "cancelled"]:
                        break
                except queue.Empty:
                    continue
        finally:
            # Client ngắt giữa chừng thì generator bị đóng ở đây — không gỡ ra
            # là hàng đợi mồ côi cứ lớn mãi theo mỗi sự kiện phát ra.
            registry.unsubscribe(task_id, q)

    return EventSourceResponse(event_generator())


class ProbeDurationRequest(BaseModel):
    url: str
    referer: Optional[str] = None
    user_agent: Optional[str] = None


@app.post("/api/v1/probe/duration", dependencies=[Depends(verify_api_key)])
def probe_manifest_duration(req: ProbeDurationRequest):
    """
    Đo thời lượng một playlist, để client biết cái nào là phim cái nào là quảng cáo.

    Extension không tự đo được: `fetch` của trình duyệt không cho đặt `Referer`
    (header bị cấm), mà CDN video thường từ chối request thiếu Referer — đo thật
    thì phép đo treo tới hết giờ rồi trả về tay không. Ở đây thì đặt được.
    """
    return {"duration_sec": probe_duration(req.url, req.referer, req.user_agent)}


@app.get("/api/v1/health", dependencies=[Depends(verify_api_key)])
def health_check():
    """
    Kiểm tra còn sống, KHÔNG đụng database.

    Extension trước đây hỏi `/history` để biết app có chạy không — tức là kéo 50
    dòng lịch sử (vài KB, một lượt truy vấn SQLite) chỉ để trả lời câu hỏi
    có/không. Endpoint này không đọc gì cả, nên câu trả lời không bao giờ phụ
    thuộc vào việc DB đang bận hay lịch sử dài bao nhiêu.
    """
    return {"ok": True}


@app.get("/api/v1/history", dependencies=[Depends(verify_api_key)])
def get_history(source: Optional[Literal["cli", "desktop", "extension", "unknown"]] = None):
    # source=None trả mọi nguồn — cửa sổ app dùng thế (D6).
    return history.get_history(limit=50, source=source)


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


@app.get("/api/v1/extractor", dependencies=[Depends(verify_api_key)])
def describe_extractor(url: str):
    """
    URL này có plugin riêng xử lý không?

    Extension cần biết để chọn đường: site có plugin thì đường manifest là
    đường đúng (plugin làm những việc riêng của site — gỡ nguỵ trang segment,
    header, cookie — mà hỏi yt-dlp bằng URL trang sẽ mất hết). Site không có
    plugin thì hỏi thẳng yt-dlp cho ra nhiều chất lượng hơn.

    Cố ý chỉ trả BOOLEAN cho đúng URL người dùng đang mở, không trả danh sách
    tên miền nào — danh sách đó là thứ phải giữ kín (CLAUDE.md §3.1).
    """
    extractor = ExtractorFactory.get_extractor(url)
    return {"plugin": type(extractor) is not YtDlpDefaultExtractor}


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


@app.post("/api/v1/formats/prepared", dependencies=[Depends(verify_api_key)])
def get_formats_prepared(payload: VideoInfoPayload):
    """
    Liệt kê format từ VideoInfo client dựng sẵn — không extract lại.

    Đối xứng với /downloads/prepared. Cần cho panel của extension: nó phải hiện
    danh sách chất lượng TRƯỚC khi người dùng bấm tải (ADR 0005 §2.5d), mà
    /api/v1/formats thì lại tự extract từ URL, tức mở Chromium lần nữa — đúng
    cái ~30s mà cả Phương án 2 sinh ra để tránh.
    """
    # Đường nhanh: đọc thẳng master playlist (một GET) — cách IDM/Cốc Cốc làm.
    # Không ra biến thể nào (DASH, HLS một luồng, lỗi mạng) mới tốn công spawn
    # yt-dlp. Manifest lỗi không được phép chặn đường cũ, nên bọc riêng.
    try:
        from services.manifest_probe import list_variants, variants_to_formats
        variants = list_variants(payload.m3u8_url, payload.referer, payload.user_agent)
        if variants:
            return {"title": payload.title, "formats": variants_to_formats(variants)}
    except Exception as e:
        Logger.error(f"Đường manifest hỏng, lùi về yt-dlp: {e}", exc_info=True)
    try:
        formats = YtDlpDownloader().list_formats(payload.to_video_info())
        return {"title": payload.title, "formats": formats}
    except subprocess.TimeoutExpired:
        Logger.error(f"Liệt kê format quá giờ cho {payload.page_url}")
        raise HTTPException(status_code=504, detail="Timed out listing formats.")
    except (ValueError, RuntimeError) as e:
        # Ghi log NỮA, không chỉ trả HTTP: lỗi trả qua HTTP không vào file log,
        # nên khi người dùng báo "Backend trả 400" thì không còn dấu vết nào để lần.
        Logger.error(f"Liệt kê format thất bại: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/system/ytdlp-version", dependencies=[Depends(verify_api_key)])
def get_ytdlp_version():
    return check_ytdlp_update()


if __name__ == "__main__":
    import uvicorn
    # Bind only to localhost for security. Single worker — see NOTE above.
    uvicorn.run(app, host="127.0.0.1", port=8000)
