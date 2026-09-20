# Hỗ trợ Instagram + tính năng tải bộ ảnh (đã revert)

**Ngày:** 20/09/2026
**Trạng thái:** phần VIDEO đã chạy được và giữ lại. Phần ẢNH đã revert về `dd72ff3`.
**Người ghi:** phiên làm việc với Claude Code.

Tài liệu này ghi lại đầy đủ: đã làm gì, đo được gì, sai ở đâu, vì sao dừng, và
nếu quay lại thì nên bắt đầu từ đâu.

---

## 1. Bối cảnh

Yêu cầu ban đầu gồm hai phần:

1. Refactor: video tải từ site nào thì lưu vào thư mục con mang tên site, trong
   thư mục `downloader` chung.
2. Thêm hỗ trợ tải video từ Instagram.

Sau khi hai phần trên xong, phát sinh yêu cầu thứ ba: tải **tất cả ảnh** của một
bài nhiều ảnh (carousel). Phần này đã làm, thử tay 5 lượt, không đạt, và được
revert theo yêu cầu.

---

## 2. Phần đã hoàn thành và GIỮ LẠI

### 2.1. Thư mục con theo site — `utils/sites.py`, `lib/filename.ts`

**Vấn đề:** mọi video đổ chung vào `~/Downloads/downloader`, sau vài chục lượt
tải thì không tìm được gì.

**Cách làm:** hai hàm thuần, cùng quy ước, mỗi bên một ngôn ngữ.

| Nơi | Hàm | Việc |
| --- | --- | --- |
| Backend | `utils/sites.py::site_folder(url)` | Suy tên thư mục từ hostname |
| Extension | `lib/title.ts::brandOf(hostname)` | Như trên, cho đường tải thẳng |
| Extension | `lib/filename.ts::downloadName({folder})` | Ghép `<thư mục>/<tên file>` |

Quy tắc: lấy nhãn đầu tiên có nghĩa của hostname, bỏ tiền tố vô nghĩa
(`www`, `m`, `mobile`, `video`, `watch`, `player`) để `m.vidu.com` và
`www.vidu.com` không thành hai thư mục. Lọc ký tự an toàn cho tên thư mục trên
cả macOS lẫn Windows. Không bao giờ trả rỗng (rỗng là file rơi vào thư mục gốc,
lẫn với mọi lượt tải khác).

**Không dùng danh sách site viết cứng** — vừa không bao giờ đủ, vừa là thứ
CLAUDE.md §3.1 cấm.

Cắm vào `downloaders/ytdlp.py` ngay trước `os.makedirs`, sau khi chốt
`output_dir` mặc định và trước nhánh `playlist_name` (nên playlist nằm *trong*
thư mục site).

**Test:** `tests/test_sites.py` — 10 ca. Mutation check: bỏ lọc tiền tố, bỏ
sanitize, bỏ fallback → cả ba đều đỏ.

Trong lúc mutation check phát hiện hai guard trùng nhau che nhau (guard
`if not host: return FALLBACK` ở đầu và `return name or FALLBACK` ở cuối). Đã bỏ
cái thừa, giữ cái cuối.

### 2.2. Gửi link riêng của video trên feed — `lib/permalink.ts`

**Vấn đề đo được:** ở `instagram.com` (trang feed), extension gửi `location.href`
cho backend → `ERROR: Unsupported URL: https://www.instagram.com/`.

**Cách làm:** `deeperPermalink(pageUrl, hrefs)` — leo từ video đang neo lên tìm
thẻ `<a>`, chọn link cùng origin có ít nhất 2 đoạn đường dẫn, **ngắn nhất**.

Hai lần sửa luật xếp hạng, cả hai đều do đo thật:

| Bản | Luật | Hỏng ở đâu |
| --- | --- | --- |
| 1 | Link **sâu nhất** sâu hơn trang hiện tại | Ở `/p/DdgE3pBznaC/` nó vớ phải `/explore/locations/<id>/<tên>/` → Unsupported URL |
| 2 (đang dùng) | Trang đã sâu ≥ 2 đoạn thì **không thay**; còn lại lấy link **ngắn nhất** có ≥ 2 đoạn | — |

