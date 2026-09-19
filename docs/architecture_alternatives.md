> **CŨ — xem [2026-09-19-danh-gia-lai-kien-truc.md](2026-09-19-danh-gia-lai-kien-truc.md).**
> Đề xuất chính ở đây (viết lại bằng Go/Rust) nhắm vào ~9% dung lượng. Đo lại cho thấy
> 91% nằm ở binary nhúng sẵn; bỏ nhúng đưa bản build từ 482 MB xuống **44 MB** mà không
> phải viết lại dòng nào. Giữ tài liệu này để đối chiếu lập luận.

# Phân Tích Các Phương Án Kiến Trúc & Tối Ưu Dung Lượng

Tài liệu này tổng hợp các phương án thay đổi ngôn ngữ lập trình, thư viện tự động hóa và chiến lược phân phối trình duyệt nhằm giải quyết bài toán kích thước file khổng lồ (~540MB) của phiên bản Python hiện tại.

---

## 1. Ngôn ngữ lập trình & Framework giao diện

Hiện tại dự án sử dụng Python (kết hợp với trình duyệt nhúng) khiến phần lõi nặng khoảng ~70MB. Dưới đây là các phương án thay thế bằng ngôn ngữ biên dịch:

### Rust (kết hợp Tauri)
* **Kích thước lõi:** ~5 - 15 MB.
* **Giao diện:** Tauri sử dụng Native WebView của hệ điều hành (WebKit trên macOS, WebView2 trên Windows) nên tốn **0 MB** cho thành phần hiển thị UI.
* **Ưu điểm:** Kích thước siêu nhỏ, tốn cực kỳ ít RAM, hiệu năng cao nhất.
* **Nhược điểm:** Rust khó học, thời gian phát triển tính năng chậm hơn đáng kể so với Python/Go.

### Golang (kết hợp Wails)
* **Kích thước lõi:** ~15 - 20 MB (do chứa Garbage Collector).
* **Giao diện:** Tương tự Tauri, Wails sử dụng Native WebView, tốn **0 MB** dung lượng.
* **Ưu điểm:** Dễ học, viết code nhanh, xử lý đa luồng (tải video đồng thời) bằng Goroutine vô cùng mạnh mẽ và nhàn nhã.
* **Nhược điểm:** Kích thước nhỉnh hơn Rust vài MB (không đáng kể trong tổng thể), tốn RAM hơn một chút.
* **Đề xuất:** Golang mang lại điểm cân bằng tuyệt vời giữa "kích thước cực nhỏ" và "tốc độ phát triển dự án nhanh".

---

## 2. Thư viện Tự động hóa Trình duyệt (Thay thế DrissionPage)

DrissionPage hiện dùng giao thức CDP để điều khiển Chrome. Nếu chuyển sang Go hoặc Rust, ta có các lựa chọn sau:

* **Ở Golang:**
  * **Go-Rod (`go-rod/rod`):** Lựa chọn số 1. Rất mạnh, giao tiếp trực tiếp qua CDP, ổn định và đặc biệt có plugin `rod-stealth` giúp vượt qua các cơ chế chống bot (Cloudflare, reCAPTCHA) giống như DrissionPage.
  * **Chromedp:** Thư viện lâu đời, phổ biến nhưng cấu trúc code hơi phức tạp hơn và stealth không mạnh bằng Rod.

* **Ở Rust:**
  * **Rust Headless Chrome:** Thư viện phổ biến để điều khiển qua CDP, API trực quan nhưng hệ sinh thái không mạnh và cập nhật nhanh bằng bên Golang.

---

## 3. Chiến lược phân phối Trình duyệt Chromium (Trade-offs)

Vấn đề lớn nhất của dung lượng là cục Chromium nặng **~359 MB**. Dù bạn viết bằng ngôn ngữ siêu nhẹ (Go/Rust), nếu thư viện (Go-Rod/Headless Chrome) vẫn cần Chromium để cào dữ liệu, bạn sẽ phải đối mặt với 3 chiến lược phân phối sau:

### Phương án A: Nhúng sẵn Chromium vào bộ cài (Cách hiện tại)
* **Ưu điểm:** 
  * "Zero-Setup": Người dùng tải về là mở lên chạy ngay.
  * Ổn định vĩnh viễn (Version Lock): Trình duyệt bị ghim ở phiên bản bạn chọn, code lấy link video sẽ không bao giờ vỡ do API cập nhật.
  * Không đụng chạm lịch sử/cookie trình duyệt cá nhân của người dùng.
* **Nhược điểm:** 
  * Dung lượng bộ cài khổng lồ (+359 MB).
  * macOS Gatekeeper thường báo lỗi bảo mật chặn mở app vì một app (`Streamloot.app`) lại chứa một app khác chưa ký chứng chỉ (`Google Chrome.app`) bên trong ruột.

### Phương án B: Không nhúng (Dùng Chrome hệ thống)
* **Ưu điểm:** 
  * Dung lượng phân phối siêu nhẹ (Chỉ 15-50 MB).
* **Nhược điểm:** 
  * **Rất thiếu ổn định:** Chrome của người dùng luôn tự động update ngầm. Nếu Google đổi API CDP hoặc thay đổi lõi trình duyệt, tool của bạn sẽ chết mà không rõ nguyên nhân.
  * Phụ thuộc: Nếu máy người dùng chỉ xài Safari (không cài Chrome/Edge), tool báo lỗi ngay.

### Phương án C: Lazy Download (Tải ngầm ở lần chạy đầu tiên) - 🌟 ĐỀ XUẤT
Thay vì nhét 359MB vào file bộ cài, ta sẽ để bộ cài thật nhẹ (50MB). Khi người dùng mở app lần đầu, app sẽ tự động tải Chromium về thư mục ẩn (ví dụ: `~/Library/Application Support/Streamloot/`).

* **Ưu điểm:**
  * File tải ban đầu rất nhỏ, tạo cảm giác app xịn, nhẹ nhàng. Việc tải thêm dữ liệu ở lần mở đầu tiên là cơ chế người dùng đã quen thuộc (như các game tải thêm data, hoặc VSCode tải extension).
  * Đạt được độ ổn định 100% như Phương án A: Tải đúng bản Chromium (Version Lock) mà bạn cần.
  * Giải quyết hoàn toàn lỗi chữ ký điện tử (Codesign) của macOS Gatekeeper vì Chromium không còn bị giấu trong lõi file `.app` nữa.
* **Nhược điểm:** 
  * Yêu cầu viết thêm logic hiển thị thanh tiến trình (Progress Bar) tải dữ liệu trong UI ở lần khởi động đầu tiên. (Lưu ý: Thư viện `Go-Rod` của Golang có sẵn tính năng tự động tải browser nếu thiếu, tiết kiệm rất nhiều công sức).

---

## 4. Tóm tắt Đề xuất Kiến trúc

Nếu bạn muốn đập đi xây lại hoặc tối ưu tối đa dự án này:
1. **Ngôn ngữ & UI:** Dùng **Golang** kết hợp **Wails** (để loại bỏ việc phải nhúng browser cho giao diện).
2. **Logic cào dữ liệu:** Dùng thư viện **Go-Rod** (thay thế DrissionPage).
3. **Chiến lược phân phối:** Sử dụng mô hình **Lazy Download**. Giữ bộ cài gốc ở mức **~50 MB**. Khởi động app lần đầu sẽ kích hoạt Go-Rod tự tải Chromium tương thích về máy, đồng thời tải thêm tĩnh FFmpeg (nếu Go thuần không xử lý được việc Mux MP4).
