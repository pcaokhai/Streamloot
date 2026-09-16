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

Popup hiện con số duy nhất cần thiết: **bắt được mấy site**, kèm bảng chi tiết.

| Cột | Nghĩa |
|---|---|
| **Host** | Tên miền của manifest (thường là CDN, khác tên miền trang) |
| **Hits** | Số manifest khác nhau bắt được |
| **Qua** | `url` = khớp đuôi `.m3u8`/`.mpd`; `content-type` = khớp header. Thấy `content-type` xuất hiện tức là **B12 có giá trị thật** |
| **Ngữ cảnh phiên** | Bắt được `cookie`/`referer`/`ua` chưa — đây là bước 3 của mô hình IDM (ADR 0005 §2.1). Thiếu cookie thì URL stream nhiều khả năng trả 403 khi tải ngoài trình duyệt |

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