Lý do luật 2 đúng: link 1 đoạn là trang cá nhân, link dài nhất là địa điểm hay
hashtag, link video luôn có dạng `/<loại>/<mã>`. Thuần theo độ sâu đường dẫn nên
chạy cho mọi feed, không nhận diện theo site.

Dùng cho cả ba đường: `formatsByUrl`, `startByUrl`, `startByManifest`.

**Test:** `tests/permalink.test.mjs` — 12 ca. Mutation check 3 nhánh đều đỏ.

### 2.3. Mức chất lượng theo cạnh ngắn — `lib/formats.ts::qualityHeight`

**Đo được:** `yt-dlp -J` trên một reel trả `1080x1920`. Ta lấy chiều cao nên
panel hiện "2K · 1920p", trong khi người dùng và mọi công cụ khác gọi là 1080p.

**Cách làm:** backend gửi thêm `width` (`downloaders/ytdlp.py`), extension đặt
tên mức theo `min(width, height)`. Dùng cho cả cột tên, cột độ phân giải, và
thứ tự sắp xếp.

Kèm: format không khai độ phân giải (Instagram trả `format_id` 1/2/3 không có
width/height/codec) giờ ghi **"Tiêu chuẩn"** ở cột tên và để trống cột độ phân
giải, thay cho "Chất lượng không rõ".

**Test:** 5 ca mới trong `tests/formats.test.mjs`.

### 2.4. Bỏ response một-mảnh — `lib/capture.ts::isPartial`

**Triệu chứng:** tải được file 9.1 MB từ feed Instagram, trình phát báo
`Cannot open file or stream`.

**Nguyên nhân đo được:** trình phát Instagram kéo video theo **range request**.
Extension bắt trúng một khúc, thấy `Content-Type: video/mp4` nên tưởng là file
hoàn chỉnh và đưa vào dòng tải thẳng. Tải xong ra một mẩu giữa file, không có
header mp4.

**Cách làm:** `isPartial(statusCode, headers)` — HTTP 206 hoặc có header
`Content-Range` thì là mảnh. `worthCapturing` trả `false` cho mảnh, dù lớn cỡ
nào. Nhận ra bằng chính giao thức, không cần biết là site nào.

Lúc đó panel chỉ còn dòng **"Qua app"**, và yt-dlp tải được cả file.

**Test:** 8 ca mới trong `tests/capture.test.mjs`. Mutation check 3 nhánh đều đỏ.

**Rủi ro còn lại:** CDN nào trả 206 cho cả file thì sẽ mất dòng tải thẳng (vẫn
còn đường qua app). Chưa gặp, chưa xử lý.

### 2.5. Đã xác nhận chạy được trên Instagram

Thử tay 20/09: mở bài `/p/DdgE3pBznaC/`, panel liệt kê đủ mức (1080p / 720p /
540p / Tiêu chuẩn / Audio), bấm 1080p, tải và ghép tiếng xong, file nằm đúng
`<Downloads>/instagram/`.

Đo độc lập bằng CLI để loại trừ yt-dlp khỏi vòng nghi vấn:

```
yt-dlp -f "dash-1752509725866791v+bestaudio/dash-1752509725866791v" <url>
→ [Merger] Merging formats into "ig-test.mp4"  (6.16 MB, có tiếng)
```

---

## 3. Phần ĐÃ REVERT: tải bộ ảnh carousel

Các commit đã gỡ: `04c9a72`, `50c2d3f`, `2d48686`, `5c89c72`, `23b4f22`.
Commit revert: `f55b6e3`. Cây mã hiện khớp chính xác `dd72ff3`.

### 3.1. Vì sao không đi đường backend

`yt-dlp` **không** tải được ảnh Instagram. Đo trực tiếp trong mã nguồn extractor:

```
/opt/homebrew/Cellar/yt-dlp/2026.8.19/.../yt_dlp/extractor/instagram.py:111
    if node.get('__typename') != 'GraphVideo' and node.get('is_video') is not True:
        continue
```

Node không phải video bị bỏ qua hoàn toàn. Nên ảnh bắt buộc phải làm bên
extension.

Mặt tốt: ảnh dễ hơn video nhiều — JPEG hoàn chỉnh, không chia mảnh, không phải
ghép tiếng. `chrome.downloads` tải thẳng được, app không cần mở.

### 3.2. Thiết kế đã thử

