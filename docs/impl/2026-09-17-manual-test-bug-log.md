# Nhật ký sửa lỗi — vòng thử tay ngày 17/09/2026

> Hồi cứu kèm quá trình gỡ, quyết định và đánh đổi:
> [2026-09-19-debug-retrospective.md](2026-09-19-debug-retrospective.md).
> File này là nhật ký theo từng lỗi; file kia xếp chúng theo nguyên nhân gốc.

Ghi lại 12 lỗi tìm ra khi thử tay bản `.app` và extension, sau khi Plan 1 đã
xong và qua review toàn nhánh. Mỗi mục ghi: triệu chứng người dùng thấy, nguyên
nhân **đo được**, bản vá, và bài học.

Viết ra vì phần lớn thời gian của vòng này không tiêu vào việc sửa, mà tiêu vào
việc **nhìn thấy** lỗi. Xem §13.

> Quy ước: không có tên miền site nào trong tài liệu này (quy tắc riêng tư của
> repo). Gọi chung là "CDN nội dung" và "CDN quảng cáo".

---

## 1. Log chỉ nhận ERROR nên cả phiên chạy để lại một dòng

**Triệu chứng.** Menu bar bấm không ăn, log không có gì để đọc.

**Nguyên nhân.** `Logger` đặt mức cho file handler ở **hai nơi** — `init()` và
`_init_logger()` — và cả hai đều để `ERROR` khi không bật debug. Mọi dòng
"đã bấm nút này, đã vào nhánh kia" đều bị bỏ.

**Vá.** Hạ cả hai xuống `INFO`. Sửa một nơi là chưa đủ: nơi nào chạy trước thì
thắng, và lần đầu tôi chỉ sửa `init()` nên log **vẫn trống** ở lần chạy sau đó.

**Bài học.** Hai chỗ cấu hình cùng một thứ là một lỗi chực chờ. Khi sửa, phải
grep hết mọi chỗ đặt giá trị đó.

*Commit: `5d8f90d`*

## 2. Nhánh nuốt cú bấm ghi log ở mức DEBUG

**Triệu chứng.** Bấm "Tạm dừng" ở menu bar, không có gì xảy ra, log trống trơn.

**Nguyên nhân.** `toggle()` gặp `get_task()` trả `None` thì lặng lẽ `return`,
ghi log ở mức `DEBUG` — mà `DEBUG` tắt ở bản chạy thật.

**Vá.** Nâng lên `ERROR`.

*Commit: `5d8f90d`*

## 3. Exception ném ra khỏi ObjC selector biến mất không dấu vết

**Triệu chứng.** Menu hỏng im lặng, không traceback.

**Nguyên nhân.** `onToggle_`/`onCancel_` là **biên giới Objective-C**. Exception
Python ném ra khỏi đó không có traceback nào, AppKit nuốt trọn.

**Vá.** Bọc try/except + log ngay tại selector. Thêm log INFO lúc vào, chính là
dòng sau này xác định được "selector CÓ bắn" và loại bỏ cả một nhánh giả thuyết.

**Bài học.** Mọi callback bị runtime ngoài Python gọi đều phải tự bọc và tự ghi.

*Commit: `5d8f90d`*

## 4. Cửa sổ app không thấy task do extension/CLI khởi động

**Triệu chứng.** Tải từ extension, cửa sổ app đang mở nhưng danh sách trống.

**Nguyên nhân.** `hydrate()` chỉ chạy lúc mount và lúc show cửa sổ. SSE chỉ đẩy
tiến trình của task cửa sổ **đã biết** — nó không báo "có task MỚI". Cửa sổ mở
sẵn thì không có gì kích hoạt hydrate.

**Vá.** Poll `/downloads/active` mỗi 2s, nghỉ khi cửa sổ ẩn.

*Commit: `989f567`*

## 5. `hydrate()` không bắt lỗi nên chết lặng

