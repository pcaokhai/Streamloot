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
| 2 | `manifest_xml` → DASH | Chất lượng cao hơn nhiều, nhưng tách hình/tiếng nên phải ghép — xem D7 |
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

## 5. Trạng thái xác minh

Cập nhật sau vòng thử tay 19/09.

| # | Điều cần chắc | Trạng thái |
|---|---|---|
| U1 | Progressive URL tải được thành file | **ĐÚNG** — người dùng tải được video Facebook qua đường này |
| U1b | File tải về **có tiếng** | **CHƯA HỎI RÕ** — cần nghe thử một file |
| U2 | Cửa sổ 6 KB đủ bắt `length_in_second` | **MỘT PHẦN** — đo 1/3 video. Thiếu thời lượng không chặn tải |
| U3 | Video trong comment nằm sẵn trong payload | **KHÔNG PHẢI LÚC NÀO CŨNG** — xem §5.1 |
| U4 | URL progressive sống được bao lâu | Chưa đo |

### 5.1. Video trong comment chỉ vào payload sau khi mở

Hai quan sát **khác nhau**, và cả hai đều đúng:

| Loại trang | Video trong comment |
|---|---|
| Trang permalink (bài riêng lẻ) | Nằm sẵn trong payload — đo được 12 manifest / 3 thẻ `<video>` |
| Trang feed (trang doanh nghiệp) | **Chưa** có trong payload; phải bấm mở video đó lên cho nó phát thì mới tải được |

Facebook nạp dữ liệu comment theo nhu cầu, nên trên feed thì manifest của video
trong comment chưa có lúc trang vừa tải.

**Quyết định ban đầu (19/09, sáng): chấp nhận, không moi thêm.** Lý do nêu ra
là muốn moi sớm thì phải tự gọi API nội bộ của Facebook — mong manh.

**ĐÃ ĐỔI (19/09, chiều) — xem D6.** Người dùng yêu cầu thử moi sớm, và lý do tôi
đưa ra hoá ra **không đúng với cách làm khả dĩ nhất**: không cần gọi API nào của
Facebook, chỉ cần QUAN SÁT response mà chính trang đã tự yêu cầu.

### D6. Quan sát response của trang ở world MAIN — ĐÃ THỬ, ĐÃ GỠ

**Trạng thái: Rejected** (19/09, cùng ngày). Giữ mục này lại vì phép đo có giá
trị lâu dài; đừng thử lại hướng này mà không đọc §D6-kết-quả.

**Ý tưởng.** Facebook nạp comment sau khi trang tải. Content script chạy ở world
ISOLATED không thấy `fetch` của trang, nên thêm một script ở world MAIN,
`document_start`, bọc `fetch` và `XMLHttpRequest` để đọc **bản sao** response —
chỉ quan sát thứ trang đã tự yêu cầu, không gọi API nào.

#### D6-kết-quả: KHÔNG CÓ GÌ ĐỂ BẮT

Đo bằng probe bọc đúng như code thật, chạy trong lúc mở rộng comment và cuộn:

| Transport | Response quan sát được | Chứa `dash_manifests` / `progressive_url` / `playable_url` |
|---|---|---|
| `fetch` | **0** | 0 |
| `XMLHttpRequest` | **16** | **0** |

Response comment có `"comment"` và `"attachments"`, nhưng **không** mang dữ liệu
phát. **Facebook chỉ lấy manifest đúng lúc người dùng bấm play.**

Nên D6 không thể đạt mục tiêu của nó — không phải làm sai, mà là **không có dữ
liệu nào tồn tại ở thời điểm đó để mà đọc**.

#### Vì sao gỡ thay vì giữ lại cho tương lai

Bọc API của trang là can thiệp sâu nhất extension này từng có. Cái giá đã hiện ra
ngay: `netwatch.js` xuất hiện trong ngăn xếp của một lỗi **do trang tự gây ra**
(`chrome-extension://invalid/`), làm người dùng nghi oan và mất công điều tra.
Giữ một thứ như vậy mà nó không đổi lại được gì là lỗ vốn thuần.

