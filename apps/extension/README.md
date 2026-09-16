# Streamloot Extension

Bắt stream trong phiên duyệt web thật của bạn rồi bàn giao cho app Streamloot
trên máy tải. Kiến trúc và lý do: [ADR 0005](../../docs/ADR/0005-stream-capture-architecture.md),
stack: [ADR 0006](../../docs/ADR/0006-extension-tech-stack.md).

**Không có dữ liệu nào rời khỏi máy.** Extension chỉ gọi `127.0.0.1`.

## Chạy

```bash
cd apps/extension
npm install
npm run build        # hoặc `npm run dev` để có HMR
```

Trong Chrome: `chrome://extensions` → Developer mode → **Load unpacked** →
`apps/extension/.output/chrome-mv3`.

Xong. **Không phải cấu hình gì** — không có API key để dán.

## Nó làm gì

| Phần | Việc |
|---|---|
| Service worker | Quan sát `webRequest`, gom manifest **theo tab**, đặt badge số lượng |
| Panel (content script) | Tự nổi lên khi bắt được, cho chọn chất lượng, tải, hiện tiến trình |
| Popup | Trạng thái kết nối backend — phân biệt *chưa cấu hình* / *không kết nối được* / *đã kết nối* |
| Options | Cổng, số kết nối song song |

## Bốn quyết định không hiển nhiên

**Không bao giờ đọc `<video>.src` (B7).** Trang stream đưa cho `<video>` một blob
URL qua Media Source Extensions: không tải được, không kèm header. Nguồn duy nhất
đáng tin là những gì service worker quan sát từ network.

**Gom theo `tabId`, không theo host.** Đo thật cho thấy manifest nằm ở CDN khác
hẳn tên miền trang, và 2/3 site đích phục vụ stream qua iframe riêng.

**Không xin quyền `cookies`.** Phép đo B14 cho thấy mọi host phục vụ byte media
đều không nhận cookie, nên quyền đó là thừa.

**Không dùng API key.** Backend nhận diện extension qua header `Origin` khớp một
ID đã ghim cứng. Trình duyệt **luôn tự đặt** `Origin` và JS của trang **không ghi
đè được**, nên trang web độc hại không mạo danh được — đúng mô hình đe dọa mà
ADR 0004 nêu. ID cố định nhờ pin `key` trong manifest.

Nói thẳng chỗ yếu hơn: một tiến trình local (`curl`) giả được `Origin`. Nhưng
tiến trình local cũng đọc được API key từ môi trường của app, nên khoản đó vốn đã
không bảo vệ nổi trường hợp này. Không phải đổi an toàn lấy tiện lợi — chỉ là bỏ
một bước copy-paste không mua thêm gì.

**Dùng `fetch` + `ReadableStream` cho tiến trình, không dùng `EventSource`.**
MV3 service worker không có `EventSource`. Đổi lại được thứ tốt hơn: `fetch` set
được header `Authorization`, nên không cần token dùng-một-lần và nối lại stream
bao nhiêu lần cũng được.

## Panel không hiện?

1. Popup có báo *Đã kết nối* không? Không thì lỗi nằm ở app, không phải panel.
   Nếu báo *App từ chối extension này* thì build đã mất `key` trong manifest và ID
   không còn khớp.
2. Badge trên icon có số không? Không có nghĩa là chưa bắt được manifest nào —
   trang có thể không dùng HLS/DASH (YouTube video thường là ví dụ: media đi qua
   `googlevideo.com/videoplayback` + range request, không có manifest file).
3. Đã bấm play chưa? Manifest chỉ được fetch khi player khởi động.

---

# Phụ lục — probe Giai đoạn 0

Extension này tiến hoá từ probe đo `webRequest` (ADR 0005 §6.7 Giai đoạn 0);
`background.ts` của probe chính là bộ khung hiện tại, không có dòng nào bị vứt.
Nhật ký 5 lần chạy, gồm ba lần đoán sai và vì sao:
[`docs/impl/2026-09-16-stage0-probe-log.md`](../../docs/impl/2026-09-16-stage0-probe-log.md).

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
| **Có `cookie`** | Đọc kỹ cảnh báo ngay dưới trước khi kết luận |
| "chưa bắt được" | Chưa thấy segment nào. Bấm play và để chạy vài giây |

> **Bẫy đọc nhầm — quan trọng.** Host của *chính trang* luôn xuất hiện với
> `cookie`, vì đó là XHR **same-origin** (trang gọi API của nó) và trình duyệt
> luôn kèm cookie cho same-origin. **Đó không phải request tải media.** Chỉ xét
> các host *khác* tên miền trang khi trả lời câu hỏi cookie.

**Kết quả đo thật (2026-09-16):** mọi host phục vụ byte đều **không** nhận cookie;
host duy nhất có cookie là XHR same-origin của trang. B14 đóng — xem
[ADR 0005 §7.3](../../docs/ADR/0005-stream-capture-architecture.md).

Cột Segment liệt kê **từng host kèm resource type**, không gộp — gộp lại sẽ che
mất host nào mang cookie.

**Hai cách nhận diện segment đầu tiên đều trượt**, ghi lại để khỏi thử lại:

| Cách | Vì sao trượt |
|---|---|
| Theo đuôi `.ts` | Có site ngụy trang segment MPEG-TS thành PNG — lọc `.ts` trượt đúng site cần đo nhất |
| Theo host của manifest | Segment nằm ở **host khác hẳn** manifest. Đo thật cho thấy manifest một nơi, byte một nơi |

Cách đang dùng: **resource type do chính Chrome gán** (`media`,
`xmlhttprequest`, `other`, `image`). `image` có trong danh sách chính vì segment
ngụy trang PNG sẽ bị phân loại là ảnh. Lấy 2 mẫu mỗi cặp host+type.

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
