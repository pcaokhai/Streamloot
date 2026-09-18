# Hồi cứu gỡ lỗi — Streamloot, 16–19/09/2026

Tài liệu này ghi lại **quá trình** gỡ lỗi, không chỉ kết quả: mỗi lỗi đi kèm
cách phát hiện, bằng chứng dùng để kết luận, các lựa chọn đã cân nhắc và cái
giá của lựa chọn đã chọn.

Viết ra vì ba lý do:
1. Vài lỗi lặp lại **cùng một nguyên nhân gốc** ở chỗ khác nhau. Nhìn từng lỗi
   riêng lẻ thì không thấy quy luật; xếp cạnh nhau thì thấy ngay.
2. Vài lần tôi (AI) kết luận sai, hoặc sửa một triệu chứng rồi tưởng đã xong.
   Ghi lại cả những lần đó, vì che đi thì tài liệu này thành quảng cáo.
3. Vài cái bẫy nằm ở **công cụ**, không ở code — và chúng suýt làm tôi đẩy code
   chưa kiểm lên một repo công khai.

Nhật ký theo từng lỗi: [2026-09-17-manual-test-bug-log.md](2026-09-17-manual-test-bug-log.md).
Các sai lệch so với spec: [2026-09-17-extension-ui-deviations.md](2026-09-17-extension-ui-deviations.md).

---

## 1. Bốn họ lỗi lặp lại

Phần giá trị nhất của tài liệu này. 18 lỗi đã ghi, nhưng chúng quy về bốn gốc.

### Họ A — Gộp hai trạng thái phân biệt được thành một kết quả không phân biệt được

Xuất hiện **nhiều lần nhất**. Dạng chung: một hàm có thể thất bại vì hai lý do
khác hẳn nhau, nhưng trả về cùng một giá trị, nên người gọi không thể xử lý
đúng — và người dùng nhận một thông báo vô dụng.

| Chỗ | Hai trạng thái bị gộp | Hậu quả thật |
|---|---|---|
| `refreshTasks()` | "không có task nào" vs "không hỏi được backend" | Cả hai trả `[]` → vòng poll dừng khi app chỉ tạm bận |
| `health()` | "app chưa chạy" vs "app từ chối extension" | Người dùng sửa sai chỗ, mất hàng giờ |
| `probe_duration()` | "đo ra 0 giây" vs "không đo được" | Xếp hạng stream sai, chọn nhầm quảng cáo |
| `formatsByUrl` cache | "yt-dlp không hỗ trợ site" vs "app chưa chạy" | Cache lỗi kết nối vĩnh viễn; mở app lên cũng vô ích |
| Panel "Đang lấy danh sách…" | "đang chờ" vs "đã hỏng" | Treo vĩnh viễn, không ai biết là hỏng |
| `variantsFromManifest` | "đọc được, không có biến thể" vs "không đọc được" | Nếu trả `[]` cho cả hai thì mất đường lùi về backend |

**Cách sửa chung.** Trả về kiểu phân biệt được: `null` ≠ `[]`, hoặc một enum ba
trạng thái thay vì boolean. Và ở tầng giao diện, **luôn có nhánh `.catch`** —
một promise bị ném không ai bắt trông y hệt một promise đang chạy.

**Cách phát hiện.** Câu hỏi để tự kiểm: *"Hàm này trả giá trị X trong bao nhiêu
tình huống khác nhau? Người gọi có cần phân biệt chúng không?"*

### Họ B — Tin vào trạng thái được suy ra, thay vì đo cái đang có thật

| Chỗ | Trạng thái được "nhớ" | Vì sao sai |
|---|---|---|
| `anchored` (tham chiếu `<video>`) | phần tử chọn từ trước | Player SPA dựng lại phần tử; node rời DOM trả rect toàn số 0 mà **không ném, không báo** |
| `hovering` (cờ đang rê chuột) | suy từ cạnh vào/ra | Con trỏ sang `<iframe>` thì document gốc ngừng nhận `mousemove` → cờ đóng băng ở `true` |
| `setHover(false)` sau khi tải | ép "chuột đã rời" | Con trỏ vẫn đang trên video — đó là **bịa ra một sự kiện chuột** |
| `viewers` (đếm bề mặt đang mở) | `viewerOpen` mỗi frame, `viewerClosed` chỉ khi invalidate | Với `all_frames` thì chỉ tăng, không giảm |

