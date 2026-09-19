# ADR 0007: Bắt và tải video Facebook

## Status

**Accepted** (2026-09-19) — mọi con số dưới đây là **đo thật**, không suy đoán:
từ ba trang Facebook người dùng lưu lại (`ref/`, gitignore) và từ `yt-dlp` chạy
trên hai URL thật.

> ADR này chỉ bàn *Facebook*. Kiến trúc bắt stream chung ở
> [ADR 0005](0005-stream-capture-architecture.md); stack extension ở
> [ADR 0006](0006-extension-tech-stack.md).

---

## 1. Context

### 1.1. Vì sao extension không bắt được Facebook

Bộ bắt hiện tại (ADR 0005 §6.3) nhận diện stream qua `webRequest` bằng hai dấu
hiệu: URL khớp `\.(m3u8|mpd)` hoặc `Content-Type` khớp `mpegurl|dash+xml`.

**Facebook không phục vụ manifest qua URL riêng.** Toàn bộ dữ liệu phát nằm
trong payload JSON nhúng thẳng vào HTML trang. Không có request nào để bắt.

Đây là **lỗ hổng kiến trúc**, không phải lỗi: cơ chế bắt dựa trên giả định
"manifest là một tài nguyên mạng", mà Facebook không thoả giả định đó.

### 1.2. Hai URL thật, hai kết quả khác nhau

| URL | `yt-dlp -J` |
|---|---|
| `facebook.com/reel/<id>` | **Đọc được** — 11 format, tách hình/tiếng (`…v` + `…a`, av01) |
| `facebook.com/<tên-trang>` | **`ERROR: Unsupported URL`** |

Hệ quả: với **trang feed và video trong comment**, yt-dlp không làm được gì.
Đường đọc-từ-trang không phải để *nhanh hơn* — nó là đường **duy nhất**.

---

## 2. Đo đạc

### 2.1. Payload chứa nhiều video hơn DOM

Trên một trang permalink có comment chứa video:

| Chỉ số | Giá trị |
|---|---|
| Thẻ `<video>` trong DOM | **3** |
| `dash_manifests` trong HTML | **12** |
| Video **khác nhau** sau khi gộp trùng | 3 (từ 7 lần xuất hiện ở file khác) |

Facebook **lặp lại cùng một video nhiều lần** trong payload (7 lần → 3 id; 4 lần
→ 1 id). Gộp trùng theo `id` là bắt buộc, nếu không panel hiện video ma.

Payload cũng mang sẵn video **chưa cuộn tới** và video **trong comment** — nên
bóc từ HTML cho ra nhiều hơn dò DOM.

### 2.2. Ba đường tải, mỗi video đều có đủ

Mỗi video mang một object giao hàng với `id`, và ba nhóm URL:

| Khoá | Nội dung | Ghi chú |
|---|---|---|
| `progressive_urls` | MP4 **đã gộp sẵn tiếng**, hai mức `SD` và `HD` | `failure_reason: null` ở cả hai |
| `dash_manifests[].manifest_xml` | MPD nhúng nguyên văn | 5–9 `Representation`, tới 1200–2560p |
| `hls_playlist_urls` | — | `failure_reason: NotEligibleForHls` |

Object **cha** (cách đó vài KB) mang `permalink_url`, `length_in_second`,
`is_live_streaming`, `first_frame_thumbnail`.

### 2.3. Cấu trúc MPD của Facebook

| Câu hỏi | Trả lời |
|---|---|
| `BaseURL`? | **Có**, URL tuyệt đối, ~857 ký tự |
| `SegmentTemplate`? | **Không** |
| `SegmentBase` + `Initialization`? | Có (byte range) |
| Tách hình/tiếng? | **Có** — 8 luồng `video/mp4` (av01) + 1 luồng `audio/mp4` (mp4a) |

Vì mỗi `Representation` có **một `BaseURL` là file hoàn chỉnh**, không cần ghép
mảnh: tải thẳng URL đó là ra file. Đây là lý do bộ đọc MPD chỉ cần đọc `BaseURL`
và **cố ý bỏ qua** `SegmentTemplate` (xem §4.2).

### 2.4. Cách của bản tham khảo KHÔNG chạy ở đây

Bản tham khảo (`ref/`, gitignore) `fetch` lại chính URL trang với
`credentials: 'same-origin'` rồi regex tìm manifest trong HTML trả về.

Đo trên trang thật:

| Nguồn | Kích thước | `dash_manifests` |
|---|---|---|
| DOM đang chạy | 7150 KB | **12** |
| `fetch` lại URL | **52 KB** | **0** |

Facebook trả về **vỏ rỗng** cho request đó. **Phải đọc từ DOM đang chạy.**

---

## 3. Quyết định

### D1. Đọc từ DOM đang chạy, không fetch lại trang

Theo §2.4. Content script đọc `document.documentElement.innerHTML`.

**Đánh đổi.** DOM của Facebook rất lớn (7 MB) nên mỗi lần đọc là một lần tạo
chuỗi 7 MB. Chỉ đọc khi người dùng **mở panel**, không đọc theo nhịp.

