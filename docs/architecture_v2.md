# Downloader V2 Architecture Specification

## 1. Introduction
Tài liệu này mô tả kiến trúc mới cho dự án Downloader nhằm hỗ trợ 3 chế độ hoạt động hoàn toàn độc lập:
1. **CLI Mode:** Giao diện dòng lệnh (chế độ mặc định hiện tại).
2. **API Mode (Backend):** Máy chủ FastAPI chạy qua Docker Compose, cung cấp API cho Chrome Extension.
3. **Desktop Mode:** Ứng dụng độc lập (Standalone App) trên macOS có giao diện UI.

## 2. Core Principles (Nguyên tắc thiết kế)
- **Separation of Concerns (SoC):** Tách biệt hoàn toàn phần Business Logic cốt lõi (Core) dùng chung và phần Presentation/Interface logic dành riêng cho từng mode (Apps).
- **Independent Execution:** Các chế độ hoạt động không được phép import code của nhau. (Ví dụ: CLI không import thư viện FastAPI, API không import UI của Desktop).
- **Event-Driven Progress:** Việc cập nhật tiến trình tải (progress) sẽ sử dụng cơ chế Event/Callback hoặc Async Queue để các giao diện (CLI spinner, API Websocket/SSE, Desktop UI ProgressBar) có thể lắng nghe mà Core không cần biết ai đang gọi.

## 3. Directory Structure
```text
downloader-py/
├── apps/                  # Chứa logic và entrypoints của từng chế độ (HOÀN TOÀN ĐỘC LẬP)
│   ├── cli/               # CLI Application
│   │   └── main.py        # Entrypoint (Di chuyển từ root main.py vào đây)
│   │
│   ├── api/               # FastAPI Backend
│   │   ├── main.py        # Entrypoint (Khởi chạy uvicorn)
│   │   ├── routes.py      # Các API endpoints (/download, /status, /history)
│   │   ├── schemas.py     # Pydantic models cho Request/Response
│   │   └── Dockerfile     # Docker build cho API mode
│   │
│   └── desktop/           # macOS Standalone GUI App
│       ├── main.py        # Entrypoint cho Desktop App
│       └── ui/            # Logic giao diện (Tkinter / PyQt / PyWebView)
│
├── core/                  # Core Business Logic (DÙNG CHUNG)
│   ├── downloader/        # Module quản lý việc tải file (YtDlpDownloader)
│   ├── extractor/         # Module bóc tách link (ExtractorFactory)
│   ├── models.py          # Data models chung (VideoInfo)
│   └── db.py              # Trình quản lý History & Trạng thái tải (SQLite)
│
├── services/              # Application Services
│   └── download_manager.py# Tầng giao tiếp giữa Apps và Core (Quản lý queue, event, DB state)
│
├── plugins/               # Thư mục Plugins (Đã hoàn thiện)
│   └── ...
│
└── utils/                 # Utility scripts (logger, helper)
```

## 4. API Specification (FastAPI Backend)
Backend sẽ sử dụng SQLite (`core/db.py`) để lưu trữ lịch sử và trạng thái.

- `POST /api/v1/downloads`: Gửi URL để bắt đầu tải. Trả về `task_id`.
- `GET /api/v1/downloads/{task_id}`: Lấy trạng thái hiện tại (Downloading, Completed, Failed) và progress (%) của 1 task.
- `GET /api/v1/history`: Xem lịch sử các video đã tải thành công.
- `GET /api/v1/progress/stream`: (Optional) Server-Sent Events (SSE) hoặc WebSocket để đẩy trạng thái progress realtime tới Chrome Extension thay vì polling liên tục.

## 5. Event & State Management
Hiện tại `YtDlpDownloader` đang ghi log trực tiếp ra màn hình bằng `rich.progress`.
Trong kiến trúc mới, `YtDlpDownloader` sẽ nhận một `callback(progress_data)` hoặc sử dụng `asyncio.Queue` để đẩy các bản cập nhật trạng thái.
- **Ở CLI:** Callback sẽ update `rich` console.
- **Ở API:** Callback sẽ ghi trạng thái vào DB hoặc đẩy qua WebSocket/SSE.
- **Ở Desktop:** Callback sẽ update thanh Progress Bar của UI.

## 6. Deployment
- **API Mode:** Đi kèm `docker-compose.yml` định nghĩa service backend chạy bằng uvicorn, expose port 8000 cho Extension kết nối.
- **Desktop Mode:** Sử dụng `pyinstaller` hoặc công cụ tương tự để đóng gói toàn bộ thư mục `apps/desktop` và `core` thành một file `.app` chạy trực tiếp trên macOS mà không cần cài python.
