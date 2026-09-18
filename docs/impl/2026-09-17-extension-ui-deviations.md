# Extension UI — deviations from plan (ruled out by controller, 2026-09-17)

Written vì `CLAUDE.md` coi `docs/` là nguồn sự thật, và bảng coverage của plan hiện đang nhận vơ các mục dưới đây là "đã làm". Không đúng — ghi lại để không ai tin nhầm.

## 1. §4.1 / D1 local cache (storage.session / storage.local) — chưa làm

- **Spec yêu cầu**: task đang chạy cache vào `storage.session`, 20 dòng lịch sử gần nhất cache vào `storage.local`, để popup mở lên có ngay dữ liệu cũ trong lúc chờ round-trip.
- **Đã làm**: `lastKnownTasks` trong `background.ts` chỉ là biến in-memory phục vụ vẽ icon, không phải cache cho popup đọc. Popup gọi thẳng backend mỗi lần mở, không có gì để hiện nếu request chậm hoặc lỗi — hiện thông báo lỗi thay vì danh sách cũ.
- **Vì sao gác lại**: đây là cải thiện độ trễ cảm nhận (perceived latency), không phải đúng/sai chức năng. Nhánh này đã dài, làm thêm cache có state đồng bộ hai chiều là việc riêng.

## 2. §5.3 "vòng chạy tới 100% rồi mới ẩn" — ĐÃ LÀM

Không còn là sai lệch. Xem phần thân bài: vòng chạy nốt tới 100% rồi ẩn, và chỉ
khi trạng thái cuối đúng là `completed`.

## 3. §5.2 "Hiện trong Finder" — không phải thiếu, là giới hạn nền tảng

- **Spec yêu cầu**: nút mở file đã tải trong Finder từ dòng lịch sử.
- **Thực tế**: extension Chrome MV3 không có API mở file manager của hệ điều hành. Đây không phải việc gác lại để làm sau — nó không làm được từ bề mặt extension.
- **Ai làm được**: app desktop (đã có quyền filesystem qua pywebview) là bề mặt đúng cho tính năng này.

## 4. Popup poll 1s bất kể có task hay không — chấp nhận, không copy sang nơi khác

- **Đã làm**: `popup/main.ts` chạy `setInterval(renderTasks, 1000)` vô điều kiện suốt vòng đời popup, không theo quy tắc dừng-khi-hết-task mà service worker tuân theo (`nextPollMs`).
- **Vì sao chấp nhận**: popup chỉ sống vài giây mỗi lần mở, phí tổn không đáng kể. Ghi lại ở đây để không ai copy pattern này vào service worker hay panel — nơi có vòng đời dài, chỗ đó BẮT BUỘC theo `nextPollMs`.

## 5. Badge chỉ đếm download, không đếm stream bắt được

**Spec §5.3** cho badge hiện số stream bắt được (nền xám) khi không có download
nào chạy.

**Đã làm:** badge chỉ hiện số download đang chạy, và để trống khi không có gì
tải. Số stream bắt được vẫn có trong popup.

**Vì sao:** người dùng yêu cầu đổi sau khi dùng thật. Lý do đứng vững: gần như
mọi trang có video đều bắt được stream, nên badge sáng gần như liên tục và nhìn
vào không còn biết có đang tải hay không — đúng thông tin mà badge sinh ra để
mang. Trong popup thì con số đó có chỗ để giải thích nó là gì.

Kéo theo: `badgeFor` không còn khái niệm phạm vi theo tab (badge download là
toàn cục), nên nó trả `{text, color}` thay vì `{text, color, perTab}`.

## 6. Màu tiến trình là cam, không phải xanh

**Spec** dùng xanh `#2563eb` cho mọi thứ, gồm cả vòng tiến trình và badge.

**Đã làm:** cam cho tất cả những gì biểu thị TIẾN TRÌNH (vòng quanh icon, thanh
trong popup, thanh trong panel). Xanh giữ lại cho hành động và thương hiệu (nút
Tải, tab đang chọn, nút trong Cài đặt).

**Vì sao:** người dùng báo vòng xanh chìm — nền icon cũng xanh nên vòng khó tách
khỏi glyph. Cam nằm đối diện xanh trên vòng màu nên tách bạch ngay.

**Hai sắc cam khác nhau, có chủ đích:**

| Chỗ dùng | Mã | Tương phản |
|---|---|---|
| Vòng + thanh tiến trình | `#f97316` (cam-500) | 5.74:1 trên thanh công cụ tối |
| Nền badge | `#c2410c` (cam-700) | 5.18:1 với chữ trắng đè lên |

Badge có chữ trắng nên cần đậm hơn nhiều: đo thật thì cam-500 với chữ trắng chỉ
đạt 2.80:1 (đọc không nổi), cam-600 được 3.56:1, cam-700 đạt 5.18:1 — ngang mức
xanh cũ (5.17:1). Đừng gộp hai hằng số này làm một.

Điểm yếu đã biết: cam-500 trên thanh công cụ SÁNG chỉ đạt 2.14:1. Chấp nhận vì
đây là đồ hoạ đặc chứ không phải chữ, và đường ray mờ bên dưới đã vạch sẵn hình
tròn nên mắt vẫn bám được viền.

## 7. CHƯA KIỂM THỰC TẾ: đường yt-dlp theo URL trang

Các commit `d14e200` và `63d202a` mở đường hỏi `yt-dlp` bằng URL trang cho mọi
site không có plugin riêng. Đã kiểm bằng máy: `tsc`, build, test backend
(endpoint `/extractor` trả đúng một boolean).

**Chưa kiểm bằng trình duyệt thật** — cần người dùng xác nhận:

- YouTube, ganjing.com, xvideos: panel có hiện và ra danh sách chất lượng không.
- Độ trễ `yt-dlp` trên từng site. Chưa đo. Nếu có site chậm thì panel đang chờ
  vô hạn — cần thêm hạn giờ và thông báo rõ.
- Site có plugin riêng: hành vi phải KHÔNG đổi (vẫn đi đường manifest).
- Bộ nhớ đệm: mở lại cùng trang không được gọi `yt-dlp` lần hai.
