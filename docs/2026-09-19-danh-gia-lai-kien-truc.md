# Đánh giá lại đề xuất kiến trúc (19/09/2026)

Đọc lại [architecture_alternatives.md](architecture_alternatives.md) và
[build_size_report.md](build_size_report.md), đối chiếu với **omniget** (Tauri +
Rust, bản nguồn trong `ref/`, đã gitignore — chỉ đọc kiến trúc) và với **những
gì đã đo được trên chính repo này**.

Kết luận ngắn: **hai tài liệu cũ nhắm vào 9% của vấn đề.** Đổi ngôn ngữ không
giải quyết được cái nặng; bỏ nhúng binary thì giải quyết được, mà không cần
viết lại dòng nào.

---

## 1. Số liệu đo lại

Báo cáo cũ ghi 540 MB. Đo lại bản build hiện tại:

| Thành phần | Kích thước | Tỉ lệ | Có bắt buộc không |
|---|---:|---:|---|
| Chromium | 359 MB | **74.5%** | Chỉ cho 3 plugin riêng tư, đường "dán URL vào app" |
| ffmpeg | 43 MB | 8.9% | Có — ghép hình/tiếng |
| yt-dlp | 35 MB | 7.3% | Có |
| Python + thư viện + UI | ~45 MB | 9.3% | Có |
| **Tổng** | **482 MB** | | |

**Binary nhúng sẵn chiếm 91%. Lõi Python chiếm 9%.**

## 2. Vì sao đề xuất cũ nhắm sai chỗ

Tài liệu đề xuất viết lại bằng Go + Wails (hoặc Rust + Tauri).

Đổi ngôn ngữ chỉ tác động vào **45 MB** đó. Go/Wails cỡ 15–20 MB, tức tiết kiệm
**~25–30 MB trên tổng 482 MB — khoảng 6%.**

Cái giá: viết lại toàn bộ backend, service tải, quản lý task, SSE, plugin
system, và phần nối với extension. Toàn bộ những gì đã dựng và đã sửa qua
20 lỗi ghi trong nhật ký thử tay.

**Đổi 6% dung lượng lấy một lần viết lại là đánh đổi tệ.** Không phải vì Go hay
Rust dở — mà vì chúng không chạm tới 91% còn lại. Chromium vẫn 359 MB dù viết
bằng gì, nếu vẫn nhúng nó.

