# Thiết kế: Extension thành trình quản lý tải

Ngày: 2026-09-16
Trạng thái: **Chờ duyệt**
Liên quan: [ADR 0005](../../ADR/0005-stream-capture-architecture.md), [ADR 0006](../../ADR/0006-extension-tech-stack.md)

> **Privacy:** tài liệu này được commit công khai. Không nêu tên miền của bất kỳ
> site nào.

---

## 1. Vấn đề

Extension hiện bắt được stream và tải được, nhưng dừng ở đó:

| Thiếu | Hệ quả người dùng gặp |
|---|---|
| Không có danh sách download | Bấm Tải xong là mất dấu. Không biết đang chạy hay đã chết |
| Không có tiến trình bền | Panel chỉ hiện tiến trình của lần bấm hiện tại; đổi trang là mất |
| Không pause/stop/resume | Backend **đã có** endpoint, extension chưa dùng |
| Không có lịch sử | Không biết đã tải gì, file nằm đâu |
| Popup chỉ hiện host bắt được | Không biết gì về việc đang tải |
| Panel chỉ hiện "chất lượng tốt nhất" | Danh sách format không lên được vì trước đây gọi sai đường |
| Không tải được riêng âm thanh | `yt-dlp` làm được, UI chưa phơi ra |
| Menu bar không biết gì về download | Đóng trình duyệt là mù hẳn về tiến trình |
| Cửa sổ app chỉ thấy download của chính nó | Tải từ extension hay CLI thì cửa sổ app không hay biết |
| Extension chưa có icon | Chrome hiện mảnh ghép mặc định, và không có cách nào liếc biết đang tải hay không |

Thêm hai khoản nợ kỹ thuật cần cắt trong cùng đợt (§8).

## 2. Ràng buộc đã đo, không phải giả định

Ba ràng buộc dưới đây được kiểm chứng trực tiếp trong phiên này. Chúng quyết định
kiến trúc chứ không phải sở thích.

### 2.1. Service worker MV3 bị giết giữa chừng

Trích tài liệu Chrome:

> Chrome terminates a service worker: after **30 seconds of inactivity**; when a
> **single request takes longer than 5 minutes** to process; when a `fetch()`
> response takes more than **30 seconds** to arrive.

**Hệ quả:** cách hiện tại (service worker giữ một `fetch` SSE mở suốt quá trình
tải) **hỏng với mọi download dài hơn 5 phút**. Nó chạy được lúc thử chỉ vì video
đủ ngắn. Đây là lỗi tiềm ẩn đang có trong code, không phải rủi ro tương lai.

### 2.2. Content script không gọi được backend

`fetch` từ content script bị Chrome gắn `Origin` của **trang**. Mọi lời gọi phải
đi qua service worker. Đã ghi ở ADR 0005 §7.5.

### 2.3. Extension có host_permissions thì không gửi `Origin`

Chrome cho gọi thẳng, không ràng buộc CORS, không gửi `Origin`. Xác thực dùng
header `X-Streamloot-Extension-Id`. Đã ghi ở ADR 0005 §7.5.

## 3. Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Backend sở hữu lịch sử, extension cache local** | Một nguồn sự thật, sống qua lần gỡ/cài lại; cache để popup mở ra hiện ngay, không đợi mạng |
| D2 | **Danh sách download là toàn cục** | Download sống ở backend chứ không sống trong tab; hiển thị theo tab là nói dối về nơi nó chạy |
| D3 | **Nút nổi trên video → panel CHỈ chọn format. Quản lý nằm ở popup** | Panel sống trong trang người khác nên phải nhỏ; popup là bề mặt của riêng extension nên chứa được tab |
| D4 | **Polling, không streaming** | §2.1. B (keep-alive) không sửa được giới hạn 5 phút; C (offscreen) không có `reason` hợp lệ cho việc giữ kết nối mạng |
| D5 | **Menu bar hiện MỘT video đang tải + pause/resume/stop, xong thì ẩn** | Bề mặt duy nhất còn lại khi đóng trình duyệt. Một dòng là đủ để liếc; danh sách đầy đủ ở popup |
| D6 | **Cửa sổ app thấy mọi download và mọi lịch sử, bất kể nguồn** | Nó là bề mặt đầy đủ nhất; thấy thiếu là sai. Kéo theo xoá `localStorage` ở `useTasks.ts` |
| D7 | **Icon có vòng tiến trình vẽ bằng `OffscreenCanvas`, ẩn khi không tải** | Vẽ theo **dữ liệu đổi**, không theo bộ đếm — nên không phạm D4. Chặn vẽ thừa bằng cách chỉ vẽ khi phần trăm đổi tới bội số 5 |