**Nguyên nhân.** `request()` **ném** khi backend trả lỗi, `hydrate()` không có
try/catch → promise bị từ chối lặng lẽ, hydrate chết giữa chừng.

**Vá.** Bắt và ghi log.

*Commit: `989f567`*

## 6. Mở bản thứ hai thì app chết câm, trông như "bản build hỏng"

**Triệu chứng.** Mở `.app` không lên gì. Tưởng build lỗi.

**Nguyên nhân.** Bản chạy từ script còn sống và giữ cổng 8001. Cả uvicorn lẫn
http server của pywebview ném `Address already in use` ở thread nền, app tắt
câm. `lsof` chỉ ra ngay tiến trình đang giữ cổng.

**Vá.** Kiểm cổng trước khi khởi động, hiện hộp thoại nói rõ.

**Bài học.** "Build hỏng" là một kết luận, không phải một quan sát. Đo trước.

*Commit: `989f567`*

## 7. Tiến trình giẫm lên trạng thái người dùng vừa đặt

**Triệu chứng.** Bấm tạm dừng, menu hiện lại "Tạm dừng" như chưa bấm. Huỷ xong
bản ghi lại là `failed` chứ không phải `cancelled`.

**Nguyên nhân.** `progress_callback` ghi thẳng `status='downloading'` trên **mọi**
dòng tiến trình. Bấm tạm dừng xong, chỉ cần một dòng còn trong bộ đệm stdout
được đọc ra là status bị lật ngược. Cùng cơ chế nuốt `cancelling`, nên
`_is_cancel_requested()` sau đó thấy trạng thái đã đổi và đánh dấu `failed`.

**Vá.** `HistoryService.update_progress()` ghi tiến trình nhưng giữ nguyên
`paused`/`cancelling`. So sánh và ghi nằm chung một câu SQL bằng `CASE` nên
nguyên tử — đọc-rồi-ghi ở Python sẽ hở đúng khe người dùng bấm nút.

**Bài học.** Một nguyên nhân, hai triệu chứng ở hai bề mặt khác nhau. Đừng vá
riêng từng triệu chứng.

*Commit: `10936e8`*

## 8. ffmpeg đóng gói sai kiến trúc

**Triệu chứng.** macOS cảnh báo "Support Ending for Intel-based Apps".

**Nguyên nhân.** Nguồn cũ chỉ phát hành bản `x86_64`, trong khi app và yt-dlp là
`arm64` → ffmpeg chạy qua Rosetta.

**Vá.** Chọn nguồn static theo `uname -m`, và **kiểm lại bằng `lipo` sau khi
tải**: sai kiến trúc thì dừng build.

**Bài học.** Lỗi mà "app vẫn chạy" là lỗi không ai phát hiện. Phải chủ động
kiểm.

*Commit: `10936e8`*

## 9. Popup và panel của extension treo vô hạn

**Triệu chứng.** Popup đứng ở "Đang kiểm tra…" mãi.

**Nguyên nhân.** Ba chỗ không có hạn giờ và không bắt lỗi: `health()` gọi `fetch`
không timeout; `render()` của popup không try/catch nên mọi exception để nguyên
dòng chữ khởi tạo; `ask()` của panel dùng `sendMessage` không hạn giờ, mà MV3
giết service worker khi rảnh.

**Vá.** `AbortSignal.timeout(4s)` cho health, try/catch hiện lỗi trong popup,
hạn 15s cho `sendMessage`.

**Đo được.** Backend trả `/history` trong **6.6ms** với đúng header của
extension, chỉ 2 kết nối mở → chậm không nằm ở backend. Sau khi hiện số ms thật
lên popup: **17ms**. Cái "chậm" thực ra là service worker MV3 khởi động nguội.

*Commit: `0ca65e0`, `56a157e`*

## 10. Chọn nhầm stream quảng cáo

