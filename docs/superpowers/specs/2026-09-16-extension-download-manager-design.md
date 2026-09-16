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
| D3 | **Chỉ hiện NÚT NỔI khi bắt được stream; panel mở khi bấm** | Giữ giá trị B8 (thấy ngay là tải được) mà không chiếm chỗ trên trang |
| D4 | **Polling, không streaming** | §2.1. B (keep-alive) không sửa được giới hạn 5 phút; C (offscreen) không có `reason` hợp lệ cho việc giữ kết nối mạng |

## 4. Kiến trúc

```
┌─ Trang web ──────────────┐   ┌─ Service Worker ────────┐   ┌─ Backend ────────┐
│ Nút nổi trên video       │   │                         │   │                  │
│  └ bấm → Panel           │◄─►│ Bộ nhớ trạng thái tải   │◄─►│ /downloads/*     │
│      ├ tab Tải           │   │ Poll khi có người xem   │   │ /history?source= │
│      └ tab Lịch sử       │   │ chrome.alarms đối soát  │   │ /formats/prepared│
│  (không fetch trực tiếp) │   │                         │   │ /downloads/active│
└──────────────────────────┘   └─────────────────────────┘   └──────────────────┘
                                          ▲
┌─ Popup (extension page) ─┐              │
│ Tóm tắt + tiến trình     │──────────────┘  (hoặc fetch thẳng, cùng origin quyền)
└──────────────────────────┘
```

### 4.1. Ai sở hữu cái gì

| Dữ liệu | Nguồn sự thật | Cache |
|---|---|---|
| Task đang chạy (tiến trình, trạng thái) | Backend (`download_tasks`) | `storage.session` trong SW |
| Lịch sử đã tải xong | Backend (`download_history`) | `storage.local` trong SW |
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

Poll dừng ngay khi mọi task về trạng thái kết thúc.

## 5. Thiết kế UI

### 5.1. Nút nổi gắn vào video

Panel **không** tự bung ra thành một hộp. Mặc định nó chỉ là **một nút nhỏ**, neo
ở **góc trên bên phải của video đang phát**. Bấm vào mới mở.

```
┌─ video ────────────────────────────┐
│                            [ ⤓ ]   │  ← nút nổi, góc trên phải
│                                    │
│            (video đang phát)       │
│                                    │
└────────────────────────────────────┘
```

Bấm nút → mở panel, mặc định ở tab **Tải**:

```
┌────────────────────────────────────────┐
│ Chọn để tải              [Tải][Lịch sử]✕│  ← tab
├────────────────────────────────────────┤
│ 🎬 VIDEO                               │
│  HD          720p            .mp4      │  ← bấm thẳng vào dòng là tải
│  Standard    480p            .mp4      │
│  Medium      360p            .mp4      │
│                                        │
│ 🎵 ÂM THANH                            │
│  Medium      128kbps         .mp3      │
├────────────────────────────────────────┤
│ ── Đang tải ──                         │
│  Tên video                      62%    │
│  ████████████░░░░░  3.2MB/s            │
│  [⏸] [✕]                               │
└────────────────────────────────────────┘
```

Khác biệt so với bản hiện tại:

| Bản hiện tại | Bản này |
|---|---|
| Hộp tự bung ở góc màn hình | Nút nhỏ neo vào video, bấm mới mở |
| Một `<select>` thả xuống | Danh sách phẳng, bấm thẳng vào dòng là tải |
| Chỉ có video | Tách nhóm **VIDEO** và **ÂM THANH** |
| Không thấy độ phân giải cho tới khi mở select | Thấy ngay nhãn + độ phân giải + đuôi file |

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
stream qua iframe player riêng** (ADR 0005 §7.1). Content script hiện chỉ chạy ở
khung trên cùng, nên **không thấy** phần tử video nằm trong iframe và không neo
vào nó được.

Hai cách, cần chọn:

- **`all_frames: true`** — content script chạy trong mọi khung, khung nào có video
  thì khung đó dựng nút. Đơn giản và đúng, nhưng nhân số instance content script
  lên theo số iframe của trang (quảng cáo, tracker…), và cần cơ chế để chỉ một
  khung dựng panel.
- **Giữ khung trên cùng, neo vào phần tử `<iframe>`** thay vì vào video bên trong.
  Nút vẫn nằm đúng góc trên phải vùng phát. Rẻ hơn nhiều, và người dùng không
  phân biệt được. **Đề xuất cách này.**