**Cách sửa chung.** Chuyển từ **đo cạnh** sang **đo mức**: thay vì giữ cờ và
chờ sự kiện kết thúc, ghi *mốc thời gian lần cuối thấy điều kiện đúng* rồi kiểm
định kỳ. Mốc tự cũ đi, không cần sự kiện nào cả.

**Đánh đổi.** Đo mức tốn một `setInterval` chạy nền. Đã giảm bằng cách **chỉ
chạy nhịp khi nút đang hiện** — ẩn rồi thì chỉ `mousemove` mới đánh thức.

### Họ C — Trả cho tầng dưới một mã định danh mà nó hiểu theo nghĩa hẹp hơn ta tưởng

Cả ba đường sinh `format_id` đều dính, và tôi **sửa lần lượt từng đường** thay
vì sửa một lần — đó là lỗi của tôi, ghi ở §3.

| Đường | Mã trả về | Người dùng nhận |
|---|---|---|
| YouTube đọc từ trang | itag trần, vd `137` | Video **câm** (DASH tách hình/tiếng) |
| Backend `list_formats` | id thô của yt-dlp, vd `hls-973` | Video **câm** (master HLS tách tiếng) |
| Extension đọc master m3u8 | URL biến thể | Video **câm** khi master có `#EXT-X-MEDIA:TYPE=AUDIO` |

**Cách sửa chung.** Mã gửi đi phải diễn tả **kết quả mong muốn**, không phải
một luồng cụ thể: `<id>+bestaudio/<id>`, hoặc `bv*[height=H]+ba/b[height=H]`.
Dấu `/` là đường lùi của yt-dlp — không có tiếng để ghép thì vẫn tải được hình,
thay vì hỏng cả lượt.

**Đánh đổi có chủ đích.** Chọn theo **chiều cao** chứ không theo id khi phải gửi
master, vì id HLS (`hls-<bandwidth>`) do yt-dlp tự đặt và không ổn định giữa các
lần chạy. Đổi lại: nếu master có hai luồng cùng chiều cao khác bitrate, bộ chọn
sẽ lấy cái yt-dlp cho là tốt hơn — ta mất quyền chỉ đích danh. Chấp nhận được,
vì id không ổn định thì chỉ đích danh cũng vô nghĩa.

### Họ D — Gọi một hàm đợi main thread từ chính main thread

Chỉ xuất hiện ở app desktop, nhưng hậu quả nặng nhất: app treo tới mức phải
force-quit.

`evaluate_js` của pywebview xếp hàng JS lên main run loop bằng `AppHelper.callAfter`
rồi **đứng đợi semaphore**. Gọi nó từ một ObjC action selector (đang chạy trên
chính main thread) là tự khoá.

**Cách phát hiện chỗ khác cùng loại:** `grep -n "semaphore.acquire" platforms/cocoa.py`
— mọi hàm pywebview *trả kết quả* (`evaluate_js`, `get_cookies`, `get_current_url`,
`create_file_dialog`) đều thuộc loại này.

---

## 2. Quá trình gỡ từng lỗi đáng kể

Chỉ ghi những lỗi mà **cách tìm ra** mới là phần đáng học.

### 2.1. App treo 214 giây (Bug 14)

**Triệu chứng người dùng báo.** Đang tải, bấm icon menu bar → chọn "Mở cửa sổ"
→ app đứng hình, phải force-quit.

**Bước gỡ.** Không đoán. macOS ghi lại spindump mỗi khi người dùng force-quit
một app treo:

```
/Library/Logs/DiagnosticReports/Streamloot_2026-09-18-202152….hang
```

Trong đó, main thread ở **31/31 mẫu** đều nằm tại:

```
-[NSMenu performActionForItemAtIndex:] → … → lock_PyThread_acquire_lock
Duration: 216.53s (unresponsive 214s trước khi lấy mẫu)
```

Một ngăn xếp gọi chỉ đúng một chỗ trong code. Không cần tái hiện.