**Triệu chứng.** Tải về file 805 KB toàn quảng cáo, trong khi phim dài hơn 1 giờ.

**Nguyên nhân.** Panel lấy `captures[captures.length - 1]` — cái **nạp sau cùng**.
Quảng cáo gần như luôn nạp sau nội dung.

**Ba lần sửa mới đúng** — đáng ghi vì cả ba đều là bài học khác nhau:

1. *Xếp theo thời lượng* (`05b82aa`). Hỏng: lúc mới đo xong mỗi quảng cáo (5
   giây), "cái đo được dài nhất" chính là quảng cáo, và nó thắng cả những ứng
   viên còn đang đo. **Quyết định dựa trên dữ liệu đo dở còn tệ hơn chưa đo.**
2. *Thêm lọc theo Referer, và chưa đủ dữ liệu thì chưa chọn* (`9239b58`). Hỏng:
   phép đo không bao giờ về, panel treo ở "Đang xác định stream…". **Đổi một lỗi
   chọn-sai lấy một lỗi treo là lỗ vốn** — chọn sai còn sửa tay được, treo thì
   không.
3. *Không bao giờ trả về "chưa chọn" khi còn ứng viên* (`0596b76`). Thời lượng
   trở lại đúng vai trò tín hiệu phụ để xếp hạng, không phải cánh cổng chặn
   đường.

**Thứ tự ưu tiên cuối cùng** (`lib/pick.ts`): người dùng tự chọn → lọc Referer
(tức thì, không cần mạng) → khớp thời lượng thẻ `<video>` của trang → cái đo
được dài nhất nếu đủ dài → ứng viên chưa đo mới nhất.

**Bài học.** Sau hai lần sai liên tiếp ở cùng một chỗ, tách `lib/pick.ts` thành
module thuần và viết bài chạy thử trên **chính module panel import** (esbuild
gói module thật rồi node chạy — repo không có framework test cho extension).
9 kịch bản, gồm đúng tình huống trong ảnh chụp màn hình người dùng gửi.

*Commit: `05b82aa`, `9239b58`, `0596b76`*

## 11. Đo thời lượng đặt nhầm chỗ: trình duyệt không đặt được `Referer`

**Triệu chứng.** Panel kẹt ở "đang đo…" vĩnh viễn.

**Nguyên nhân.** `Referer` nằm trong danh sách **header bị cấm** đặt qua `fetch`.
Chrome lặng lẽ bỏ nó đi, mà CDN video từ chối request thiếu Referer. Tôi viết
phép đo ở nơi không bao giờ đo được — và biết giới hạn này từ trước nhưng vẫn
đặt sai chỗ.

**Vá.** Chuyển sang backend (`services/manifest_probe.py` + `POST
/api/v1/probe/duration`), nơi đặt header đó thoải mái, và cũng chính là tiến
trình vốn đang tải những manifest này. Kèm lợi ích phụ: phần này giờ nằm ở phía
**có hạ tầng test thật** — 8 test, gồm một test khẳng định `Referer` thật sự
được gửi đi.

*Commit: `8828257`*

## 12. Tạm dừng không tới được ffmpeg

**Triệu chứng.** Menu báo "đã tạm dừng", cửa sổ app vẫn hiện đang tải, và file
vẫn phình ra.

**Nguyên nhân.** yt-dlp giao việc tải HLS cho **ffmpeg**, nên tiến trình thật sự
kéo byte về là **cháu** chứ không phải con. `SIGSTOP` gửi riêng cho yt-dlp không
tới ffmpeg. Đo trực tiếp:

```
SIGSTOP riêng cha : cha T (dừng) | con S (VẪN CHẠY)   <-- đúng lỗi
killpg cả nhóm    : cha T (dừng) | con T (dừng)
```

Hệ quả kèm theo: **huỷ** trước đây để lại ffmpeg mồ côi vẫn ghi file tiếp, dù
nhìn từ ngoài tưởng như đã huỷ xong.