Tài liệu cũ có nhận ra điều này ở §3 ("Dù bạn viết bằng ngôn ngữ siêu nhẹ… bạn
vẫn phải đối mặt với 3 chiến lược phân phối"), nhưng rồi §4 vẫn xếp "đổi ngôn
ngữ" lên đầu danh sách đề xuất. Thứ tự đó nên đảo lại.

## 3. Chromium dùng cho việc gì — đo, không đoán

```
Kế thừa BaseBrowserExtractor (cần Chromium):  3 plugin riêng tư
Kế thừa BaseExtractor (không cần):            YouTube + mọi site khác
```

`BaseBrowserExtractor` ghi rõ mục đích: *"Sites requiring Cloudflare bypass"*.

Tức 359 MB tồn tại để vượt Cloudflare cho **3 site**, trên **một đường duy
nhất**: người dùng dán URL vào cửa sổ app.

### 3.1. Đường đó giờ đã có thứ thay thế tốt hơn

Extension bắt manifest **trong chính phiên duyệt web thật của người dùng** —
phiên đã qua Cloudflare rồi. Đó không phải cách vượt Cloudflare kém hơn headless
Chromium; nó **là** một phiên thật, nên tốt hơn hẳn.

Suốt phiên làm việc 16–19/09, mọi lượt tải từ 3 site đó đều đi qua extension.
Chromium không được chạm tới lần nào.

Kiểm thêm: **không plugin riêng tư nào xử lý playlist** (đếm được 0), nên đường
app cũng không giữ năng lực riêng nào về khoản đó.

**Chromium hiện là đường lùi cho một đường đang thừa dần.**

## 4. omniget dạy được gì

Cùng bài toán, cùng mô hình (app + extension + cầu HTTP cục bộ), nhưng:

| | Streamloot | omniget |
|---|---|---|
| Ngôn ngữ / UI | Python + pywebview | Rust + Tauri (webview hệ điều hành) |
| Chromium | **Nhúng 359 MB** | **Không có, một dòng cũng không** |
| yt-dlp, ffmpeg | Nhúng 78 MB | `externalBin: None` — tải lúc chạy, có quản lý phiên bản |
| Cầu cho extension | FastAPI | `axum` + CORS |
| HLS | Nhờ yt-dlp | `m3u8-rs` + `aes`/`cbc` — tự phân tích, tự giải mã |
| Cookie | Không | Có module `cookies/` đọc từ trình duyệt người dùng |

Hai điều đáng lấy, và **không điều nào đòi đổi ngôn ngữ**:

**(a) Không nhúng binary.** omniget có hẳn `core/binary_versions.rs` lo lưu bản
cũ, cắt tỉa, và **rollback**. Chi tiết đó nói lên một điều: tải lúc chạy *có*
hỏng, nên phải chuẩn bị đường lùi. Đây là cảnh báo thực tế cho phương án C mà
tài liệu cũ mô tả hơi lạc quan.

**(b) Không cần Chromium để làm một trình tải video tử tế.** omniget phục vụ
nhiều nền tảng bằng extractor viết tay + cookie + extension, không cần trình
duyệt nhúng. Nó là bằng chứng tồn tại, không phải lý thuyết.

## 5. Đề xuất mới, xếp theo giá trị trên chi phí

### Bước 1 — Bỏ nhúng Chromium *(482 MB → 123 MB, giảm 74%)*

Cờ `--no-chromium` **đã có sẵn** trong `build_app.sh`. Việc cần làm là biến nó
thành mặc định và xử lý hệ quả:

- Khi một plugin riêng tư cần trình duyệt mà không có: báo rõ "site này cần mở
  qua extension", chứ không để hỏng lặng lẽ.
- Tuỳ chọn tải Chromium về sau, cho ai thật sự cần đường dán-URL.

Chi phí: vài giờ. Không viết lại gì.

Đây cũng **xoá luôn vấn đề Gatekeeper** mà báo cáo cũ nêu: `.app` không còn chứa
một `.app` chưa ký bên trong.

### Bước 2 — Tải yt-dlp và ffmpeg lúc chạy *(123 MB → ~45 MB)*

Theo cách omniget làm, kèm những thứ họ đã phải làm:

- Ghim phiên bản, kiểm checksum.
- Giữ bản cũ để rollback khi bản mới hỏng.
- Có tiến trình tải rõ ràng ở lần chạy đầu.
- yt-dlp cần cập nhật thường xuyên (site đổi liên tục) — nên tải-lúc-chạy còn
  **có lợi**, không chỉ nhẹ hơn.

Chi phí: vài ngày. Vẫn không viết lại gì.

### Bước 3 — Chỉ khi đó mới bàn đổi ngôn ngữ

Sau hai bước trên, bản cài còn ~45 MB, và **toàn bộ phần còn lại là Python**.
Lúc đó câu hỏi "có nên viết lại bằng Go/Rust không" mới sáng sủa: đổi 45 MB lấy
15 MB, tức tiết kiệm 30 MB trên một bản cài đã nhẹ.

Nói thẳng: khi đó nó gần như chắc chắn **không đáng**. Lý do đổi ngôn ngữ nếu có
sẽ là hiệu năng hoặc khả năng bảo trì, không phải dung lượng.

## 6. Rủi ro và chỗ chưa đo

| # | Chưa chắc | Ảnh hưởng |
|---|---|---|
| R1 | 3 site riêng tư có **luôn** tải được qua extension không, hay có ca cần đường app | Quyết định Chromium là "tuỳ chọn" hay "bỏ hẳn" |
| R2 | Người dùng trên mạng chậm sẽ thấy lần chạy đầu ra sao | UX bước 2 |
| R3 | Tải binary từ GitHub có bị chặn ở một số mạng không | Cần đường lùi thủ công |
| R4 | ffmpeg 43 MB có bản gọn hơn không (chỉ cần muxing, không cần encode) | Có thể giảm thêm trước cả bước 2 |

R4 đáng đo sớm: nếu một bản ffmpeg chỉ-mux nhỏ hơn nhiều thì bước 2 bớt gấp.

## 7. Điều nên sửa trong hai tài liệu cũ

- `build_size_report.md`: số liệu 540 MB đã cũ, thực tế 482 MB.
- `architecture_alternatives.md`: §4 nên đảo thứ tự — chiến lược phân phối
  trước, đổi ngôn ngữ sau (hoặc bỏ). Và đoạn "Go-Rod tự tải browser" không còn
  liên quan nếu kết luận là **không cần browser**.