### 5.2. Popup — tóm tắt

```
┌──────────────────────────────┐
│ Streamloot                   │
│ ● Đã kết nối    127.0.0.1:8001│
├──────────────────────────────┤
│ Đang tải 2                   │
│ Tên video            62% ▓▓░ │
│ Tên video khác    Tạm dừng   │
├──────────────────────────────┤
│ Bắt được trên tab này: 2     │
│ cdn-host                     │
├──────────────────────────────┤
│ [Cài đặt]                    │
└──────────────────────────────┘
```

Popup **không** có nút pause/cancel: nó đóng lại khi mất focus, nên thao tác dễ
hụt. Điều khiển nằm ở panel.

### 5.3. Badge trên icon

| Trạng thái | Badge |
|---|---|
| Có download đang chạy | Số task đang chạy, nền xanh dương |
| Không tải, có stream bắt được | Số stream, nền xám |
| Không có gì | Trống |

Đang tải được ưu tiên hơn số stream bắt được — nó là thông tin cấp bách hơn.

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
| `GET /api/v1/downloads/active` | **Mới.** Trả mọi task chưa ở trạng thái kết thúc. Đây là đường hồi phục khi service worker bị thu hồi |
| `GET /api/v1/history` | Thêm tham số `?source=` để lọc |
| `POST /api/v1/downloads/prepared` | Ghi `source='extension'` |
| `POST /api/v1/downloads` | Nhận `source` tuỳ chọn, mặc định `unknown` |

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

**Không bỏ** `GET /api/v1/formats` (đường extract từ URL): desktop UI vẫn dùng, và
nó là đường B9 cho site mà extension bó tay.

**Không bỏ** token dùng-một-lần cho SSE: desktop UI dùng `EventSource` và nó
không set được header.

## 9. Kiểm thử

| Tầng | Kiểm gì |
|---|---|
| Backend | `source` ghi đúng cho từng đường vào; `?source=` lọc đúng; `/downloads/active` chỉ trả task chưa kết thúc; pause/resume/cancel giữ nguyên mã lỗi 404/409 |
| Backend | Migration chạy được trên CSDL đã có dữ liệu, bản ghi cũ thành `unknown` |
| Extension | Máy trạng thái poll: bắt đầu khi có task, dừng khi hết, đổi nhịp theo việc có ai đang xem |
| Extension | Hồi phục: xoá sạch cache rồi gọi `/downloads/active` phải dựng lại đủ danh sách |
| Thủ công | Tải một video **dài hơn 5 phút**, đóng panel, đổi trang, mở lại — tiến trình phải còn đúng. Đây là ca mà thiết kế cũ hỏng |
| Thủ công | Pause giữa chừng, đợi, resume — file cuối cùng phải nguyên vẹn |

## 10. Không làm (YAGNI)

- **Hàng đợi / giới hạn đồng thời trong extension.** Backend đã có `_download_slots`.
- **Sửa lịch sử, gắn thẻ, tìm kiếm.** Danh sách phẳng là đủ cho một người dùng.
- **Thông báo hệ thống khi tải xong.** Thêm quyền `notifications` cho một tiện ích nhỏ.
- **Tải lại từ mục lịch sử.** Nghe hợp lý nhưng URL stream thường có hạn sử dụng — bấm vào là hỏng, tệ hơn là không có nút.
- **Đồng bộ lịch sử giữa nhiều máy.** Không có máy chủ, và cũng không ai cần.

## 11. Câu hỏi mở

1. **Neo vào iframe hay bật `all_frames`?** Đề xuất neo vào phần tử `<iframe>` ở
   khung trên cùng (§5.1.1) — rẻ hơn hẳn và người dùng không phân biệt được. Cần
   xác nhận trên site thứ ba trước khi chốt.
2. **Giữ bao nhiêu mục lịch sử trong cache local?** Đề xuất 200, cắt cũ nhất. Chưa đo dung lượng thật.
3. **`/downloads/active` có nên trả cả task `paused` không?** Đề xuất có — nó chưa kết thúc, và người dùng cần thấy để bấm resume.
4. **Nhịp poll 1s có quá dày khi tải nhiều file cùng lúc?** Một lời gọi trả cả danh sách nên chi phí không nhân lên, nhưng chưa đo với 5+ task.
