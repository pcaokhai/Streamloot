# Streamloot Extension — Giai đoạn 0 (probe)

Hiện tại thư mục này **chỉ chứa probe** của [ADR 0005 §6.7 Giai đoạn 0](../../docs/ADR/0005-stream-capture-architecture.md),
chưa phải extension thật.

Probe đo đúng một thứ: **`webRequest` có quan sát được manifest stream trên các
site đích không?** Câu trả lời quyết định ADR 0005 có đứng vững hay phải viết lại.

Nó **chỉ quan sát**. Không tải, không gọi backend, không gửi gì ra ngoài máy.

## Chạy

```bash
cd apps/extension
npm install
npm run build
```

Rồi trong Chrome:

1. `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn `apps/extension/.output/chrome-mv3`
3. Mở site cần đo, bấm play
4. Bấm icon extension → popup hiện kết quả

Muốn sửa code và xem ngay thì `npm run dev` (WXT tự reload).

## Đọc kết quả

Popup phân biệt ba trạng thái — quan trọng vì một số 0 trần không đọc được:

| Popup hiện | Nghĩa |
|---|---|
| **"Probe chưa chạy"** | Chưa quan sát được request nào → listener chết. Tải lại trang, hoặc mở `chrome://extensions` → "service worker" xem log |
| **"0 manifest"** + số request đã quan sát | Probe chạy tốt, site này đơn giản là không dùng HLS/DASH. **Kết quả hợp lệ** |
| **"N site bắt được"** | Có manifest, kèm bảng chi tiết bên dưới |

### YouTube ra 0 là đúng

YouTube video thường **không có manifest file**. Media đi qua
`rr*.googlevideo.com/videoplayback?...` kèm range request qua MSE; thông tin
format nằm trong `ytInitialPlayerResponse` JSON của trang. YouTube chỉ dùng m3u8
cho **livestream** (`/api/manifest/hls_variant/`).

Đó cũng là lý do `yt-dlp` xử lý YouTube qua player-response JSON chứ không sniff
manifest — và vì sao YouTube đi đường B9 fallback trong thiết kế, không phải
đường extension.

**Nên đừng dùng YouTube để kiểm tra probe.** Ba site đích đều dùng HLS thật
(cả ba plugin đều lắng nghe `m3u8`), nên chúng mới là phép đo có nghĩa.

### Bảng chi tiết

| Cột | Nghĩa |
|---|---|
| **Trang** | Tên miền trang đã khởi tạo request (từ `initiator`). Nhóm theo cột này, vì câu hỏi "mấy trong 3 site" hỏi về trang |
| **Manifest ở** | Nơi manifest thực sự nằm — **thường là CDN riêng**, khác hẳn tên miền trang |
| **Hits** | Số manifest khác nhau bắt được |
| **Qua** | `url` = khớp đuôi `.m3u8`/`.mpd`; `content-type` = khớp header. Thấy `content-type` xuất hiện tức là **B12 có giá trị thật** |
| **Ngữ cảnh phiên** | Bắt được `cookie`/`referer`/`origin`/`ua` chưa — đây là bước 3 của mô hình IDM (ADR 0005 §2.1). Thiếu cookie thì URL stream nhiều khả năng trả 403 khi tải ngoài trình duyệt |

### B14 — cột Segment

Probe quan sát cả request **segment**, không chỉ manifest. Đây là cột trả lời câu
hỏi còn treo ở [ADR 0005 §7.3](../../docs/ADR/0005-stream-capture-architecture.md):
một plugin đang thu cookie, nhưng trình duyệt không gửi cookie trên request
manifest. Cookie đó cần cho segment, hay là thừa?

| Cột Segment hiện | Kết luận |
|---|---|
| Không có `cookie` | Cookie là thừa. Extension cấp đủ; B1 không cần đường cookie |
| **Có `cookie`** | Cookie cần cho segment. Extension **phải** dùng `chrome.cookies` API — header quan sát được là không đủ |
| "chưa bắt được" | Chưa thấy segment nào. Bấm play và để chạy vài giây |

Segment được nhận diện theo **host** (bất kỳ request nào tới host đã phục vụ
manifest), không theo đuôi file — vì có site ngụy trang segment MPEG-TS thành PNG.
Chỉ lấy 3 mẫu mỗi host: một video là hàng trăm segment.

### Thiếu cookie chưa chắc là vấn đề

Nếu cột ngữ cảnh ra `referer, origin, ua` mà không có `cookie`, hãy đối chiếu với
plugin tương ứng trong `plugins/` trước khi kết luận. Có plugin đang chạy tốt mà
**không** truyền cookie — site đó dùng signed URL chứ không ràng phiên qua cookie.
Chỉ khi plugin có harvest cookie (`page.cookies()`) mà probe không bắt được thì
mới là khoảng cách thật.

## Ghi kết quả vào ADR

Ghi con số vào ADR 0005 §8 item 3, rồi chuyển status theo bảng này:

| Kết quả | Nghĩa |
|---|---|
| 3/3 | ADR 0005 đứng vững → chuyển status sang **Accepted** |
| 2/3 | B9 (fallback về đường headless) cứu site còn lại → vẫn đi tiếp, ghi rõ site nào cần |
| ≤1/3 | Phương án 2 sụp → quay lại §3, đọc §3.1 (ma sát demo) trước khi cân nhắc lại Phương án 3 |

## Hai điều đã kiểm chứng trước khi viết

- **`webRequest` quan sát vẫn dùng được trong MV3.** Chrome docs: *"Aside from
  `webRequestBlocking`, the webRequest API is unchanged and available for normal
  use."* MV3 chỉ bỏ biến thể blocking.
- **Không bao giờ đọc `<video>.src`.** Trang stream đưa cho `<video>` một blob URL
  qua Media Source Extensions — không tải được, không có header. Chỉ tin
  `webRequest`. Đây là B7 trong ADR 0005.

## Ghi chú kỹ thuật

- **Mọi lời gọi runtime nằm trong `defineBackground(() => ...)`.** WXT import file
  entrypoint lúc build (với một fake browser) để đọc config, nên `addListener` ở
  top-level làm hỏng build với lỗi `not implemented`.
- **`extraHeaders` là bắt buộc** để thấy `Cookie` và `Referer` — Chrome lọc các
  header này khỏi listener theo mặc định.
- **State nằm ở `browser.storage.local`, không phải biến module.** MV3 thu hồi
  service worker bất kỳ lúc nào; giữ trong RAM là mất kết quả giữa chừng (C3
  trong ADR 0006).
- **Dùng global `browser` do WXT chuẩn hóa**, không dùng `chrome` — có type sẵn và
  chạy được đa trình duyệt (ADR 0006 §2.3).

## Phạm vi quyền

`host_permissions: ['<all_urls>']` vì probe không biết trước sẽ đo site nào.
**Extension thật phải thu hẹp lại** — đây là quyền rộng nhất Chrome có.
