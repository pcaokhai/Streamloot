# V2 Architecture Implementation Details

Tài liệu này ghi chú chi tiết tất cả các thay đổi và thành phần đã được tái cấu trúc (refactor) trong giai đoạn chuyển đổi dự án sang kiến trúc Multi-Mode (CLI, API, Desktop).

## 1. Directory Restructuring (Tái cấu trúc thư mục)
Toàn bộ mã nguồn đã được tổ chức lại theo nguyên tắc **Separation of Concerns** để tách biệt Business Logic (Core) khỏi Presentation Layer (Apps).

*   **`apps/`**: Chứa các entrypoint độc lập cho từng chế độ hoạt động.
    *   **`apps/cli/main.py`**: Entrypoint cho chế độ dòng lệnh (được di chuyển từ thư mục gốc). Đã cấu hình lại `sys.path` để import được các module từ thư mục cha.
    *   **`apps/api/main.py`**: Entrypoint cho chế độ Backend Server (FastAPI).
    *   **`apps/desktop/main.py`**: Entrypoint cho chế độ Desktop GUI.
    *   **`apps/desktop/ui/index.html`**: Giao diện HTML/TailwindCSS cho ứng dụng Desktop.
*   **`core/`**: Chứa các logic nghiệp vụ lõi, không phụ thuộc vào giao diện.
    *   **`core/db.py`**: Khởi tạo cấu hình SQLAlchemy và định nghĩa schema cơ sở dữ liệu.
    *   **`core/downloader.py`**: Interface chuẩn cho các downloader.
    *   **`core/models.py`**: Chứa Data Transfer Objects (DTO) như `VideoInfo`.
*   **`services/`**: Application services (`download_service.py`, `history_service.py`) quản lý flow tổng thể.
*   **`extractors/` & `plugins/`**: Cơ chế Factory và các plugin bóc tách link độc lập.

## 2. Decoupling Downloader (Tách rời Logic Tải & Giao diện)
Trước đây, `YtDlpDownloader` phụ thuộc trực tiếp vào thư viện `rich` để vẽ thanh tiến trình ra Terminal. Điều này khiến nó không thể dùng được cho API hoặc Desktop App.

**Thay đổi:**
*   Chỉnh sửa chữ ký hàm `BaseDownloader.download()` và `YtDlpDownloader.download()` để nhận thêm tham số `progress_callback: Optional[Callable[[dict], None]]`.
*   Gỡ bỏ context `Progress` của `rich` bên trong `ytdlp.py`.
*   Thay vào đó, mỗi khi có trạng thái mới (Preparing, Extracting, Downloading, Merging), downloader sẽ gọi `progress_callback(data)` với một object chứa thông tin (status, completed, speed, eta, description).

## 3. Database Layer (Lớp dữ liệu)
Thay vì chỉ ghi lịch sử vào file text hoặc JSON thô, hệ thống đã trang bị một CSDL cấu trúc chặt chẽ.
*   **Thư viện:** `sqlalchemy`
*   **File cấu hình:** `core/db.py`
*   **Database Engine:** SQLite lưu tại `db/downloader.sqlite`. Hỗ trợ truy cập đa luồng (`check_same_thread=False`).
*   **Model `DownloadTask`:** Theo dõi `id`, `url`, `title`, `status` (pending, downloading, completed, failed), `progress`, `file_path`, và timestamps.

## 4. CLI Mode Adaptation
Do `YtDlpDownloader` không còn tự in tiến trình, `apps/cli/main.py` đã được cập nhật:
*   Bao bọc tiến trình `DownloadService.process_url` bằng một ngữ cảnh `rich.Progress()`.
*   Định nghĩa một `cli_progress_handler` nội bộ để hứng các callback từ downloader và cập nhật thanh tiến trình lên terminal theo thời gian thực.

## 5. FastAPI Backend Setup (API Mode)
Đã triển khai một máy chủ API hoàn chỉnh tại `apps/api/main.py` để phục vụ Chrome Extension.
*   **Framework:** `FastAPI` + `Uvicorn`.
*   **Bảo mật:**
    *   *Localhost Binding:* Chỉ lắng nghe các kết nối từ `127.0.0.1`.
    *   *CORS:* Middleware cho phép gọi cross-origin.
    *   *Token Auth:* Mọi endpoint (trừ SSE) đều yêu cầu Header `Authorization: Bearer <API_KEY>`.
*   **Endpoints:**
    *   `POST /api/v1/downloads`: Nhận URL, tạo Task ID, và đẩy tác vụ download vào chạy ngầm (BackgroundTasks).
    *   `GET /api/v1/downloads/{task_id}/stream`: Endpoint Server-Sent Events (SSE) sử dụng thư viện `sse_starlette` và `asyncio.Queue` để đẩy real-time tiến trình tải về trình duyệt/ứng dụng client.
    *   `GET /api/v1/history`: Truy vấn danh sách tác vụ từ SQLite.

## 6. Desktop UI Setup (Desktop Mode)
Ứng dụng Desktop nhẹ, hiện đại mà không cần đóng gói các framework UI khổng lồ như PyQt.
*   **Framework:** `pywebview`.
*   **Cơ chế hoạt động:** 
    1. Khởi chạy ngầm server FastAPI của `apps/api/main.py` trên một thread riêng (port `8001`).
    2. Mở một cửa sổ trình duyệt native (Safari/Edge/WebKit) để render file `apps/desktop/ui/index.html`.
    3. File HTML (được style bằng TailwindCSS) sẽ sử dụng JavaScript `fetch` và `EventSource` để giao tiếp với API Backend chạy ngầm, từ đó hiển thị UI mượt mà.
