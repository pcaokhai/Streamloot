# AGENT Guidelines & Architecture Rules

Tài liệu này tổng hợp các quy tắc kiến trúc, quy chuẩn code và bài học thực tế khi phát triển và refactor dự án **Downloader CLI (`downloader-py`)**.

---

## 1. Kiến trúc Tổng thể & Phân lớp (Architecture & Layers)

Dự án tuân thủ mô hình **Clean Architecture / Layered Architecture**:

```
downloader-py/
├── core/              # Abstract Base Classes (BaseExtractor, BaseDownloader) & DTOs (VideoInfo)
├── extractors/        # Logic bóc tách URL từng site (YoutubeExtractor, ...)
│   └── factory.py     # ExtractorFactory tự động định tuyến Extractor phù hợp
├── downloaders/       # Triển khai tải video (YtDlpDownloader, ...)
├── services/          # Business Layer (DownloadService, HistoryService)
├── ui/                # Giao diện Terminal, menu tương tác (InteractivePrompt)
├── utils/             # Tiện ích chung (Logger với rich & logging)
├── db/                # SQLite DB (history.db) & Archive file (ytdlp_archive.txt)
├── logs/              # File logs session tự động (session_YYYYMMDD_HHMMSS.log)
└── main.py            # Entrypoint & CLI arguments parser
```

### Quy tắc phân lớp:
1. **Interface Segregation**: Mọi Extractor mới phải kế thừa `BaseExtractor` (`core/extractor.py`), Downloader mới phải kế thừa `BaseDownloader` (`core/downloader.py`).
2. **DTOs qua Models**: Giao tiếp giữa Extractor -> Service -> Downloader bắt buộc thông qua model `VideoInfo` (`core/models.py`). Không truyền dict tự do.
3. **Backward Compatibility**: Khi cập nhật method signature hoặc class wrapper (như `Logger`), giữ nguyên các method cũ để không làm gãy các module khác.

---

## 2. Quy tắc Xử lý Playlist & Quản lý Tải (Download Management)

### A. Đồng bộ Ổ cứng & Archive (Disk-to-Archive Sync)
- **Vấn đề**: `yt-dlp --download-archive` chỉ kiểm tra ID trong file text. Nếu người dùng xoá video trên ổ đĩa, file archive vẫn giữ ID khiến `yt-dlp` không tải lại.
- **Quy tắc**:
  - Luôn kiểm tra sự tồn tại thực tế của file trên ổ cứng trước (`is_video_on_disk`).
  - Nếu phát hiện file đã bị xoá khỏi thư mục đích, tự động xoá ID tương ứng trong `db/ytdlp_archive.txt` (`sync_archive_with_disk`).
  - Báo trạng thái chính xác: file có sẵn -> `Already Downloaded`; file bị xoá -> Tải lại từ đầu.

### B. Resume Playlist Thông Minh (Smart Playlist Resume)
- Trước khi tải một Playlist:
  1. Kiểm tra trạng thái từng video trước khi gọi subprocess để tránh gọi `yt-dlp` thừa thãi.
  2. Nếu toàn bộ Playlist đã tải xong: Báo hoàn tất và kết thúc ngay lập tức.
  3. Nếu đang tải dở: Tự động lấy lại độ phân giải đã lưu trong `HistoryService` cho Playlist đó, không hỏi lại người dùng qua menu.
  4. Chỉ gửi các video còn thiếu (`pending_videos`) vào tiến trình tải.

### C. Xử lý URL YouTube Mix / Radio (`list=RD...`)
- **Vấn đề**: YouTube tự gắn `list=RD...` (Mix/Radio) vào URL video có tới 5,000+ bài hát, khiến `yt-dlp` cào API vô tận và bị "treo".
- **Quy tắc**:
  - Nhận diện tham số `list=RD...` hoặc `list=UL...` đi kèm `v=...`, tự động lọc bỏ `list` để tải video đơn lẻ trong 1 giây.
  - Luôn đặt giới hạn `--playlist-end 50` khi quét Playlist thực để tránh loop vô hạn.

---

## 3. Quy chuẩn Logging & Giao diện Terminal (UX & Rich UI)