Xác nhận vô can: gỡ bản bọc rồi cuộn lại cùng feed — lỗi vẫn còn. Nó có từ trước,
do trang hoặc extension khác.

#### Đường còn lại, nếu sau này thật sự cần

`attachments` trong response comment **có thể** mang `video_id` (chưa đo). Có id
thì dựng được URL xem và nhờ backend + yt-dlp, **không cần manifest**. Nhưng
đường đó vẫn phải bọc API của trang, tức trả lại đúng cái giá vừa từ chối — nên
chỉ làm khi có nhu cầu thật, không làm sẵn.

#### Bài học

Quy tắc "thấy dấu hiệu trang bị ảnh hưởng thì gỡ trước, điều tra sau" đã cứu
đúng một lần: nó buộc thu hẹp phạm vi ngay, và phép đo sau đó cho thấy toàn bộ
hướng đi này không có cơ sở. Nếu điều tra trước rồi mới gỡ, chỗ can thiệp sâu
nhất sẽ còn nằm đó thêm vài vòng nữa.

Ngược lại, lần thu hẹp đó cũng gỡ nhầm đúng transport mang dữ liệu (`XMLHttpRequest`),
làm phép đo kế tiếp ra `fetch: 0` và suýt dẫn tới kết luận sai. Bài học: khi thu
hẹp vì lý do KHÔNG phải kỹ thuật, phải ghi rõ mình vừa bỏ mất khả năng quan sát gì.

---



---

## 7. D7 — Đường DASH: gửi manifest sang backend

**Vấn đề.** Progressive dừng ở mức `HD`. Manifest DASH có tới 8 mức, đo được
1200–2560p. Nhưng DASH tách hình khỏi tiếng nên phải ghép.

**Đo trước khi thiết kế.** yt-dlp có đọc được MPD từ file cục bộ không?

```
$ yt-dlp --enable-file-urls -F file:///tmp/fb.mpd
9 format: 8 luồng hình (av01, tới 1200p) + 1 luồng tiếng (mp4a)
nhận đúng là "DASH video" / "DASH audio"
```

**Đọc được.** Nên không phải tự dựng `info.json`: gửi nguyên văn XML sang
backend, ghi ra file tạm, yt-dlp tự chọn luồng và tự ghép bằng ffmpeg thật.

Không dùng được hai dạng khác: đường dẫn trần bị từ chối (`không phải URL hợp
lệ`), còn `file://` mặc định bị tắt vì lý do an toàn.

**Endpoint** `POST /api/v1/downloads/manifest` nhận `{manifest_xml, title,
page_url, format_id}`.

**Ràng buộc an toàn.** `--enable-file-urls` cho yt-dlp đọc file cục bộ, nên:
- chỉ bật cho ĐÚNG lời gọi này, trên ĐÚNG file backend vừa ghi ra;
- đường dẫn do **backend** dựng, không bao giờ lấy từ client;
- chặn đầu vào: phải bắt đầu bằng `<`, và trần 2 MB (MPD thật ~13 KB);
- xoá file tạm trong `finally` — hỏng mà để lại là rác tích dần.

**Chọn theo CHIỀU CAO, không theo id.** `bv*[height=H]+ba/b[height=H]`: id của
luồng do yt-dlp tự đặt từ manifest, không đoán trước được từ phía extension.

**Đánh đổi — nói rõ trong giao diện.** Nhóm này ghi "CHẤT LƯỢNG CAO (cần app)":
khác progressive, đường này **đòi app Streamloot đang chạy**. Người dùng thấy
trước khi bấm, thay vì bấm rồi mới nhận lỗi.

9 test cho endpoint, gồm cả hai ca xoá file tạm (tải xong, và tải hỏng).

---

## 8. D8 — Gắn nút nổi với đúng video, theo thời lượng

