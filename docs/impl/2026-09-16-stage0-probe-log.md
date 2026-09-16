# Nhật ký Giai đoạn 0 — probe webRequest

Ghi lại từng lần chạy probe của [ADR 0005 §6.7](../ADR/0005-stream-capture-architecture.md),
phát hiện gì và đổi gì sau mỗi lần. Kết quả tổng hợp nằm ở ADR 0005 §7; tài liệu
này giữ *quá trình*, vì phần lớn giá trị nằm ở ba lần đoán sai.

> **Privacy:** site gọi theo Plugin A/B/C như ADR 0005 §2.4. Hostname thật không
> xuất hiện ở đây.

Mã nguồn: `apps/extension/`. Ngày đo: 2026-09-16.

---

## Lần 1 — YouTube, ra `0 site`

**Phiên bản probe:** khớp `.m3u8`/`.mpd` trong URL, hoặc `Content-Type` tương ứng.
Lưu hit vào `storage.local`, popup hiện số site.

**Kết quả:** `0 site`.

**Phát hiện — lỗi thiết kế của chính probe.** Số 0 đó **không đọc được**: nó vừa
có thể nghĩa là listener chưa chạy, vừa có thể nghĩa là site không có manifest
nào. Một công cụ đo mà kết quả rỗng mang hai nghĩa thì chưa dùng được.

**Phát hiện phụ — YouTube không phải phép thử hợp lệ.** Video thường trên YouTube
không có manifest file: media đi qua `videoplayback` + range request qua MSE,
thông tin format nằm trong JSON của trang. Chỉ livestream mới dùng m3u8. Đây cũng
là lý do `yt-dlp` xử lý YouTube qua player-response chứ không sniff manifest.

**Quyết định:** thêm bộ đếm tổng số request quan sát được, để phân biệt hai nghĩa
của số 0.

**Tradeoff:** đếm mọi request thì phải ghi storage rất nhiều lần. Chọn đếm trong
RAM và flush theo lô 20 vào `storage.session` (bộ nhớ, không chạm đĩa). **Mất tối
đa 19 lần đếm nếu service worker bị thu hồi** — chấp nhận được, vì câu hỏi chỉ là
"có lớn hơn 0 không", không phải con số chính xác.

---

## Lần 2 — Plugin A, ra `1 site`

**Kết quả:** bắt được manifest, qua đường `url`, ngữ cảnh `referer, ua`.

**Phát hiện 1 — manifest nằm trên CDN riêng**, khác hẳn tên miền trang. Khớp với
việc Plugin B vốn đã phải quét iframe để tìm player nhúng.

**Phát hiện 2 — không có cookie, và điều đó không phải vấn đề.** Tra lại plugin
tương ứng: nó trả `VideoInfo` chỉ với `referer` + `origin`, **không truyền
cookie**, và vẫn tải được. Extension cấp đúng thứ plugin đang cấp.

**Phát hiện 3 — popup thiếu một cột.** `ctx.origin` được bắt từ đầu nhưng không
hiển thị — mà `origin` chính là thứ plugin truyền cho downloader.

**Phát hiện 4 — vấn đề thực dụng.** Nhóm theo host CDN thì đo 3 site sẽ ra 3
hostname lạ, người đo phải tự nhớ cái nào của site nào.

**Quyết định:** ghi thêm `d.initiator` và nhóm theo **trang** thay vì theo CDN;
CDN thành một cột riêng. Hiện thêm `origin`.

**Tradeoff:** `d.initiator` cho origin của **iframe** khởi tạo request, không phải
tab. Với site có player nhúng, cột "Trang" sẽ hiện tên miền iframe chứ không phải
tên miền người dùng gõ. Giữ nguyên, vì thông tin đó **đúng và hữu ích** — nó lộ ra
kiến trúc iframe mà plugin phải xử lý.

---

## Lần 3 — cả 3 site, ra `3/3`

| Plugin | Bắt được | Qua | Ngữ cảnh |
|---|---|---|---|
| **A** (auto-click Turnstile) | ✅ | `url` | `referer, origin, ua` |
| **B** (quét iframe) | ✅ | `url` | `referer, origin, ua` |
| **C** (cookie + `clean_disguised_ts`) | ✅ | `url` | `origin, ua` |

~400 request quan sát được, nên mọi số 0 là "không có" chứ không phải "hỏng".

**Phát hiện 1 — luận điểm trung tâm của ADR 0005 đúng.** Bắt được manifest trên cả
3 site trong session thật, **không cần một dòng auto-click Turnstile nào**. Cách
headless hiện tại đang trả giá để giả lập cái mà trình duyệt người dùng đã có sẵn.

**Phát hiện 2 — B12 chưa chứng minh được giá trị.** Không hit nào qua đường
`content-type`; cả 3 site đều lộ đuôi `.m3u8` trong URL.

**Quyết định:** giữ B12 vì rẻ và phòng site khác, nhưng **hạ ưu tiên** — nó không
phải thứ làm 3 site này chạy được.

**Phát hiện 3 — khoảng cách ở Plugin C.** Plugin C *có* thu cookie
(`page.cookies()`) nhưng trình duyệt không gửi cookie trên request manifest, mà
playback vẫn chạy. Nó cũng thiếu `referer` dù plugin có truyền `referer`.

