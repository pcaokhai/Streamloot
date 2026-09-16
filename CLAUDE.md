# CLAUDE.md

Tài liệu hướng dẫn và quy chuẩn phát triển dành cho Claude Code / AI Assistant khi làm việc trong codebase **downloader-py**.

---

## 1. Tổng quan dự án (Project Overview)

**downloader-py** là một ứng dụng tải video/media đa nền tảng, xây dựng bằng Python với kiến trúc **Modular Multi-Mode** và hệ thống **Dynamic Plugin Extraction**.

### 3 Chế độ hoạt động độc lập (Execution Modes)
1. **CLI Mode (`apps/cli/`)**: Giao diện dòng lệnh nhanh chóng, hỗ trợ thanh tiến trình terminal với `rich`.
2. **API Backend Mode (`apps/api/`)**: Máy chủ REST API xây dựng trên `FastAPI`, phục vụ kết nối từ Chrome Extension hoặc client bên ngoài, truyền tiến trình real-time qua Server-Sent Events (SSE).
3. **Desktop App Mode (`apps/desktop/`)**: Ứng dụng Desktop có giao diện đồ họa (GUI) sử dụng `pywebview` và Frontend (HTML/JS/TailwindCSS), tự động kết nối backend nội bộ.

---

## 2. Cấu trúc thư mục (Directory Structure)

```text
downloader-py/
├── apps/                  # Entrypoints độc lập cho từng chế độ
│   ├── cli/main.py        # CLI Entrypoint
│   ├── api/main.py        # FastAPI Server Entrypoint
│   └── desktop/           # Desktop GUI App (PyWebView + Web UI)
│       ├── main.py
│       └── ui/index.html
├── core/                  # Business Logic cốt lõi dùng chung (Agostic, Zero-UI)
│   ├── db.py              # Cấu hình SQLAlchemy & SQLite Schema
│   ├── downloader.py      # Abstract Base Downloader interface
│   ├── extractor.py       # Abstract Base Extractor interface
│   └── models.py          # DTO Models (VideoInfo, etc.)
├── downloaders/           # Implementation trình tải file (YtDlpDownloader)
├── extractors/            # Dynamic Factory & Default Universal Extractor
│   ├── factory.py         # Plugin loader tự động
│   └── ytdlp_default.py   # Extractor mặc định cho YouTube & các site yt-dlp hỗ trợ
├── plugins/               # [BẢO MẬT] Thư mục chứa các Extractor riêng tư cho từng website
├── services/              # Orchestration Services (DownloadService, HistoryService)
├── db/                    # Thư mục chứa SQLite database & archive file
├── docs/                  # Tài liệu kiến trúc (ADR, Specs, Implementation docs)
├── tests/                 # Bộ test tự động (unittest)
└── utils/                 # Utilities (Logger, Helpers)
```

---

## 3. Các nguyên tắc kiến trúc bắt buộc (Architectural Rules)

### 3.1. Tính bảo mật của Plugins (Plugin Privacy & Security)
- **TUYỆT ĐỐI KHÔNG** để lộ bất kỳ tên miền (domain), URL pattern, hay business logic đặc thù của các site nhạy cảm/private vào trong `core/`, `extractors/`, `services/`, hay `utils/`.
- Tất cả logic bóc tách của từng website riêng biệt phải nằm gọn trong từng file plugin độc lập tại thư mục `plugins/`.
- Nếu xóa toàn bộ thư mục `plugins/`, codebase vẫn phải hoạt động bình thường với fallback `YtDlpDefaultExtractor`.

### 3.2. Độc lập giữa các chế độ (Separation of Concerns)
- Các module trong `apps/` không được phép import chéo lẫn nhau (VD: `apps/cli` không import `fastapi`, `apps/api` không import `rich.progress`).
- Module `core/` và `downloaders/` **hoàn toàn không dính líu đến UI**. Mọi cập nhật tiến trình phải thông qua cơ chế `progress_callback(data: dict)`.

### 3.3. Bảo mật API Backend (API Security)
- API Backend phải bind vào `127.0.0.1` (Localhost only), không bind vào `0.0.0.0`.
- Mọi endpoint ghi/đọc dữ liệu (trừ SSE stream) phải được bảo vệ bằng `API_KEY` Header (`Authorization: Bearer <API_KEY>`).
- Cấu hình CORS chặt chẽ để chỉ cho phép Client nội bộ và Chrome Extension được cấp phép.

### 3.4. Quản lý File & Đường dẫn tải (Filesystem Safety)
- Không bao giờ truyền trực tiếp title chứa ký tự đặc biệt vào đường dẫn file.
- Lệnh `yt-dlp` luôn phải tách riêng `-P <output_dir>` và `-o <filename_template>`, kết hợp cờ `--windows-filenames` để tránh việc ký tự gạch chéo `/` trong tiêu đề video tự tạo thành thư mục con.

---

## 4. Lệnh chạy & Phát triển (Commands & Workflows)

Dự án sử dụng `uv` để quản lý môi trường ảo và dependencies:

### Chạy ứng dụng:
```bash
# 1. Chạy chế độ Desktop GUI (Tự động build UI & chạy app)
./run_desktop.sh
# Hoặc ép build lại UI trước khi chạy:
./run_desktop.sh --build

# 2. Chạy chế độ API Backend (port 8000)
uv run apps/api/main.py

# 3. Chạy chế độ CLI
uv run apps/cli/main.py -u "<VIDEO_URL>"
uv run apps/cli/main.py -u "<VIDEO_URL>" -c 4 --no-interactive
```

### Chạy Tests:
```bash
# Chạy toàn bộ test suite
uv run python -m unittest discover -s tests -p "test_*.py"
```

### Thêm dependencies:
```bash
uv pip install <package_name>
```

---

## 5. Quy chuẩn Code (Code Conventions)

1. **Type Hints**: Sử dụng đầy đủ kiểu dữ liệu (`typing.Optional`, `typing.List`, `typing.Callable`, `typing.Dict`).
2. **Error Handling**: Bắt lỗi có chủ đích, không dùng bare `except:`. Sử dụng `Logger.error("...", exc_info=True)` khi bắt exception để phục vụ debug.
3. **Resilience**: Các hàm quét plugin (`ExtractorFactory`) phải bọc `try...except` quanh từng file để lỗi cú pháp của một plugin không làm sập cả hệ thống.
4. **Clean Logging**: Dùng `Logger` từ `utils.logger`, tránh dùng lệnh `print()` trực tiếp trong `core/` và `services/`.


## Rule
- folder docs/ là source of truth, toàn bộ planning, implementation, ADR, brainingstorming cần được ghi đầu đủ vào đây để tham chiếu