1. Nút nổi neo được cả vào `<img>`, không chỉ `<video>`.
2. Bấm nút → panel tự bấm nút "sang ảnh kế" của carousel, gom `<img>` sau mỗi
   lượt, tối đa 20 lượt.
3. Hiện một dòng **ẢNH · Tải tất cả · N ảnh**.
4. Bấm → tải tuần tự vào `<Downloads>/<site>/<tên bài>/`, đánh số đệm 0.

Module thuần `lib/gallery.ts` (17 test, tất cả xanh):

| Hàm | Việc |
| --- | --- |
| `bestSrc(el)` | Lấy bản to nhất trong `srcset` (src chỉ là bản vừa màn hình) |
| `photoKey(url)` | Khoá dedupe = pathname, bỏ query cỡ ảnh |
| `collectPhotos(els, minPx)` | Lọc ảnh nhỏ, khử trùng, giữ thứ tự gặp |
| `photoExt(url)` | Đuôi ảnh, lạ thì `jpg` |
| `photoIndex(i, total)` | Số thứ tự đệm 0 (không đệm thì 10 đứng trước 2) |

Tìm nút "next" theo `aria-label` khớp `/next|tiếp|sau/i` — tên class của
Instagram là chuỗi băm, đổi mỗi lần build.

### 3.3. Năm vòng sửa, và sai ở đâu

| Vòng | Triệu chứng người dùng báo | Nguyên nhân tìm ra | Sửa |
| --- | --- | --- | --- |
| 1 | Bài ảnh không có nút tải nào | Tôi chặn "chỉ xét ảnh khi trang không có video" — feed nào cũng có video nên nhánh ảnh chết hẳn. Thêm nữa, luật chọn "đang phát trước, rồi lớn nhất" luôn kéo nút về video bài khác | `pickAnchor` nhận thêm vị trí con trỏ |
| 2 | Nút nằm chệch sang trái bài; bài 4 ảnh chỉ gom 2 | Dùng **một phép đo cho hai câu hỏi khác nhau**: neo nút phải hỏi cỡ *trên màn hình* (avatar IG là file 320×320 hiển thị 32px), gom ảnh phải hỏi cỡ *gốc* (slide đang trượt vào có bề rộng hiển thị 0) | Tách hai phép đo |
| 3 | Rê tay tới nút thì nút ẩn mất | Code neo-lại đặt **trước** phép kiểm vùng giữ nút, mà nút nằm ngoài hình | Đảo thứ tự |
| 4 | Nút nhảy loạn khi lướt slide; vẫn thiếu ảnh | Lướt là IG tháo tấm ảnh cũ khỏi DOM → phần tử neo biến mất → observer gọi `place()` hàng chục lần. Và chờ cứng 450ms là sai cách — ảnh chưa tải xong thì `naturalWidth` = 0 | Khoá neo vào `<article>` khi panel mở; chờ theo kết quả (chụp mỗi 150ms tới khi có ảnh mới) |
| 5 | Rời chuột khỏi ảnh thì nút bay sang mép phải; panel hiện VIDEO thay vì ẢNH | `place()` lùi về luật cũ khi con trỏ ra ngoài. Và nhánh ảnh đòi `!cap`, mà capture gom theo **tab** chứ không theo bài | Giữ neo cũ; `photoMode` không phụ thuộc `cap` |

Sau vòng 5 vẫn chưa đạt → revert.

### 3.4. Bài học thật sự

**Cả 5 vòng đều đoán từ ảnh chụp màn hình, không phải đo.** Không có lần nào
tôi biết được: con trỏ lúc đó ở toạ độ nào, `place()` được gọi bao nhiêu lần,
`collectPhotos` nhận vào mấy phần tử và loại đi mấy cái vì lý do gì.

Phần quyết định (`lib/gallery.ts`) test đầy đủ và **chưa từng sai**. Toàn bộ lỗi
nằm ở phần DOM — đúng phần ADR 0006 nói là không test được. Vậy nên cách làm
đúng không phải "viết cẩn thận hơn" mà là **kéo thêm phần nữa ra khỏi DOM**.

---

## 4. Nếu quay lại: phương án đề xuất

### Bước 0 (bắt buộc trước khi viết lại) — dựng trang giả lập