**Quyết định:** không kết luận vội. Probe **chỉ quan sát manifest**, không quan sát
request tải byte — nên không phân biệt được "cookie thừa" với "cookie cần cho
segment". Mở **B14**.

---

## Lần 4 — B14 thử lần đầu, ra `chưa bắt được`

**Phiên bản probe:** nhận diện segment theo hai đường — cùng host với manifest đã
bắt được, hoặc khớp đuôi `.ts`/`.m4s`/`.mp4`/`.aac`.

**Kết quả:** cột Segment ra `chưa bắt được`, **trong khi video đang chạy**.

**Phát hiện — cả hai đường đoán đều sai:**

| Cách đoán | Vì sao trượt |
|---|---|
| Theo đuôi `.ts` | Site này **ngụy trang segment MPEG-TS thành PNG** — chính là lý do plugin có cờ `clean_disguised_ts`. Lọc `.ts` trượt đúng site cần đo nhất |
| Theo host của manifest | Segment nằm ở **host khác hẳn** manifest. Manifest một nơi, byte một nơi |

**Quyết định: thôi đoán.** Dùng **resource type do chính Chrome gán** trên
`d.type`, không suy luận từ URL. Danh sách: `media`, `xmlhttprequest`, `other`,
**`image`** — `image` có mặt chính vì segment ngụy trang PNG sẽ bị Chrome phân
loại là ảnh.

**Tradeoff:** `image` kéo theo mọi thumbnail của trang thành nhiễu. Chấp nhận, vì
giới hạn 2 mẫu mỗi cặp host+type đã chặn bùng nổ, và cột hiện rõ host nên nhiễu
nhận ra được ngay.

---

## Lần 5 — B14 thử lại, có câu trả lời

Trang nói chuyện với 5 host trong lúc phát:

| Host | Resource type | Ngữ cảnh gửi đi | Vai trò |
|---|---|---|---|
| Host manifest | `xmlhttprequest` | `origin, ua` | manifest |
| CDN "ảnh" | **`image`** | **chỉ `ua`** | **segment ngụy trang PNG** |
| CDN tên ngẫu nhiên | `xmlhttprequest` | `origin, ua` | shard phục vụ byte |
| **Host của chính trang** | `xmlhttprequest` | **`cookie`, origin, ua** | API nội bộ |
| Analytics bên thứ ba | `xmlhttprequest` | `origin, ua` | nhiễu |

**Phát hiện — và cái bẫy đọc nhầm.** Host duy nhất có cookie là host của **chính
trang**: đó là XHR **same-origin**, và trình duyệt luôn kèm cookie cho same-origin.
**Nó không phải request tải media.** Mọi host thực sự phục vụ byte đều không nhận
cookie.

**Kết luận B14: cookie không cần cho việc tải.** Cookie mà Plugin C thu nhiều khả
năng cần cho lời gọi API lộ ra URL stream — mà extension **không phải gọi lại**:
trang đã gọi rồi, extension chỉ quan sát kết quả. Nó thừa hưởng phiên đã xác thực
thay vì phát lại.

---

## Tổng hợp quyết định và tradeoff

| Quyết định | Được | Mất |
|---|---|---|
| Đếm request, flush theo lô 20 | Số 0 đọc được | Sai số tối đa 19 khi SW bị thu hồi |
| Đếm ở `storage.session` | Ghi rẻ, không chạm đĩa | Mất khi đóng trình duyệt |
| Nhóm theo `d.initiator` | Trả lời thẳng "mấy trong 3" | Hiện tên miền iframe, không phải tab |
| Giới hạn 2 mẫu mỗi host+type | Storage bị chặn trần | Không thấy toàn cảnh mọi segment |
| `image` trong bộ lọc byte | Bắt được segment ngụy trang PNG | Thumbnail thành nhiễu |
| Nhận diện theo `d.type` | Không phụ thuộc quy ước URL của site | Phụ thuộc cách Chrome phân loại |
| `host_permissions: <all_urls>` | Đo được site bất kỳ | Quyền rộng nhất Chrome có — **chỉ chấp nhận cho probe local** |
| Chỉ quan sát, không tải | Không rủi ro, không cần backend | Không xác nhận được máy chủ *bắt buộc* gì |

## Probe này không trả lời được gì

- **Máy chủ bắt buộc header nào.** Probe đo thứ trình duyệt *gửi*, không đo thứ
  máy chủ *đòi*. URL ký có hạn, hoặc kiểm `Referer` chỉ với request lạ, đều không
  lộ ra ở đây. Phép thử thật nằm ở B1: gửi `VideoInfo` không cookie xuống `yt-dlp`.
- **Segment có tải được ngoài trình duyệt không.** Chưa thử tải một byte nào.
- **Độ bền theo thời gian.** Đo một lần, một ngày. Site đổi cấu trúc là phải đo lại.
- **Hành vi khi chưa đăng nhập / chưa qua Cloudflare.** Mọi lần đo đều trong session
  đã sẵn sàng của người dùng — mà đó đúng là điều kiện Phương án 2 giả định.

## Trạng thái

Giai đoạn 0 **hoàn tất**. ADR 0005 và 0006 chuyển sang `Accepted`. B14 đóng.
Việc kế tiếp: Giai đoạn 1 (B2/B3/B4) — vòng đời process và menu bar.