## 4. Kiến trúc

```
┌─ Trang web ──────────────┐   ┌─ Service Worker ────────┐   ┌─ Backend ────────┐
│ Nút nổi trên video       │   │                         │   │                  │
│  └ bấm → Panel           │◄─►│ Bộ nhớ trạng thái tải   │◄─►│ /downloads/*     │
│     (CHỈ chọn format)    │   │ Poll khi có người xem   │   │ /history?source= │
│  all_frames: true        │   │ chrome.alarms đối soát  │   │ /formats/prepared│
│  (không fetch trực tiếp) │   │                         │   │ /downloads/active│
└──────────────────────────┘   └─────────────────────────┘   └──────────────────┘
                                          ▲
┌─ Popup (extension page) ─┐              │
│ tab Tải  + điều khiển    │──────────────┘  (fetch thẳng, là extension page)
│ tab Lịch sử              │
└──────────────────────────┘

┌─ Menu bar (app macOS) ───┐
│ 1 video + pause/stop     │──► đọc thẳng HistoryService, KHÔNG qua HTTP
│ dựng lại mỗi lần mở      │    (cùng tiến trình — xem §5.4)
└──────────────────────────┘

┌─ Cửa sổ app (React) ─────┐
│ MỌI download, mọi nguồn  │──► HTTP + EventSource (cửa sổ sống lâu nên
│ MỌI lịch sử, có nhãn     │    không dính giới hạn §2.1 — xem §5.5)
└──────────────────────────┘
```

### 4.1. Ai sở hữu cái gì

| Dữ liệu | Nguồn sự thật | Cache |
|---|---|---|
| Task đang chạy (tiến trình, trạng thái) | Backend (`download_tasks`) | `storage.session` trong SW. Cửa sổ app **không cache** — xem §5.5 |
| Lịch sử đã tải xong | Backend (`download_history`) | `storage.local` trong SW, **20 mục gần nhất** |
| Manifest bắt được theo tab | Service worker | `storage.session` |
| Cấu hình (cổng, concurrency) | `storage.local` | — |

**Extension không bao giờ là nguồn sự thật cho trạng thái download.** Nó chỉ
phản chiếu. Service worker chết lúc nào cũng không mất gì — hồi phục bằng một lần
gọi `/downloads/active`.

### 4.2. Nhịp poll

| Bối cảnh | Nhịp | Vì sao |
|---|---|---|
| Panel đang mở, có task chạy | **1s** | Mỗi tin nhắn tự đánh thức SW, nên không lo timeout 30s |
| Popup đang mở | **1s**, gọi thẳng backend | Popup là extension page, fetch được |
| Không mở gì, có task chạy | **60s** qua `chrome.alarms` | Đủ để badge và cache không lệch quá xa |
| Không có task nào | **không poll** | Không đốt tài nguyên vô ích |
| Menu bar macOS | **không poll bao giờ** | macOS gọi `menuNeedsUpdate_` ngay trước khi hiện menu — đọc một phát tại đúng thời điểm đó (§5.4) |
| Cửa sổ app | **`EventSource`**, không poll | Cửa sổ sống lâu nên không dính giới hạn §2.1. Làm mới danh sách khi mở và khi `shown` (§5.5) |

Poll dừng ngay khi mọi task về trạng thái kết thúc.

## 5. Thiết kế UI

### 5.1. Nút nổi trên video → panel chọn format

Mặc định chỉ là **một nút nhỏ**, neo ở **góc trên bên phải video đang phát**.

```
┌─ video ────────────────────────────┐
│                            [ ⤓ ]   │  ← nút nổi
│            (video đang phát)       │
└────────────────────────────────────┘
```

Bấm nút → panel. **Panel chỉ làm một việc: chọn format.** Không có tab, không có
tiến trình, không có lịch sử.

