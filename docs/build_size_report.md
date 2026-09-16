# Báo Cáo Phân Tích Kích Thước Bản Build (Streamloot.app)

## Tổng quan
Khi build ứng dụng `Streamloot` trên macOS bằng script `build_app.sh`, file kết quả `Streamloot.app` có tổng dung lượng khoảng **540.5 MB**. Mặc dù phần cốt lõi của ứng dụng được viết bằng Python, bản build này được thiết kế theo dạng **self-contained** (nhúng sẵn mọi thành phần cần thiết để chạy trực tiếp mà không yêu cầu người dùng cài đặt thêm phần mềm phụ trợ). Việc nhúng kèm này là nguyên nhân chính làm tăng kích thước ứng dụng.

## Chi tiết Phân Bổ Dung Lượng

Dưới đây là bảng phân tích chi tiết kích thước các thành phần bên trong `Streamloot.app`:

| Thành phần | Kích thước | Chiếm khoảng | Vị trí bên trong App | Giải thích / Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| **Chromium (Chrome for Testing)** | ~359 MB | 66.4% | `Contents/Frameworks/chrome` | Được các extractor sử dụng qua giao thức CDP (`DrissionPage`). Đóng gói riêng giúp tránh đụng tới trình duyệt của người dùng, không bị macOS cảnh báo bảo mật (do lỗi ad-hoc signature), và chống lỗi vặt do Chrome hệ thống tự động cập nhật. |
| **FFmpeg (Static Build)** | ~80.8 MB | 14.9% | `Contents/Frameworks/bin/ffmpeg` | Công cụ bắt buộc để `yt-dlp` có thể gộp (merge) luồng video và audio tải riêng lẻ lại với nhau. |
| **yt-dlp (macOS binary)** | ~37.1 MB | 6.8% | `Contents/Frameworks/bin/yt-dlp` | Bản build độc lập (standalone) chính thức của yt-dlp dành riêng cho macOS. |
| **Python Runtime, Thư viện & UI** | ~68 MB | 12.5% | `Contents/MacOS`, `Contents/Resources` | Lõi thực sự của app, bao gồm môi trường Python, các dependencies và giao diện React UI. |

### Phân tích sâu phần "Python Runtime & Thư viện" (~68 MB)
Phần lõi ứng dụng thực chất rất nhẹ, với các thành phần đáng chú ý nhất bao gồm:
- **`libpython3.12.dylib`** (Thư viện thông dịch Python cốt lõi): 16 MB
- **`Streamloot`** (File bootloader/executable chứa data): 11 MB
- **`lxml`** (Thư viện xử lý XML/HTML): 8.6 MB
- **`pydantic_core`** (Core parser của Pydantic): 3.9 MB
- **`base_library.zip`** (Thư viện chuẩn của Python): 1.3 MB
- **`webview`** (Thư viện chịu trách nhiệm hiển thị cửa sổ app): 1.2 MB
- **Các tài nguyên nhỏ khác** (Giao diện React UI thư mục `apps`, framework macOS `AppKit`, `objc`, biểu tượng, v.v.): ~26 MB

## Hướng dẫn Tối ưu & Giảm dung lượng bản build

Nếu bạn muốn tạo một bản build nhẹ hơn cho mục đích phát triển hoặc nếu môi trường máy tính sử dụng đã cài sẵn các công cụ cần thiết, script `build_app.sh` cung cấp sẵn các tuỳ chọn (flags) để loại bỏ bớt các thành phần nặng nề này:

1. **Loại bỏ Chromium (Giảm ~359 MB):**
   ```bash
   ./build_app.sh --no-chromium
   ```
   *Hệ quả:* Ứng dụng sẽ fallback về việc sử dụng Google Chrome có sẵn trên hệ thống. Tuy nhiên, điều này có thể tiềm ẩn rủi ro liên quan đến tính năng macOS App Management hoặc gây vỡ plugin nếu phiên bản Chrome hệ thống tự động cập nhật lên phiên bản không tương thích.

2. **Loại bỏ FFmpeg (Giảm ~81 MB):**
   ```bash
   ./build_app.sh --no-ffmpeg
   ```
   *Hệ quả:* Ứng dụng sẽ tìm `ffmpeg` trong biến môi trường hệ thống (ví dụ: `/opt/homebrew/bin/ffmpeg`). Nếu máy người dùng không có `ffmpeg`, video tải về qua một số nền tảng sẽ bị lỗi mất tiếng.

Để build bản có dung lượng tối giản nhất (chỉ còn khoảng ~100MB), có thể kết hợp cả hai cờ:
```bash
./build_app.sh --no-chromium --no-ffmpeg
```