**Vá.** `utils/proc.signal_tree()` gửi tín hiệu cho cả nhóm, kèm
`start_new_session=True` lúc `Popen` để nhóm đó tách khỏi backend.

**Cái bẫy.** Lần thử đầu tôi quên `start_new_session`, và `killpg` bắn trúng
luôn nhóm của chính mình — lệnh **tự treo nó** (thoát mã 144). Vì thế
`signal_tree` từ chối `killpg` khi nhóm trùng nhóm của mình.

*Commit: `113e1fc`*

---

## 13. Bài học xuyên suốt

**Phần lớn thời gian tiêu vào việc NHÌN THẤY lỗi, không phải sửa lỗi.**
Bản vá của §12 là một hàm mười mấy dòng. Tới được nó mất nhiều vòng, vì §1-§3
làm cả hệ thống câm: log chỉ nhận ERROR, nhánh nuốt cú bấm ghi ở DEBUG, và
exception biến mất ở biên giới ObjC. Dòng log `Menu bar: bấm toggle` — thêm ở
§3 — mới là thứ chốt hạ: nó chứng minh selector CÓ bắn và `pause_download` chạy
xong không lỗi, xoá sạch một loạt giả thuyết sai.

**Lỗi nuốt trạng thái lặp đi lặp lại, kể cả trong chính bản vá của tôi.**
Gộp hai tình huống phân biệt được thành một kết quả không phân biệt được:
- `get_task()` trả `None` cho cả "không có" lẫn "đọc lỗi";
- `probeDuration()` trả `null` cho cả "app cũ chưa có endpoint" (404) lẫn "CDN
  từ chối" — tôi **tự tạo lại** đúng lớp lỗi này ở §11 rồi phải vá tiếp;
- `durationSec = null` hiện ra thành "đang đo…", khiến một phép đo đã kết thúc
  trông như đang chạy.

**Giả thuyết phải đem đi đo, kể cả khi nghe rất thuyết phục.**
Tôi tin chắc tranh khoá SQLite làm treo giao diện, đã viết cả phép đo ngược:
3098 lượt ghi đồng thời, số lần đọc trượt là **0/60 ở cả trước lẫn sau khi
sửa**. Giả thuyết sai. WAL vẫn giữ vì đó là cấu hình đúng, nhưng **không** được
tính là bản vá.

**Kiểm ngược (mutation check) bắt được lỗ hổng mà "test xanh" che mất.**
Ở §12, bỏ `signal_tree` khỏi `pause` mà **không test nào đỏ** — tức tôi mới ghim
đường `cancel`, còn `pause` thì chưa, trong khi `pause` mới đúng là lỗi người
dùng báo. Từ đó: mỗi bản vá đều thử bỏ nó đi và bắt buộc phải thấy test đỏ.

**Quy tắc riêng tư cần công cụ, không cần trí nhớ.**
Tôi đưa tên miền thật vào file test **được git theo dõi**. Lệnh kiểm tra trong
quy trình bắt được — nhưng sau khi đã commit. Đã làm sạch cả lịch sử
(`git filter-branch`, xoá `refs/original` và nhánh backup) vì nhánh chưa push.

---

## Hiện trạng

154 test Python + 9 test chọn stream (extension) xanh. `tsc --noEmit` và bản
build UI sạch. Kiểm tra riêng tư sạch trên toàn bộ file được theo dõi **và**
toàn bộ lịch sử nhánh.

Đã người dùng xác nhận chạy đúng: tải, chọn đúng stream nội dung, đo thời lượng,
tạm dừng, tiếp tục, huỷ, cửa sổ app cập nhật theo thời gian thực.

Còn treo: ký (sign) và công chứng (notarize) bản `.app`.

## Bug 14. App treo 214s sau khi chọn "Mở cửa sổ" ở menu bar khi đang tải