**Nguyên nhân.** `show_window()` gọi `window.evaluate_js` ngay trên main thread.

**Đánh đổi khi sửa.** Hai lựa chọn:
- (a) Bọc `evaluate_js` trong try/except và hy vọng — *không giải quyết gì*, treo
  không phải exception.
- (b) Đẩy `evaluate_js` sang thread nền. **Chọn (b).**

Cái giá của (b): không đọc được giá trị JS trả về ở nơi gọi. Ở đây không cần —
ta chỉ bắn một event vào trang. Nếu sau này cần giá trị trả về thì phải dùng
callback, không được `await` trên main thread.

**Phòng lỗi tái diễn.** Hàm `refresh_off_main()` đặt trong `statusbar_menu.py`
(module đã có test, không phụ thuộc AppKit) kèm test khẳng định lời gọi **không
nằm trên main thread**.

### 2.2. Nút nổi không hiện dù rê chuột vào video (Bug 15)

**Giả thuyết đầu tiên của tôi — và nó ĐÚNG, nhưng tôi vẫn phải kiểm.** Tôi gắn
`mouseenter` vào chính phần tử `<video>`. Player thật phủ lớp điều khiển **lên
trên** video, nên sự kiện bị lớp phủ nuốt.

**Cách kiểm rẻ.** Không cần mở trình duyệt: đọc lại spec của `mouseenter` và đối
chiếu với cấu trúc DOM của một player bất kỳ. Lớp phủ điều khiển là chuẩn mực
của mọi player, không phải ngoại lệ.

**Cách sửa và đánh đổi.** Đo **toạ độ con trỏ** so với hình chữ nhật video, thay
vì nghe sự kiện trên phần tử. Lớp phủ trở nên vô hại.
- Giá: `mousemove` bắn hàng trăm lần mỗi giây, mà `getBoundingClientRect()` ép
  trình duyệt tính lại layout. Đã gộp theo `requestAnimationFrame`.
- Giá thứ hai: mất khả năng phân biệt "chuột trên video" với "chuột trên một
  phần tử đè lên video" — nhưng đó chính là điều ta muốn.

### 2.3. Nút nổi mất hẳn sau khi bắt đầu tải (Bug 15, phần 2)

**Hai nguyên nhân chồng nhau.** Đây là ca đáng ghi nhất vì sửa một cái không đủ.

1. `anchored` trỏ vào phần tử `<video>` đã rời DOM (player dựng lại sau khi tải
   khởi động). `getBoundingClientRect()` của node rời DOM trả **toàn số 0 mà
   không ném gì** → phép kiểm "chuột có trên video không" luôn ra false, trong
   khi `anchored !== null` vẫn đúng nên logic vẫn vui vẻ ẩn nút.
2. Đường thành công gọi `setHover(false)` — **nói dối** rằng chuột đã rời video.

**Mức độ chắc chắn — ghi rõ vì không đồng đều.** Nguyên nhân (2) tôi **chắc
chắn**: đọc code là thấy lời nói dối. Nguyên nhân (1) là **suy luận có cơ sở**
(rect toàn số 0 của node rời DOM là hành vi xác định của trình duyệt) nhưng tôi
**không quan sát trực tiếp** được trên site của người dùng. Đã vá cả hai.

### 2.4. Panel treo vĩnh viễn ở "Đang lấy danh sách chất lượng…" (Bug 9 mở rộng)

**Sai lầm ban đầu của tôi: cho rằng đây là vấn đề TỐC ĐỘ.** Người dùng nói
"10 giây rồi vẫn chưa có gì", nên phản xạ đầu tiên là đi tối ưu.

**Điều lật ngược kết luận.** Đọc code đường gọi thì thấy:

```ts
void askFormats.then((r) => { … });   // không có .catch
```

`ask()` có hạn giờ 15 giây, nhưng khi nó ném thì **không ai bắt**. Dòng chữ nằm
đó vĩnh viễn. Đây là **họ A**: "đang chờ" và "đã hỏng" trông y hệt nhau.

**Bài học.** Người dùng báo "chậm" không có nghĩa vấn đề là tốc độ. "Chậm" và
"hỏng nhưng không báo" là hai thứ khác nhau mà **giao diện đang thể hiện giống
hệt nhau** — tức chính nó cũng là một ca của họ A.