### A. Giao diện Terminal (Console)
- **Tối giản & Trực quan**: Tuyệt đối không in raw log kỹ thuật của `yt-dlp` (`[youtube] Downloading webpage`, `[Merger] Merging formats...`) ra màn hình.
- **Rich Live Progress Bar**: 
  - Khi tải video, chỉ hiển thị **1 thanh Rich Progress Bar động** duy nhất (`%`, dung lượng, tốc độ, ETA).
  - Tự động chuyển trạng thái khi đang merge/embed metadata (`Merging & embedding metadata...`).
  - Sử dụng chế độ `transient=True` để thanh tiến trình tự biến mất sau khi tải xong, chỉ để lại dòng kết quả `[+] Downloaded: <Title>`.
- **Spinner khi xử lý ngầm**: Sử dụng `Logger._console.status(...)` hiển thị spinner xoay động khi đang trích xuất metadata.
- **Không dùng Divider thừa**: Tránh lạm dụng các đường kẻ `─────────` làm rác terminal.
- **Rich Markup**: Dùng cú pháp `[bold cyan]...[/bold cyan]` thay vì mã màu ANSI escape thô (`\033[95m`) để tránh bị rò rỉ mã `[95m`.

### B. Quản lý File Log (`logs/session_*.log`)
- **Lazy Creation (`delay=True`)**:
  - Ở chế độ bình thường: File log **CHỈ được tạo khi có lỗi (`ERROR`/Exception)**. Nếu chạy thành công, thư mục `logs/` có 0 file rác.
- **Chế độ Debug (`--debug` / `-d`)**:
  - Ghi lại 100% nhật ký (`DEBUG`, `INFO`, yt-dlp command, module & lineno chính xác qua `stacklevel=2`).
- **Clean Formatter**: Tự động lọc sạch các thẻ rich markup `[info][/info]` và mã ANSI trước khi ghi vào file log text thuần.

---

## 4. Chuẩn hoá Cơ sở Dữ liệu (SQLite `history.db`)

Bảng `download_history` cần tuân thủ format dữ liệu chuẩn:

| Cột | Quy chuẩn lưu trữ | Ví dụ hợp lệ | Ví dụ SAI (Cấm lưu) |
|---|---|---|---|
| `title` | Tên thực tế của video | `Hồn Quân Hoàng Phố` | `%(title)s` |
| `format_id` | Độ phân giải ngắn gọn | `1080p`, `720p`, `480p`, `best` | `bestvideo[height<=720]+...` |
| `output_path` | Đường dẫn file thực tế trên đĩa | `/Users/.../video.mkv` | `/.../%(title)s.%(ext)s` |
| `status` | Trạng thái tải | `SUCCESS`, `FAILED` | |
| `playlist_name` | Tên playlist (hoặc `None` nếu video đơn) | `Nhạc Lính` | `None` |

- Khi khởi động `HistoryService`, luôn có migration tự động để dọn dẹp các bản ghi cũ lỗi thời.
- Cung cấp hàm chuyển đổi hai chiều:
  - `InteractivePrompt.to_clean_resolution(format_str)` -> Chuyển format yt-dlp sang `720p`.
  - `InteractivePrompt.to_ytdlp_format(clean_res)` -> Chuyển `720p` sang format yt-dlp khi cần resume.

---

## 5. Xử lý Tín hiệu Ngắt (Ctrl+C / Graceful Exit)

- Tuyệt đối **không nuốt ngoại lệ `KeyboardInterrupt`** trong các hàm input tương tác rồi trả về `None` (sẽ khiến chương trình tưởng user chọn mặc định và tiếp tục chạy).
- Phải `raise KeyboardInterrupt` để tín hiệu ngắt truyền thẳng lên `main.py`.
- Tại `main.py`, bọc `try...except KeyboardInterrupt` để in cảnh báo gọn:
  `[!] Process cancelled by user (Ctrl+C). Exiting...` và thoát với mã `sys.exit(130)` (không in Traceback lỗi).

---

## 6. Automation & Browser (Cloudflare)

- Với các trang web có Cloudflare Turnstile / CAPTCHA:
  - Luôn sử dụng `ChromiumPage` với cấu hình `headless=False` để người dùng có thể can thiệp giải CAPTCHA nếu cần.
  - Tách luồng parse M3U8 từ trình duyệt và đẩy sang `yt-dlp` để tải đa luồng (`concurrency`).