**Triệu chứng.** Đang tải, bấm icon menu bar → menu mở → chọn mở cửa sổ → app
đứng hình, phải force-quit (2026-09-18 20:21).

**Bằng chứng.** `/Library/Logs/DiagnosticReports/Streamloot_2026-09-18-202152….hang`:
main thread kẹt 31/31 mẫu ở `lock_PyThread_acquire_lock` bên trong
`NSMenu performActionForItem` → Python.

**Nguyên nhân.** `show_window()` gọi `window.evaluate_js` từ `onShow_` — action
selector chạy trên main thread. `evaluate_js` của pywebview
(`platforms/cocoa.py`) xếp hàng JS lên main run loop bằng `AppHelper.callAfter`
rồi đứng đợi semaphore kết quả. Main thread đang đợi thì block JS phía sau
không bao giờ tới lượt: tự khoá. `onToggle_`/`onCancel_` đã được đẩy ra thread
riêng từ bug trước (`_off_main`), chỉ `show` bị bỏ sót.

**Sửa.** `refresh_off_main()` trong `apps/desktop/statusbar_menu.py`: chạy
`evaluate_js` ở thread nền, có test khẳng định lời gọi không nằm trên main
thread. `window.show()` giữ nguyên — nó chỉ `callAfter`, không đợi.

**Bài học.** Bất kỳ hàm pywebview nào *trả kết quả* (`evaluate_js`, `get_cookies`,
`create_file_dialog`, `get_current_url`) đều đợi main thread — không bao giờ
gọi từ selector AppKit. Tìm bằng `grep -n "semaphore.acquire" platforms/cocoa.py`.

## Bug 15. Bắt đầu tải xong thì nút nổi mất hẳn, rê chuột vào video không hiện lại

**Triệu chứng.** Chọn format → app bắt đầu tải → nút nổi biến mất và không bao
giờ trở lại, kể cả khi rê chuột đúng vào video (2026-09-18).

**Hai nguyên nhân chồng nhau, cùng một gốc: tin vào trạng thái cũ thay vì đo lại.**

1. `onMove` đo "con trỏ có trên video không" bằng `anchored` — tham chiếu tới
   phần tử `<video>` chọn từ trước. Player SPA dựng lại phần tử video sau khi
   bắt đầu tải, nên `anchored` trỏ vào node đã rời DOM. `getBoundingClientRect()`
   của node rời DOM trả **toàn số 0 mà không ném, không báo** — nên phép kiểm
   luôn ra false, còn `anchored !== null` vẫn đúng nên `shouldHideFab` cứ ẩn.
   Sửa: `isUsableRect` (có test) loại rect toàn số 0, và thấy rect hỏng hoặc
   `!isConnected` thì `place()` neo lại.

2. Đường thành công gọi `setHover(false)` — **nói dối rằng chuột đã rời video**
   trong khi con trỏ vẫn nằm trên đó. Chuột đứng yên thì không có `mousemove`
   nào để đính chính, nên 10s sau nút ẩn đi một cách vô lý. Sửa: chỉ gọi
   `applyFabVisibility()`, để vị trí chuột thật quyết định. Nút ✕ cũng vậy.

**Bài học.** Cùng họ với các bug trước trong nhánh này: ép một trạng thái mà ta
chỉ *giả định*, thay vì đo cái đang có thật. Ở đây có hai lớp — một tham chiếu
DOM đã chết vẫn trả lời như thật, và một sự kiện chuột được bịa ra.

## Bug 16. Nút nổi không tự ẩn sau 10s; panel không đóng khi bấm ra ngoài

**Triệu chứng.** Chuột rời hẳn video nhưng nút vẫn nằm đó mãi. Panel mở rồi
bấm ra vùng ngoài cũng không đóng (2026-09-18).