```
┌────────────────────────────────┐
│ Chọn để tải                  ✕ │
├────────────────────────────────┤
│ 🎬 VIDEO                       │
│  HD         720p        .mp4   │  ← bấm thẳng vào dòng là tải
│  Standard   480p        .mp4   │
│  Medium     360p        .mp4   │
│                                │
│ 🎵 ÂM THANH                    │
│  Medium     128kbps     .mp3   │
└────────────────────────────────┘
```

Bấm một dòng → gửi lệnh tải → panel đóng lại. Muốn xem tiến trình thì mở popup
(§5.2). **Panel không theo dõi gì sau khi đã bàn giao** — nó là bộ chọn format,
không phải trình quản lý.

| Nguyên tắc | Lý do |
|---|---|
| Panel không có tab | Nó sống trong trang của người khác, chiếm chỗ càng ít càng tốt |
| Bấm dòng là tải luôn, không cần nút xác nhận | Một thao tác thay vì hai; chọn nhầm thì huỷ ở popup |
| Đóng ngay sau khi bấm | Việc của nó xong rồi; để lại là chắn mất video |

### 5.1.1. Neo nút vào video: ràng buộc thật

Đây là phần khó nhất của cả thiết kế, không phải phần vẽ.

**Không vi phạm B7.** B7 cấm *đọc `<video>.src`* để lấy URL — vì đó là blob URL vô
dụng. Đọc *vị trí* của phần tử video là việc khác hẳn và hoàn toàn hợp lệ.

| Vấn đề | Cách xử lý |
|---|---|
| Video đổi kích thước, cuộn trang, vào toàn màn hình | `ResizeObserver` + `IntersectionObserver` trên phần tử video; đặt lại vị trí nút theo `getBoundingClientRect()` |
| Trang có nhiều video | Neo vào video **lớn nhất đang phát**. Không có cái nào đang phát thì neo vào cái lớn nhất trong khung nhìn |
| Video được thay bằng phần tử mới (SPA) | `MutationObserver` ở cấp `document`, gắn lại |
| Không tìm thấy video nào | Lùi về góc trên phải **cửa sổ**, không biến mất — vẫn phải bấm được |
| **Video nằm trong iframe** | Xem bên dưới |

**Iframe là ca nghiêm trọng nhất.** Đo thật cho thấy **2 trong 3 site đích phục vụ
stream qua iframe player riêng** (ADR 0005 §7.1). Content script ở khung trên cùng
không thấy phần tử video bên trong iframe.

**Đã chốt: bật `all_frames: true`.** Neo vào phần tử `<iframe>` thì nút nằm đúng
góc iframe chứ không phải góc *video* — mà iframe thường có viền, thanh điều khiển
riêng, hoặc lớn hơn video. Bật `all_frames` cho kết quả đúng.

Ba hệ quả phải xử lý, nếu không nó thành gánh nặng:

| Hệ quả | Cách xử lý |
|---|---|
| Content script chạy trong **mọi** iframe, kể cả quảng cáo và tracker | **Thoát ngay** nếu khung không có phần tử `<video>` nào. Kiểm tra này gần như miễn phí và loại bỏ tuyệt đại đa số khung |
| Nhiều khung cùng dựng nút → nhiều nút trên một trang | Mỗi khung chỉ dựng nút cho video **trong chính nó**. Khung không có video thì đã thoát ở bước trên. Trang có nhiều video thật thì nhiều nút là đúng |
| Khung con gửi tin nhắn cho service worker | Không phải xử lý gì thêm — `sender.tab.id` giống nhau cho mọi khung của cùng một tab, nên việc gom manifest theo tab vẫn đúng |

### 5.2. Popup — hai tab

Bấm icon extension. Đây là nơi **quản lý**, tách hẳn khỏi trang web.

```
┌──────────────────────────────────┐
│ Streamloot          [Tải][Lịch sử]│  ← tab
│ ● Đã kết nối     127.0.0.1:8001  │
├──────────────────────────────────┤
│ TAB TẢI                          │
│                                  │
│ Tên video                   62%  │
│ ████████████░░░░░  3.2MB/s       │
│ [⏸] [✕]                          │
│                                  │
│ Tên video khác        Tạm dừng   │
│ ██████░░░░░░░░░░░                │
│ [▶] [✕]                          │
│                                  │
│ ── Bắt được trên tab này: 2 ──   │
│ cdn-host                         │
├──────────────────────────────────┤
│ [Cài đặt]                        │
└──────────────────────────────────┘
```

**Tab Lịch sử** — danh sách phẳng những file đã tải qua extension:

```
│ TAB LỊCH SỬ                      │
│ Tên video          ✓  2 phút trước│
│ [Hiện trong Finder]               │
│ Tên video khác     ✗  Thất bại    │
```

| Tab | Nội dung | Phạm vi |
|---|---|---|
| **Tải** | Download đang chạy + điều khiển + stream bắt được trên tab hiện tại | Download: **toàn cục** (D2). Stream bắt được: **theo tab** |
| **Lịch sử** | File đã tải xong qua extension | Toàn cục, từ backend (D1) |

Popup **có** nút pause/resume/cancel — khác với ghi chú ở bản trước. Nó là bề mặt
quản lý chính của extension, nên phải điều khiển được.

### 5.3. Icon extension: vòng tiến trình

Extension **hiện chưa có icon nào** — Chrome đang hiện mảnh ghép mặc định. Phần
này gồm hai việc: tạo icon nền, rồi vẽ vòng tiến trình quanh nó.

#### Hành vi

```
   Rảnh              Đang tải 35%        Đang tải 80%        Xong
    ⤓                    ◜⤓                 ◝⤓◞                 ⤓
                      (vòng 1/3)        (vòng 4/5)        (vòng biến mất)
```

| Trạng thái | Icon |
|---|---|
| Không có download | Icon trần, **không có vòng** |
| Đang tải | Icon + vòng cung chạy quanh, lấp đầy theo phần trăm |
| Tạm dừng | Icon + vòng dừng ở mức hiện tại, **đổi sang màu xám** |
| Vừa xong | Vòng chạy nốt tới 100% rồi **ẩn hẳn**, về icon trần |

Không có chữ số phần trăm trên icon. Con số nằm ở popup và menu bar.

#### Vẽ bằng gì

Service worker MV3 không có DOM, **nhưng có `OffscreenCanvas`**. Vẽ icon nền +
một cung tròn rồi đẩy qua `chrome.action.setIcon({imageData})`. Không cần thư viện,
không cần offscreen document.

#### Vì sao việc này KHÔNG phạm vào D4

D4 loại bỏ mọi thứ cần bộ đếm lặp lại, vì gọi API extension theo chu kỳ chính là
cách giữ service worker sống.

Vòng tiến trình **không cần bộ đếm nào**. Nó vẽ lại khi **dữ liệu đổi**, mà dữ liệu
đến từ nhịp poll vốn đã có ở §4.2:

| Bối cảnh | Vòng cập nhật mỗi | Vì sao |
|---|---|---|
| Popup hoặc panel đang mở | **~1s** | Đã poll sẵn ở nhịp đó |
| Không mở gì | **~30–60s** | Theo `chrome.alarms`; thô nhưng vẫn cho biết còn sống và tới đâu |

**Không tăng nhịp poll chỉ để vòng mượt hơn.** Làm thế là quay lại đúng
antipattern, chỉ đổi tên. Vòng mượt khi bạn đang nhìn, thô khi bạn không nhìn —
và khi không nhìn thì cũng không ai cần mượt.

#### Chặn vẽ thừa

Chỉ gọi `setIcon` khi **phần trăm làm tròn tới bội số 5 thay đổi**. Một download
vì thế tốn tối đa 20 lần vẽ, bất kể poll bao nhiêu lần. Poll ở 1s cho video 10
phút là 600 lần poll nhưng chỉ 20 lần vẽ.

#### Nhiều download cùng lúc

Vòng bám **task khởi động gần nhất**, giống menu bar (D5).

Đã cân nhắc lấy trung bình mọi task rồi loại: thêm một download mới sẽ kéo tổng
phần trăm **tụt xuống**, tức vòng chạy ngược — trông như hỏng. Con số của một task
thì luôn tăng.

#### Badge

Badge bổ sung cho vòng chứ không lặp lại:

| Trạng thái | Badge | Màu nền |
|---|---|---|
| Có nhiều hơn 1 download đang chạy | Số task đang chạy | Xanh dương |
| Đúng 1 download | **Trống** — vòng đã nói rồi | — |
| Không tải, có stream bắt được trên tab này | Số stream | Xám |
| Không có gì | Trống | — |

Số stream là **theo tab**; số download là **toàn cục** (D2).

#### Asset cần tạo