**Vấn đề.** Panel liệt kê MỌI video trên trang. Thử tay: trang feed hiện "6
video" trong khi người dùng chỉ thấy một cái nằm cạnh nút. Đúng về kỹ thuật,
sai về thứ người dùng đang hỏi.

D5 đã né chuyện này ("không gán bừa") vì lúc đó không có dữ liệu để thiết kế:
file HTML lưu bằng View Page Source có **0 thẻ `<video>`** — thẻ đó do JS dựng
lúc chạy.

**Tín hiệu tìm được.** Đo trên manifest thật: **mọi MPD đều khai
`mediaPresentationDuration`** (vd `PT30.101334S`). Thẻ `<video>` đang neo cũng
biết `duration` của chính nó. Hai phía cùng biết một con số.

Tín hiệu này tốt hơn `length_in_second` moi từ object cha (§2.2, D5): trường kia
chỉ trúng 1/3 video, còn thời lượng trong manifest thì luôn có. Nên `lengthSec`
giờ ưu tiên đọc từ manifest.

**Quy tắc chọn.** Khớp trong dung sai 1.5 giây. Trả `-1` khi không chắc — và
"không chắc" **bao gồm cả trường hợp có hai video cùng khớp**. Lúc đó hiện cả
danh sách kèm câu "Không chắc video nào", để người dùng tự chọn.

**Vì sao không đoán khi mơ hồ.** Đưa nhầm video là lỗi người dùng **không có
cách nào tự phát hiện** trước khi tải xong — khác hẳn với việc hiện thừa vài
dòng, thứ họ nhìn là biết ngay.

**Giới hạn còn lại.** Hai video cùng độ dài trên một trang thì vẫn phải chọn
tay. Chấp nhận: thêm tín hiệu phụ (tỉ lệ khung hình) chỉ thu hẹp chứ không xoá
được ca mơ hồ, mà lại thêm một chỗ có thể đoán sai.

---

## 9. D9 — Đường lùi cuối: permalink + yt-dlp

Hoàn tất thứ tự ba đường ở D2.

**Khi nào dùng.** Video không có `progressive_urls` lẫn `dash_manifests` — vẫn
gặp trong payload, và trước đây bị bỏ qua hoàn toàn nên không bao giờ hiện ra.

**Cách làm.** Giữ lại video đó nếu dựng được URL xem (`permalink_url`, hoặc
`watch/?v=<id>` từ id số). Panel hiện một dòng "Chất lượng tốt nhất (app tự
chọn)" đi qua `startByUrl` → backend → yt-dlp.

**Chi tiết dễ sai.** Gửi URL **của chính video đó**, không phải `location.href`.
Trang feed có nhiều video, mỗi cái một permalink riêng; gửi URL trang thì backend
tải nhầm cái đầu tiên nó thấy. Vì thế `FormatRow` có thêm `pageUrl`.

**Không giữ video không có đường nào.** `id` rỗng thì không dựng nổi URL, và một
dòng bấm không được là nói dối người dùng — thà không hiện.

**Giới hạn.** Đường này đòi app đang chạy, và yt-dlp phải hỗ trợ đúng dạng URL
đó. Đo trước đây: URL reel thì được, URL trang feed thì `Unsupported URL` — nên
`watch/?v=<id>` là dạng đáng tin hơn để dựng.

---

## 10. Trạng thái tính năng Facebook

| Đường | Cần app? | Chất lượng | Trạng thái |
|---|---|---|---|
| Progressive (D2) | Không | SD / HD | Chạy, đã xác nhận có tiếng |
| DASH qua manifest (D7) | **Có** | tới 1440p+ | Chạy, đã xác nhận |
| Permalink + yt-dlp (D9) | **Có** | app tự chọn | Mới, chưa thử tay |
| Quan sát response (D6) | — | — | **Rejected** — không có dữ liệu để bắt |

Gắn nút với đúng video: theo thời lượng manifest (D8).