**Nguyên nhân (nút).** Dò hover theo CẠNH: `mousemove` suy ra "vào" và "ra".
Con trỏ rời video sang một `<iframe>` (quảng cáo, hoặc chính khung player) thì
document gốc **ngừng nhận `mousemove`** — không có sự kiện "ra" nào cả, nên cờ
`hovering` đóng băng ở `true` và bộ hẹn giờ ẩn không bao giờ được đặt.

**Sửa.** Chuyển sang đo MỨC: ghi `lastOverAt` mỗi lần thấy con trỏ trên video,
rồi một nhịp `setInterval` 1s tính `Date.now() - lastOverAt`. Không cần sự kiện
"ra" nữa — mốc tự cũ đi. Nhịp chỉ chạy khi nút đang hiện. `HOVER_FRESH_MS`
(400ms) rộng hơn nhịp mousemove rất nhiều nên "đang rê" luôn đúng.

**Nguyên nhân (panel).** Chưa hề có listener đóng-khi-bấm-ra-ngoài.

**Sửa.** Listener `click` ở document (capture) dùng `composedPath()`: panel sống
trong shadow root nên `event.target` ở document chỉ là phần tử host, không phân
biệt được trong/ngoài; `composedPath()` xuyên shadow boundary.

**Bài học.** Dò trạng thái theo cạnh thì phụ thuộc vào việc sự kiện "kết thúc"
chắc chắn tới. Ở web nó thường KHÔNG tới: iframe nuốt chuột, tab bị ẩn, trang
điều hướng. Đo mức (mốc thời gian + nhịp kiểm) thì tự phục hồi.

## Bug 17. "Hiện trong Finder" báo không tìm thấy file

**Triệu chứng.** Tải xong, bấm Show in Finder → "File not found on disk".

**Nguyên nhân: một lỗi THỤT LỀ.** Trong `downloaders/ytdlp.py`, khối "Parse
output filenames" nằm lọt *bên trong* `if "[youtube]" in line or "[info]" in
line or "Downloading webpage" in line:`. Nghĩa là dòng `[download] Destination:
…` chỉ được đọc khi cùng dòng đó *cũng* chứa `[info]` — không bao giờ xảy ra.
`final_path` giữ nguyên mẫu `…%(ext)s`, và đó là thứ ghi vào DB.

**Sửa.** Đưa khối ra đúng cấp, và tách thành `_path_from_line()` để TEST ĐƯỢC —
lỗi này im lặng suốt vì không test nào chạm tới nó. 6 test, có kiểm ngược.

## Bug 18. File tải về thiếu tiếng (hoặc thiếu hình)

**Triệu chứng.** Hai video trên cùng một site tin tức: một cái tải về chỉ có
tiếng, một cái chỉ có hình. YouTube và một site khác thì bình thường.

**Đo thật, không đoán.** `yt-dlp -J` trên URL đó cho thấy master HLS tách tiếng
thành rendition riêng: cả ba biến thể hình đều `acodec: none`, tiếng nằm ở
`hls-default-audio-group-128k`. yt-dlp tự chọn thì ghép
`hls-973+hls-default-audio-group-128k` — còn ta trả `hls-973` trần.

**Nguyên nhân.** Cùng họ với bẫy itag của YouTube, nhưng ở HAI chỗ khác nhau:
1. `list_formats` của backend trả thẳng id thô của yt-dlp cho client.
2. Đường manifest nhanh trong extension trả URL biến thể — mà biến thể đó là
   hình câm khi master có `#EXT-X-MEDIA:TYPE=AUDIO`.

**Sửa.**
1. Backend: `_mergeable()` đổi `<id>` thành `<id>+bestaudio/<id>` cho luồng
   hình không tiếng. Dấu `/` là đường lùi của yt-dlp: không có tiếng để ghép
   thì vẫn tải được hình thay vì hỏng cả lượt.