| Tệp | Cỡ | Ghi chú |
|---|---|---|
| `icon-16/32/48/128.png` | 4 cỡ | Icon nền, cũng là `icons` trong manifest |

Chỉ **một** bộ. Vòng tiến trình vẽ lúc chạy nên không cần biến thể tĩnh nào.

### 5.4. Menu trên menu bar (app macOS)

Bề mặt thứ tư, và là **bề mặt duy nhất còn lại khi đóng cả trình duyệt lẫn cửa sổ
app** — đúng lúc bạn cần biết tiến trình nhất.

**Không có download nào** — giữ nguyên như hiện tại:

```
⤓
├ Mở cửa sổ Streamloot
├ ────────────────────
├ Backend: 127.0.0.1:8001      (mờ, không bấm được)
├ ────────────────────
└ Thoát Streamloot         ⌘Q
```

**Đang tải** — chèn thêm một khối lên đầu:

```
⤓
├ Tên video…                62%   (mờ, chỉ để đọc)
├ ⏸  Tạm dừng
├ ✕  Huỷ
├ ────────────────────
├ Mở cửa sổ Streamloot
├ ────────────────────
├ Backend: 127.0.0.1:8001      (mờ)
├ ────────────────────
└ Thoát Streamloot         ⌘Q
```

**Đang tạm dừng** — dòng trạng thái đổi thành `Tạm dừng`, và `⏸ Tạm dừng` đổi
thành `▶ Tiếp tục`.

Quy tắc:

| Quy tắc | Lý do |
|---|---|
| Chỉ hiện **một** video | Menu bar để liếc, không phải để quản lý. Danh sách đầy đủ ở panel |
| Nếu có nhiều task, lấy **cái khởi động gần nhất** | Gần như luôn là cái người dùng vừa bấm, tức cái họ đang quan tâm |
| Tải xong là **ẩn hẳn khối này** | Không để lại dòng "100%" trơ ra sau khi việc đã xong |
| Tên video cắt ngắn (~40 ký tự) | Menu bar hẹp; tên đầy đủ đã có ở panel và cửa sổ app |

**Thay đổi kỹ thuật bắt buộc:** `apps/desktop/statusbar.py` hiện dựng `NSMenu`
**một lần** lúc cài đặt, nên nội dung đóng băng vĩnh viễn. Phải thêm
`NSMenuDelegate` và cài `menuNeedsUpdate_` để dựng lại mỗi lần người dùng mở menu.

Đổi lại được một tính chất đáng giá: **menu bar không cần poll gì cả.** macOS gọi
`menuNeedsUpdate_` ngay trước khi hiện menu, nên chỉ cần đọc một phát từ
`HistoryService` tại đúng thời điểm đó. Khác hẳn panel và popup (§4.2).

Ba nút gọi thẳng service nội bộ, **không qua HTTP** — app đang ở trong cùng tiến
trình, đi vòng qua chính API của mình là thừa.

### 5.5. Cửa sổ app macOS

Yêu cầu: cửa sổ app phải thấy **mọi** download, bất kể khởi động từ đâu — chính
nó, extension, hay CLI. Và mở cửa sổ lên giữa lúc đang tải thì phải thấy tiến
trình đầy đủ.

**Hiện tại nó không làm được.** `useTasks.ts` lưu danh sách task id vào
`localStorage` rồi khôi phục từ đó, nên chỉ biết những task **do chính nó khởi
động**. Task từ extension hay CLI hoàn toàn vô hình.

**Cách sửa lại xoá được code.** `/downloads/active` (§6.2) đã là nguồn sự thật cho
"đang có gì chạy", nên `localStorage` kia thành thừa:

| Trước | Sau |
|---|---|
| Lưu task id vào `localStorage` mỗi khi danh sách đổi | **Xoá.** Không lưu gì |
| Lúc khởi động đọc `localStorage` rồi `getTask` từng cái | Gọi một lần `/downloads/active` |
| Chỉ thấy task của chính mình | Thấy mọi task, mọi nguồn |

Đây là đúng nguyên tắc D1 áp cho desktop: backend sở hữu, client phản chiếu.

**Ba thời điểm làm mới:**

| Khi nào | Vì sao |
|---|---|
| Cửa sổ khởi động | Dựng trạng thái ban đầu |
| Sự kiện `shown` của cửa sổ | B2 cho phép ẩn cửa sổ mà app vẫn chạy — ẩn xong mở lại có thể đã khác rất nhiều |
| Sau khi tự khởi động một download | Như hiện tại |