Sửa kèm: `fetch` master m3u8 chưa có hạn giờ. `fetch` **không tự bỏ cuộc**, mà
CDN video treo request là chuyện thường → thêm `AbortController` 4 giây.

### 2.5. File tải về thiếu tiếng (Bug 18)

**Không đoán — đo.** Chạy thẳng công cụ trên URL người dùng đưa:

```
$ yt-dlp -J --no-warnings "https://www.ganjingworld.com/video/1iroebfe…"

format_id yt-dlp tự chọn: hls-973+hls-default-audio-group-128k

id                       ext   res         vcodec       acodec
hls-default-audio-group  mp4   audio only  none         None
hls-562                  mp4   640x360     avc1.640029  none
hls-771                  mp4   853x480     avc1.640029  none
hls-973                  mp4   1280x720    avc1.640029  none
```

Ba dòng dữ liệu này trả lời trọn vẹn: **mọi biến thể hình đều `acodec: none`**,
tiếng nằm ở một rendition riêng, và yt-dlp tự chọn thì **ghép hai luồng**. Ta
trả `hls-973` trần nên nó tải đúng một luồng đó.

**Đánh đổi khi sửa.** Ba lựa chọn:
- (a) Ẩn các luồng không tiếng khỏi danh sách. *Loại*: mất luôn lựa chọn chất
  lượng cao, vì luồng cao nhất thường là luồng tách.
- (b) Tự ghép ở client (tải hai luồng rồi mux). *Loại*: phải nhúng ffmpeg vào
  extension; backend đã làm được việc này.
- (c) Đổi mã gửi đi thành `<id>+bestaudio/<id>`. **Chọn (c)** — một dòng, dùng
  đúng cơ chế yt-dlp đã có, và dấu `/` giữ đường lùi.

### 2.6. "Hiện trong Finder" báo không tìm thấy file (Bug 17)

**Nguyên nhân: một lỗi THỤT LỀ.** Khối đọc tên file nằm lọt *bên trong*
`if "[youtube]" in line or "[info]" in line …`, nên `[download] Destination: …`
chỉ được đọc khi cùng dòng đó *cũng* chứa `[info]` — không bao giờ xảy ra.
`final_path` giữ nguyên mẫu `…%(ext)s`, và đó là thứ ghi vào DB.

**Vì sao nó sống lâu.** Không có test nào chạm tới. Logic nằm giữa một vòng lặp
dài đọc output tiến trình — không gọi riêng được, nên không ai kiểm được.

**Cách sửa và đánh đổi.** Không chỉ sửa thụt lề mà **tách thành
`_path_from_line()`**. Giá: thêm một hàm tĩnh, thêm một lời gọi. Lời: 6 test
chạy trong 0 giây, và lỗi cùng loại sau này sẽ đỏ ngay.

---

## 3. Những lần tôi kết luận sai hoặc làm chưa tới

Ghi lại vì đây là phần dễ bị lược đi nhất, mà lại hữu ích nhất.

**Sửa một triệu chứng rồi tưởng xong (họ C).** Vá bẫy itag YouTube xong, tôi coi
như đã xử lý xong lỗi "video câm". Thực tế cùng lỗi đó tồn tại ở **hai đường
khác** mà tôi không kiểm. Người dùng phải báo lại. Đúng ra: sau khi tìm ra một
lỗi, phải **grep mọi chỗ sinh ra cùng loại giá trị** trước khi đóng.

**Báo cáo đọc từ `grep` thay vì từ mã thoát.** Một lần sửa chuỗi trúng nhầm dòng
`esbuild` trong `tests/run.sh`, làm suite `submitGuard` **không chạy** — nhưng
vì tôi grep dòng "N pass", output nhìn vẫn xanh. Chỉ phát hiện khi đếm số suite
(5 thay vì 6). Từ đó chuyển sang kiểm bằng `EXIT=$?` của runner.

**`tsc exit=0` trong khi đó là mã thoát của `tail`.** `npx tsc --noEmit | tail -3`
rồi đọc `$?` là đọc `tail`, luôn 0. Lỗi này tôi mắc hai lần.