2. Extension: `hasSeparateAudio()` nhận ra `#EXT-X-MEDIA:TYPE=AUDIO`; lúc đó
   gửi URL **master** kèm bộ chọn `bv*[height=H]+ba/b[height=H]` thay vì URL
   biến thể. Chọn theo chiều cao chứ không theo id, vì id HLS do yt-dlp tự đặt.

**Bài học.** Bản sửa YouTube trước đó chỉ vá một đường (đọc từ trang). Cùng một
lỗi tồn tại ở hai đường còn lại mà không ai kiểm — sửa một triệu chứng không
phải sửa nguyên nhân. Lần này grep cả ba đường sinh `format_id`.

## Bug 19. Bắt trúng biến thể thay vì master → file chỉ có tiếng (hoặc chỉ có hình)

**Triệu chứng.** Cùng một site, hai video: một cái tải về đủ tiếng lẫn hình,
cái kia chỉ có tiếng. Đã sửa Bug 18 rồi mà vẫn còn.

**Quá trình gỡ — dữ liệu, không giả thuyết.**

Giả thuyết đầu tiên của tôi: bản `.app` đang chạy chưa có bản sửa Bug 18. **Sai**
— app build lúc 00:05, commit sửa lúc 23:59.

Giả thuyết thứ hai: hai link có cấu trúc format khác nhau. **Sai** — `yt-dlp -J`
cho thấy cả hai giống hệt: ba biến thể hình `acodec: none` + một rendition tiếng.

Chạy chính code đã sửa trên link hỏng: trả đúng `hls-1324+bestaudio/hls-1324`.
Vậy code đúng — lỗi ở chỗ khác.

Đọc DB thật của app (`~/Library/Application Support/Streamloot/db/history.db`,
không phải `db/` trong repo):

| id | lúc | `m3u8_url` đã dùng | `format_id` | kết quả |
|---|---|---|---|---|
| 21 | 23:45 | `playlist_aac128.m3u8` | best | chỉ tiếng |
| 22 | 23:48 | `playlist_720p.m3u8` | best | chỉ hình |
| 25 | 00:08 | `master.m3u8` | best | **đủ cả hai** |
| 24 | 00:08 | `playlist_aac128.m3u8` | best | chỉ tiếng |

Bốn dòng này trả lời trọn vẹn.

**Nguyên nhân.** Extension bắt được **bất kỳ playlist nào player yêu cầu** — có
khi master, có khi một biến thể. `pickCapture` xếp hạng theo **thời lượng**, mà
playlist tiếng và playlist hình **dài bằng nhau** → chọn trúng cái nào là tuỳ
may. Bản sửa Bug 18 (`hasSeparateAudio`) chỉ cứu được khi bắt trúng master.

**Vì sao không tầng nào bên dưới cứu được.** Tải một biến thể là tải đúng một
nửa, và URL nửa kia **đã mất** từ lúc chọn capture. Backend nhận `m3u8_url` là
playlist tiếng thì dù có `+bestaudio` cũng không có hình để ghép.

**Sửa.** `siblingMasterUrl()`: khi playlist tải về không phải master, thử
`master.m3u8` cùng thư mục (quy ước áp đảo của HLS) và dùng nó nếu đúng là
master. Đoán sai chỉ tốn một request 404.

**Đánh đổi — bỏ một lối tắt vừa thêm hôm qua.** Trước đây media playlist trả một
dòng "Chất lượng gốc" để khỏi phải hỏi backend. Bỏ hẳn: không phân biệt được
"playlist đã gộp sẵn tiếng" với "một nửa của luồng tách", mà đoán sai thì người
dùng nhận file hỏng. Giờ tìm không ra master thì trả `null` → lùi về backend, ở
đó yt-dlp nhìn từ URL trang nên thấy đủ. Chậm hơn, đúng hơn.

Gỡ luôn `singleFormat`/`isLive`/`totalDuration` — chúng chỉ phục vụ lối tắt đó.