Desktop **giữ `EventSource`** chứ không chuyển sang polling: cửa sổ sống lâu, không
dính giới hạn của service worker ở §2.1. Với task nó không tự khởi động (nên không
có token), xin token qua `POST /downloads/{id}/stream-token` — cơ chế này đã có sẵn.

**Lịch sử hiện mọi nguồn**, kèm nhãn để phân biệt:

```
Tên video            ✓  Desktop    2 phút trước
Tên video khác       ✓  Extension  1 giờ trước
Tên video nữa        ✗  CLI        Hôm qua
```

Bản ghi cũ không có `source` hiện `—` (§6.1: không backfill vì không có cách nào
biết ngược).

## 6. Thay đổi backend

### 6.1. Cột `source` (D1)

```sql
ALTER TABLE download_history ADD COLUMN source TEXT DEFAULT 'unknown';
ALTER TABLE download_tasks   ADD COLUMN source TEXT DEFAULT 'unknown';
```

Theo đúng cách bảng này đã migrate trước đây (`ALTER TABLE ... ADD COLUMN` trong
`try`). Giá trị: `cli`, `desktop`, `extension`. Bản ghi cũ giữ `unknown` — không
backfill, vì không có cách nào biết ngược.

### 6.2. Endpoint mới / sửa

| Endpoint | Thay đổi |
|---|---|
| `GET /api/v1/downloads/active` | **Mới.** Trả mọi task chưa kết thúc, **bao gồm cả `paused`**. Đường hồi phục khi service worker bị thu hồi |
| `GET /api/v1/history` | Thêm tham số `?source=` để lọc |
| `POST /api/v1/downloads/prepared` | Ghi `source='extension'` |
| `POST /api/v1/downloads` | Nhận `source` tuỳ chọn, mặc định `unknown`. Desktop UI gửi `desktop`, CLI gửi `cli` |

`pause` / `resume` / `cancel` **không đổi** — đã có và đúng ngữ nghĩa:

| Endpoint | Hành vi hiện có |
|---|---|
| `POST /downloads/{id}/pause` | `SIGSTOP` lên process yt-dlp thật. 409 nếu đã kết thúc hoặc đã tạm dừng, 409 nếu chưa có process |
| `POST /downloads/{id}/resume` | `SIGCONT`. 409 nếu không ở trạng thái `paused`, 409 nếu process không còn |
| `POST /downloads/{id}/cancel` | Đặt trạng thái `cancelling`. 404 nếu không có task, 409 nếu đã kết thúc |

## 7. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| App chưa chạy | Panel/popup hiện **"App chưa chạy"** kèm gợi ý kiểm icon menu bar. Danh sách lịch sử vẫn hiện **từ cache** (D1) |
| App từ chối (401) | Hiện **"App từ chối extension này"** kèm hướng dẫn build lại. Log phía app ghi cả ID nhận được lẫn ID chấp nhận |
| Pause/resume trả 409 | Hiện đúng thông điệp backend trả về, rồi poll lại ngay để đồng bộ trạng thái thật — 409 thường nghĩa là UI đang lệch |
| Service worker bị thu hồi giữa chừng | Không xử lý gì đặc biệt. Lần poll kế tiếp gọi `/downloads/active` và dựng lại toàn bộ trạng thái |
| Không lấy được danh sách format | **Không chặn việc tải.** Backend vẫn tự chọn chất lượng tốt nhất |
| Tab đóng giữa lúc tải | Download chạy tiếp. Đây là điểm mấu chốt của D2 |

## 8. Cắt tỉa cùng đợt

| Bỏ gì | Vì sao |
|---|---|
| Đường xác thực qua `Origin` trong `verify_client` và `stream_progress` | §2.3 — extension không bao giờ gửi `Origin`. Nhánh này không thể khớp, giữ lại chỉ gây hiểu nhầm là nó đang có tác dụng |
| `streamProgress` trong `lib/api.ts` của extension | D4 — thay bằng polling. Giữ lại là để một quả mìn hẹn giờ 5 phút trong code |
| `startDownloadByUrl` nếu vẫn không dùng | Viết cho B9 nhưng chưa nối vào UI. Nối vào hoặc bỏ, đừng để lơ lửng |
| `localStorage` lưu task id ở `useTasks.ts` (desktop) | §5.5 — `/downloads/active` thay thế hoàn toàn. Giữ lại là hai nguồn sự thật cho cùng một thứ |