**Suýt làm lộ tên miền riêng tư.** Viết tên site thật vào comment ở hai file.
Privacy check bắt được *trước khi commit*. Repo công khai nên đây là lỗi nghiêm
trọng, không phải sơ suất nhỏ.

**Giả thuyết bị bác bỏ bằng đo đạc.** Có lúc tôi tin tranh chấp khoá SQLite làm
đơ giao diện. Đo: 0/60 lần trượt, trước và sau khi "sửa". Giả thuyết sai, và bản
"sửa" đó vô nghĩa. Tương tự với giả thuyết `/probe/duration` làm nghẽn `/health`:
25 request đồng thời → `/health` vẫn 2–5ms.

---

## 4. Bẫy nằm ở công cụ, không ở code

**`rtk` bóp méo output khi có redirect.** Đây là cái nguy hiểm nhất gặp phải.

Trước khi đẩy 49 commit lên repo **công khai**, tôi chạy quét bảo mật trên diff
sắp đẩy. Kết quả: *0 file, diff rỗng*. Nếu tin, tôi đã đẩy code lên mà **chưa
quét gì cả**. Chỉ phát hiện vì con số mâu thuẫn với "49 commit đi trước".

Thực tế: 42 file, 6988 dòng. Phải dùng `rtk proxy git diff` mới lấy được dữ liệu
thật. Cùng thứ đó từng làm `git log --oneline -1` chỉ sai commit sau một merge
(báo commit của nhánh thay vì merge commit) — lần đó phải đọc thẳng object bằng
`git cat-file -p HEAD` để xác nhận.

**Quy tắc rút ra:** với thao tác không thể lùi (push lên repo công khai), kết
quả kiểm phải **tự nhất quán** với một phép đếm độc lập. Một kết quả rỗng trông
y hệt một kết quả sạch.

---

## 5. Quyết định kiến trúc lớn và cái giá của chúng

### 5.1. Đọc master m3u8 trong extension thay vì nhờ backend

**Vấn đề.** Panel đứng "Đang lấy danh sách…" vài giây vì backend phải spawn
`yt-dlp -J`. Đo: riêng khởi động yt-dlp **0.38s**, chưa kể nó tự tải master rồi
tải thêm một biến thể để dò.

**Rào cản.** `fetch` **không cho đặt `Referer`** (header bị cấm), mà CDN video
hay từ chối request thiếu nó. Đó là lý do ban đầu việc này nằm ở backend.

**Đường vòng hợp lệ.** `declarativeNetRequest.updateSessionRules` với
`modifyHeaders` đặt được `Referer`, rồi gỡ rule ngay sau khi gọi.

**Đánh đổi.**
- Phải xin thêm quyền `declarativeNetRequest`. Chrome Web Store soi quyền kỹ.
- Rule **bắt buộc phải gỡ** trong `finally`: rule sót lại nghĩa là extension âm
  thầm sửa header request của trang. Đây là rủi ro thật, không phải dọn dẹp.
- Phạm vi rule là **thư mục chứa playlist** (`new URL('.', url) + '*'`), không
  phải một URL — segment nằm cạnh playlist và cần cùng header. Rộng hơn mức tối
  thiểu, nhưng hẹp hơn thì không tải được segment.
- Giữ nguyên đường backend làm dự phòng. `variantsFromManifest` trả `null` (không
  kết luận được) chứ không `[]` — nếu không sẽ lại rơi vào họ A.

### 5.2. KHÔNG chép cách bản tham chiếu làm YouTube

Đọc kiến trúc một extension tải video phổ biến (bản dựng để trong `ref/`, đã
gitignore — chỉ đọc kiến trúc, **không chép mã**, nó có bản quyền).

**Họ làm:** nhúng cả thư viện InnerTube (~1MB), cộng máy móc giải
`signatureCipher`/`nsig` bằng cách **trích hàm giải mã từ player JS của YouTube**
rồi chạy nó.

**Quyết định: không theo.** Lý do không phải "khó" mà là **không cần**: chữ ký
chỉ cần để **TẢI**, mà tải thì yt-dlp ở backend đã lo. Phần ta cần nhanh chỉ là
**liệt kê** — và liệt kê không cần chữ ký.