Tạo `apps/extension/tests/fixtures/carousel.html`: một `<article>` có 4 ảnh,
nút next/prev đúng `aria-label`, ảnh tải chậm giả lập bằng `setTimeout`, avatar
320×320 hiển thị 32px.

Rồi test bằng jsdom hoặc Playwright. Lý do: 5 vòng sửa vừa rồi tốn khoảng một
buổi và lượt nào cũng phải nhờ người dùng thử tay. Một trang giả lập chạy trong
2 giây sẽ bắt được cả 5 lỗi đó.

ADR 0006 nói "DOM không test được" — đúng với **panel trong shadow DOM**, không
đúng với **logic lướt carousel**. Cái sau chỉ cần một `document` là chạy được.

### Bước 1 — tách thêm quyết định ra khỏi DOM

Ba thứ đang nằm trong content script mà lẽ ra phải là hàm thuần:

1. **Chọn phần tử neo khi con trỏ đổi chỗ.** Hiện là một chuỗi `if` trong
   `onMove` + `place()`. Nên là `nextAnchor(current, candidates, cursor, mounted)`
   trả về *chỉ số hoặc "giữ nguyên"*. Bốn trong năm lỗi ở trên nằm ở đây.
2. **Khi nào được neo lại.** `mounted`, con trỏ trong/ngoài vùng giữ nút, phần
   tử neo còn trong DOM hay không — ba biến, tám tổ hợp, hiện đang rải rác.
3. **Điều kiện dừng lướt carousel.** `sweepDone(shots, clicks, maxClicks)`.

### Bước 2 — cân nhắc bỏ hẳn cách "tự bấm next"

Tự bấm nút của trang là cách mong manh nhất trong cả thiết kế: nó phụ thuộc
`aria-label`, phụ thuộc animation, và làm trang thay đổi trạng thái trước mắt
người dùng (họ thấy carousel tự chạy — chính người dùng đã phàn nàn điều này).

Hai hướng thay thế, chưa hướng nào được đo:

| Hướng | Ý tưởng | Cần xác minh |
| --- | --- | --- |
| A | Đọc thẳng dữ liệu bài từ state của trang, thay vì lướt DOM | Instagram có nhúng JSON nào trong trang không, và nó có `carousel_media` không. Cách kiểm: `document.documentElement.innerHTML.match(/carousel_media/)` trên một bài nhiều ảnh |
| B | Bắt request ảnh qua `webRequest` như đang làm với video | Ảnh đã xem thì đã tải, nhưng ảnh chưa lướt tới thì chưa — có thể vẫn phải lướt. Đo trước: mở bài 4 ảnh, xem `webRequest` bắt được mấy URL ảnh |

Nếu A chạy được thì nó thắng tuyệt đối: không đụng vào trang, không animation,
lấy đủ ảnh trong một nhịp, và biết trước tổng số ảnh.

### Bước 3 — số ảnh mong đợi phải biết trước

Lỗi "tải thiếu ảnh" khó nhận ra vì không có gì để đối chiếu. Carousel có dãy
chấm ở dưới, mỗi chấm một ảnh — đếm số chấm là biết tổng. Có tổng rồi thì panel
nói được "gom 2/4, thử lướt chậm hơn" thay vì im lặng tải 2 cái.

### Bước 4 — thứ tự làm

1. Trang giả lập + test (bước 0).
2. Đo hướng A (đọc JSON trong trang). Nếu được thì bỏ hẳn phần lướt DOM.
3. Nếu A không được: tách `nextAnchor` và `sweepDone` thành hàm thuần, test
   bằng trang giả lập, rồi mới nối vào content script.
4. Đếm chấm để biết tổng, báo "N/M" khi gom hụt.

---

## 5. Tham chiếu

| Thứ | Ở đâu |
| --- | --- |
| Commit giữ lại | `21eb14f`, `67c6378`, `9a70b9d`, `dd72ff3` |
| Commit đã gỡ | `04c9a72`, `50c2d3f`, `2d48686`, `5c89c72`, `23b4f22` |
| Commit revert | `f55b6e3` |
| Quy tắc test extension | ADR 0006 |
| Quy tắc quyền riêng tư plugin | CLAUDE.md §3.1 |
| Bắt video Facebook/feed | ADR 0007 |