**Không bỏ** `GET /api/v1/formats` (đường extract từ URL): desktop UI vẫn dùng, và
nó là đường B9 cho site mà extension bó tay.

**Không bỏ** token dùng-một-lần cho SSE: desktop UI dùng `EventSource` và nó
không set được header.

**`statusbar.py` sẽ lớn lên** khi thêm menu động. Nếu vượt ~200 dòng thì tách
phần dựng menu ra `apps/desktop/statusbar_menu.py`, giữ `statusbar.py` lo vòng đời
và activation policy.

## 9. Kiểm thử

| Tầng | Kiểm gì |
|---|---|
| Backend | `source` ghi đúng cho từng đường vào; `?source=` lọc đúng; `/downloads/active` chỉ trả task chưa kết thúc; pause/resume/cancel giữ nguyên mã lỗi 404/409 |
| Backend | Migration chạy được trên CSDL đã có dữ liệu, bản ghi cũ thành `unknown` |
| Extension | Máy trạng thái poll: bắt đầu khi có task, dừng khi hết, đổi nhịp theo việc có ai đang xem |
| Extension | Hồi phục: xoá sạch cache rồi gọi `/downloads/active` phải dựng lại đủ danh sách, gồm cả task đang tạm dừng |
| Extension | `all_frames`: khung không có `<video>` phải thoát ngay, không dựng gì |
| Extension | Vòng tiến trình: vẽ đúng phần trăm, ẩn khi không có download |
| Extension | **Chặn vẽ thừa**: poll 600 lần cho một video dài phải sinh tối đa 20 lần `setIcon` |
| Extension | Không có lời gọi `setIcon` nào lặp theo chu kỳ khi phần trăm đứng yên |
| Thủ công | Tải một video **dài hơn 5 phút**, đóng panel, đổi trang, mở lại — tiến trình phải còn đúng. Đây là ca mà thiết kế cũ hỏng |
| Thủ công | Pause giữa chừng, đợi, resume — file cuối cùng phải nguyên vẹn |
| Thủ công | **Đóng hẳn trình duyệt** trong lúc tải, mở menu bar — phải thấy đúng tiến trình và bấm tạm dừng được |
| Thủ công | Tải xong, mở lại menu bar — khối download phải biến mất hoàn toàn |
| Thủ công | Bắt đầu tải **từ extension**, mở cửa sổ app — phải thấy tiến trình đang chạy |
| Thủ công | Bắt đầu tải **từ CLI**, mở cửa sổ app — phải thấy nó trong danh sách |
| Thủ công | Ẩn cửa sổ app, tải xong một file, mở lại — lịch sử phải có nó kèm đúng nhãn nguồn |

## 10. Không làm (YAGNI)

- **Hàng đợi / giới hạn đồng thời trong extension.** Backend đã có `_download_slots`.
- **Sửa lịch sử, gắn thẻ, tìm kiếm.** Danh sách phẳng là đủ cho một người dùng.
- **Thông báo hệ thống khi tải xong.** Thêm quyền `notifications` cho một tiện ích nhỏ.
- **Tải lại từ mục lịch sử.** Nghe hợp lý nhưng URL stream thường có hạn sử dụng — bấm vào là hỏng, tệ hơn là không có nút.
- **Đồng bộ lịch sử giữa nhiều máy.** Không có máy chủ, và cũng không ai cần.

## 11. Câu hỏi mở — đã chốt hết

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Neo vào iframe hay bật `all_frames`? | **`all_frames: true`**, kèm ba biện pháp giảm chi phí ở §5.1.1 |
| 2 | Cache lịch sử bao nhiêu mục? | **20**. Đủ cho "vừa tải gì"; muốn xem xa hơn thì mở cửa sổ app |
| 3 | `/downloads/active` có trả task `paused` không? | **Có.** Nó chưa kết thúc, và người dùng cần thấy để bấm tiếp tục |
| 4 | Nhịp poll 1s có quá dày? | **Giữ 1s.** Một lời gọi trả cả danh sách nên chi phí không nhân theo số task |

Không còn câu hỏi mở. Spec sẵn sàng để chuyển sang implementation plan.