**Kết quả:** ~90 dòng đọc `ytInitialPlayerResponse` từ HTML, thay vì 1MB.

**Cái giá.** Ta không tải thẳng trong trình duyệt được, luôn phải có app chạy để
tải YouTube. Chấp nhận: app là sản phẩm chính, extension chỉ là cửa vào.

**Cái tránh được.** 1MB code hỏng mỗi lần YouTube xoay player.

**Chi tiết kỹ thuật đáng nhớ.** Cắt khối JSON bằng **đếm ngoặc**, không bằng
regex — JSON đó chứa chuỗi có ngoặc lồng nhau và dấu nháy escape, regex tham lam
sẽ nuốt sang tận cuối trang. Có test cho cả hai ca đó.

### 5.3. "1000+ site" không phải phép màu

Điều đáng giá nhất học được từ bản tham chiếu là một **sự vắng mặt**: họ không
có cơ chế thần kỳ nào. `webRequest` đánh hơi URL media theo kiểu chung, cộng
khoảng 20 script viết tay cho các site khó. Đúng mô hình `plugins/` + capture
mình đang có — khác mỗi số lượng plugin.

Kết luận này ngăn được một hướng đi sai: không có gì để "bắt kịp" về kiến trúc.

### 5.4. Bỏ ô chọn stream khỏi panel

**Lý do.** Panel là bộ chọn **format**; thêm một bộ chọn stream nữa là hai quyết
định chồng nhau trong một khung nhỏ.

**Cái giá — nói rõ.** Khi phép đo thời lượng chọn nhầm stream, người dùng **không
còn đường sửa tại chỗ**. Đường chọn tay vẫn còn trong `pick.ts` (có test), chỉ
không lộ ra giao diện. Nếu gặp thật thì đưa lại dưới dạng một dòng phụ, không
phải dropdown.

---

## 6. Quy ước kiểm thử rút ra

Repo **không có framework test cho extension** (ADR 0006). Cách làm đã chốt:
module quyết định **thuần** trong `apps/extension/lib/`, esbuild gói thành
`.tmp-*.mjs`, node chạy. DOM và `chrome.*` ở ngoài, không test.

Hệ quả phải nói thẳng: **142 test extension phủ 0 dòng trong `entrypoints/`**.
Hai file mang gần hết hành vi (`background.ts`, `panel.content/index.ts`) không
có test, và **cả hai lỗi HIGH của final review đều nằm trong đó**. Suite xanh
không nói gì về vùng rủi ro cao nhất.

**Kiểm ngược là bắt buộc.** Mỗi bản sửa: phá logic → xác nhận test **in FAIL**
(không phải sập file) → khôi phục → xanh. Một lần tôi viết kiểm ngược *không
đổi hành vi* (chèn điều kiện vẫn cho dữ liệu đi qua) → phải làm lại cho đúng.
Một kiểm ngược không đỏ thì vô giá trị bằng không có.

**Harness `t()` phải nhận thunk.** Nhận giá trị đã tính thì một assertion ném sẽ
làm **sập cả file test**, và các test còn lại không chạy — trông như "ít test"
chứ không như "lỗi".

---

## 7. Còn treo

- **Chậm từ lúc bấm đến lúc tải chạy.** Đo: mỗi lần `yt-dlp` extract mất **1.4s**,
  nhưng đường byUrl chạy nó **ba lần** cho một lượt tải (liệt kê → `/downloads`
  extract lại → yt-dlp tải lại extract lần nữa). ~4 giây thuần lặp lại cùng một
  việc. Hướng sửa: nhớ kết quả extract theo URL với TTL ngắn.
- **Một link ganjing vẫn sai** sau bản sửa Bug 18 — đang chờ làm rõ triệu chứng.
- **CLI không tạo `download_tasks`** nên lượt tải từ CLI không hiện ở
  `/downloads/active` (spec §9).
- **`place()` chưa throttle bằng rAF** — mỗi tick scroll/mutation đều
  `querySelectorAll` + `getBoundingClientRect` đồng bộ.
- **`.app` chưa ký và chưa notarize.**