**Bài học.** Bug 18 và 19 là **cùng một triệu chứng, hai nguyên nhân khác nhau**
ở hai tầng khác nhau. Sửa xong tầng trên mà không kiểm lại bằng dữ liệu thật thì
tưởng đã xong. Thứ chốt được vụ này là **đọc DB của app**, không phải đọc code.

**Ghi chú phụ phát hiện trong lúc gỡ.** Bộ test đang ghi fixture (`Sample`,
`example.com`) vào `db/history.db` **thật** của repo. Không ảnh hưởng app (app
dùng DB trong Application Support) nhưng vẫn là test làm bẩn dữ liệu — nên tách.

## Bug 20. Trạng thái nhấp nháy downloading↔processing, và app chậm hơn

**Triệu chứng.** Sau khi thêm cache extract, app "loop nhiều lần giữa downloading
và extracting, chậm hơn".

**Chẩn đoán đầu tiên của tôi — nghi cache — SAI.** Đo bằng cách chạy yt-dlp thật
và đếm tiền tố dòng: `--load-info-json` cho ra 1 `[info]`, 4 `[hlsnative]`,
1 `[Merger]`. Không có gì gây vòng lặp.

**Nguyên nhân thật: hệ quả của bản sửa Bug 18**, không phải của cache.

Từ khi ghép tiếng vào hình (`<id>+bestaudio`), một lượt tải gồm **hai phần**:
tải hình xong rồi tải tiếng, mỗi phần chạy 0→100% riêng. Bản đọc tiến trình cũ
không biết điều đó:

1. `[download] 100%` của phần ĐẦU bắn `processing/"Finalizing"`, rồi phần hai
   bắt đầu lại từ 0% → `downloading`. Đó chính là cái nhấp nháy.
2. `[info]` giữa chừng bắn `extracting/0%`, kéo thanh tiến trình về 0.
3. Phần trăm reset giữa hai phần.

**Nguyên nhân của "chậm hơn" — đo được.** Một lượt tải 17 giây sinh **2563** lần
gọi `progress_callback`, mà mỗi lần là một lần **ghi SQLite**. Việc tải biến
thành việc ghi DB.

Kèm theo: yt-dlp tính phần trăm theo **tổng ước lượng**, mà ước lượng đổi liên
tục khi tải HLS theo mảnh — nên con số thật sự có lúc nhỏ đi (0.3 → 0.2), đọc ra
là "đang chạy ngược".

**Sửa** (`utils/ytdlp_progress.py`, tách riêng để test được):
- Tách khối stdout theo `\r` (yt-dlp in tiến trình bằng `\r`, không phải `\n`;
  lấy match đầu tiên trong khối là luôn báo con số cũ nhất).
- `overall_percent()` quy phần trăm của từng phần về **một thang chung**, nên
  thanh tiến trình không reset giữa hai phần.
- Chặn tụt lùi bằng `max()` tích luỹ.
- `[download] 100%` chỉ báo "Finalizing" khi đã ở **phần cuối**.
- `[info]` chỉ báo "extracting" khi **chưa** bắt đầu tải phần nào.
- Nhịp báo tối thiểu 0.4s, và báo ngay khi sang phần mới.

**Đo lại cùng một video:** callback **2563 → 36**, không còn tụt lùi, chuỗi
trạng thái sạch `preparing → extracting → downloading → processing → completed`.

**Đánh đổi.** Có nhịp báo nghĩa là giá trị tiến trình CUỐI CÙNG có thể bị bỏ.
Chấp nhận được vì sự kiện `completed` sau `process.wait()` mới là thứ chốt 100%
— không phụ thuộc dòng tiến trình cuối.

**Bài học.** "Chậm hơn" là triệu chứng, không phải nguyên nhân. Nghi phạm đầu
tiên (cache vừa thêm) là nghi phạm **sai**; thứ chỉ đúng chỗ là đếm dòng output
thật và đếm số lần ghi DB.
