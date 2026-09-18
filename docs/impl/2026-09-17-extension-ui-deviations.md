# Extension UI — deviations from plan (ruled out by controller, 2026-09-17)

Written vì `CLAUDE.md` coi `docs/` là nguồn sự thật, và bảng coverage của plan hiện đang nhận vơ các mục dưới đây là "đã làm". Không đúng — ghi lại để không ai tin nhầm.

## 1. §4.1 / D1 local cache — ĐÃ LÀM

Không còn là sai lệch. Task cache vào `storage.session`, 20 dòng lịch sử gần
nhất vào `storage.local`, popup gieo cache trước rồi mới thay bằng dữ liệu thật.

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

## 8. Nút nổi nằm NGOÀI khung video, panel bám theo nút

Spec §5.1 vẽ nút ở góc trên phải *bên trong* video. Thử tay (2026-09-18) cho
thấy hai vấn đề: nút đè lên hình và lên nút điều khiển của player; còn panel
thì CSS ghim cứng `top:16px; right:16px` nên mở ở đâu cũng nhảy lên góc cửa
sổ, xa chỗ vừa bấm.

Chốt theo mẫu Cốc Cốc (mirror sang phải): nút nằm **ngay trên mép video**,
thẳng hàng góc phải (`buttonPos`: `top = rect.top - size - pad`, kẹp xuống
`pad` khi video sát mép trên). Panel thả **ngay dưới nút**, mép phải thẳng
hàng, kẹp trong khung nhìn (`panelPos` trong `lib/anchor.ts`, có test); được
đặt lại mỗi lần `place()` chạy nên bám theo khi cuộn. Không lật panel lên
trên khi thiếu chỗ — chỉ kẹp để còn lộ 200px, phần dư panel tự cuộn.

## 8. Liệt kê chất lượng đọc thẳng trong extension (declarativeNetRequest)

Spec §4.2 giả định mọi lời gọi mạng đều đi qua backend. Đo thật cho thấy đường
đó chậm: backend phải spawn `yt-dlp -J` (riêng khởi động ~0.38s, chưa kể nó tự
tải master rồi tải thêm một biến thể để dò), nên panel đứng "Đang lấy danh
sách…" vài giây.

Đọc kiến trúc của một extension tải video phổ biến (bản dựng để trong `ref/`,
đã gitignore — chỉ đọc kiến trúc, không chép mã) cho thấy cách làm: `fetch` bị
cấm đặt `Referer`, nhưng `declarativeNetRequest.updateSessionRules` với
`modifyHeaders` thì đặt được, và gỡ rule ngay sau khi gọi. Nhờ đó service
worker tự tải master m3u8 và phân tích tại chỗ — một request.

Chốt: thêm quyền `declarativeNetRequest`; `lib/m3u8.ts` phân tích master
(thuần, có test), `lib/dnr.ts` cài/gỡ rule quanh đúng một lời gọi. Vẫn GIỮ
đường backend làm dự phòng — thiếu quyền, mạng hỏng, hoặc không phải master
thì lùi về như cũ. `variantsFromManifest` trả `null` (không kết luận được) chứ
không trả `[]`, để hai trạng thái đó không bị gộp.

Hai bài học khác lấy từ cùng nguồn, đã áp dụng:
- **Playlist phụ đề cũng là `.m3u8` hợp lệ.** Chỉ nhìn đuôi là mời người dùng
  tải một tệp `.vtt` và gọi nó là video. `isSubtitlePlaylist` loại nó ra.
- **Phạm vi rule phải là THƯ MỤC chứa playlist** (`new URL('.', url) + '*'`),
  không phải đúng một URL: segment nằm cạnh playlist và cần cùng header.

Chưa áp dụng, ghi lại để cân nhắc: họ dùng `offscreen` (reason `WORKERS`) để
chạy Web Worker vì service worker MV3 không spawn được worker — mình không cần,
việc tải nặng đã nằm ở backend Python.