### D2. Progressive trước, DASH sau, permalink cuối

| Thứ tự | Đường | Vì sao |
|---|---|---|
| 1 | `progressive` | Một URL, **đã có tiếng**, tải thẳng — không phải ghép gì |
| 2 | `manifest_xml` → DASH | Chất lượng cao hơn nhiều, nhưng tách hình/tiếng nên phải ghép |
| 3 | `permalink_url` / `watch/?v=<id>` | Nhờ backend + yt-dlp |

### D3. KHÔNG nhúng ffmpeg-wasm

Bản tham khảo tải trong trình duyệt được là nhờ nhúng ffmpeg biên dịch sang
WebAssembly (**4.86 MB** wasm + 202 KB loader + 172 KB worker), chạy trong Web
Worker do một offscreen document làm chỗ chứa — vì service worker MV3 không tạo
được worker.

**Họ cần vì họ không có backend.** Ta có.

Và §2.2 cho thấy ta **không cần ghép** cho đường chính: progressive đã gộp sẵn.
Nên đường tải-trong-trình-duyệt chỉ là `fetch` một URL rồi lưu.

**Cái giá của quyết định này:** chất lượng trong trình duyệt giới hạn ở mức
`HD` của progressive. Muốn 1200p+ (DASH) thì phải ghép → đi đường backend.

**Điều kiện xét lại:** nếu đo được rằng `HD` progressive thấp hơn hẳn mức DASH
cao nhất trên phần lớn video *và* người dùng thường xuyên cần mức cao khi app
chưa chạy, thì cân nhắc lại ffmpeg-wasm — nhưng chỉ khi đó.

### D4. Gộp trùng theo `id`, bỏ qua luồng trực tiếp

§2.1: cùng một video xuất hiện tới 4 lần. Gộp theo `id`.

Bỏ video `is_live_streaming` — tải một luồng đang phát là tải mãi không dừng, và
người dùng phải biết trước chứ không phải phát hiện khi ổ đĩa đầy.

### D5. Không gán bừa trường của object cha

`permalink_url` và `length_in_second` nằm ở object **cha**, cách object giao
hàng vài KB. Ta tìm trong một cửa sổ 6 KB phía trước.

Đây là **suy đoán theo khoảng cách**, không phải quan hệ chắc chắn. Nên khi
không thấy thì trả `null` chứ **không mượn của video khác** — thà thiếu một
đường dự phòng còn hơn gán nhầm permalink của video bên cạnh.

Đo thật: 3/3 video lấy được permalink, nhưng chỉ **1/3** lấy được thời lượng.
Cửa sổ này còn chỗ cải thiện; hiện tại thiếu thời lượng không chặn việc tải.

---

## 4. Hệ quả

### 4.1. Module mới

| Module | Việc | Test |
|---|---|---|
| `lib/dash.ts` | Đọc MPD → `Representation` (URL, kích thước, bitrate, hình/tiếng) | 15 |
| `lib/facebook.ts` | Bóc video khỏi HTML → id, progressive, MPD, permalink | 19 |

Cả hai **thuần** — không DOM, không mạng — nên chạy được dưới node (ADR 0006).

### 4.2. Giới hạn cố ý của bộ đọc MPD

Chỉ đọc `BaseURL` dạng URL tuyệt đối. MPD dùng `SegmentTemplate` phải ghép mảnh
mới ra file; việc đó thuộc tầng tải chứ không phải tầng đọc.

Thấy dạng đó thì **trả rỗng** để người gọi đi đường khác — **không** trả danh
sách nửa vời khiến họ tưởng tải được. §2.3 cho thấy Facebook không dùng dạng này,
nhưng giới hạn vẫn được ghi rõ vì nó là một giả định có thể sai ở site khác.

### 4.3. Tự viết bộ đọc XML thay vì dùng thư viện

Service worker MV3 **không có `DOMParser`**. Mọi thư viện XML đều kéo theo một bộ
phân tích DOM riêng (bản tham khảo gói hẳn một cái). Ta chỉ cần vài thuộc tính
của `<Representation>`, nên đọc bằng regex là đủ và giữ được module thuần.

### 4.4. Riêng tư

HTML người dùng lưu lại chứa dữ liệu phiên đăng nhập. Nó nằm trong `ref/` (đã
gitignore), **chỉ dùng để đối chiếu cấu trúc**. Toàn bộ test dùng dữ liệu tự
dựng với `example.test`.

---

## 5. Chưa xác minh

| # | Điều chưa chắc | Sẽ lộ ra khi |
|---|---|---|
| U1 | Progressive URL **thật sự có tiếng** — suy từ lược đồ Facebook, chưa mở được file vì cần phiên đăng nhập | Thử tải thật |
| U2 | Cửa sổ 6 KB có đủ bắt `length_in_second` cho mọi video không (đo: 1/3) | Thử trên nhiều trang |
| U3 | Video trong comment có nằm trong payload ở **mọi** loại trang không, hay chỉ trang permalink | Thử trên feed chính |
| U4 | URL progressive sống được bao lâu (có chữ ký, hết hạn) | Thử tải sau vài phút |
