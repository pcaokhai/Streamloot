# ADR 0003: API Real-time Communication

## Status
Approved (2026-08-22)

## Context
Trong Backend API mode (sử dụng bởi Chrome Extension) và Desktop mode (nếu sử dụng kiến trúc Web UI qua PyWebView), Frontend cần cập nhật liên tục tiến trình tải file (Downloading Progress). Việc truyền tải trạng thái này từ Python Backend sang JS Frontend cần một cơ chế hiệu quả, tránh làm nghẽn mạng hay gây áp lực lên Database.

## Options Considered

### Option 1: Client Polling (REST API GET liên tục)
Frontend tạo 1 interval gọi `GET /api/v1/downloads/{task_id}` mỗi giây để lấy trạng thái mới nhất.

* **Pros:**
  * Dễ triển khai nhất, code Backend REST API thuần túy, không quản lý kết nối.
  * Stateless, dễ scale (dù scale không phải vấn đề chính yếu của app này).
* **Cons:**
  * Lãng phí tài nguyên mạng, nhiều request thừa (khi progress chưa cập nhật).
  * Delay, không có cảm giác "real-time" mượt mà cho UI.

### Option 2: WebSockets
Thiết lập 1 kênh kết nối TCP 2 chiều mở liên tục giữa Extension và Backend. Backend đẩy event progress bất cứ khi nào có thay đổi.

* **Pros:**
  * Hoàn toàn realtime (độ trễ thấp nhất).
  * Hỗ trợ liên lạc 2 chiều (Frontend có thể gửi command Pause/Cancel qua luôn kênh này).
* **Cons:**
  * Triển khai phức tạp hơn REST. Cần quản lý state của kết nối (reconnect, heartbeat).
  * Nếu dùng PyWebView, thỉnh thoảng có vài cấu hình mạng nội bộ cản trở WS, tuy nhiên chạy local thì ít gặp.

### Option 3: Server-Sent Events (SSE)
Backend giữ một kết nối HTTP một chiều mở và liên tục "stream" các sự kiện tiến trình về Frontend (Sử dụng `StreamingResponse` trong FastAPI hoặc `EventSource` bên JS).

* **Pros:**
  * Dễ triển khai hơn WebSockets rất nhiều (vì vẫn dùng HTTP standard).
  * Build-in auto-reconnection ở phía client JS (`EventSource` tự động kết nối lại nếu rớt mạng).
  * Hoàn toàn realtime một chiều (Rất hoàn hảo cho việc truyền Progress).
* **Cons:**
  * Chỉ truyền 1 chiều (Server -> Client). Nếu Frontend muốn Pause/Cancel, nó phải gọi một REST API truyền thống (VD: `POST /api/v1/downloads/{id}/cancel`). Tuy nhiên đây không hẳn là điểm trừ vì nó giúp tách biệt luồng Data stream và Control flow.

## Recommendation
Đề xuất **Option 3 (Server-Sent Events - SSE)**. 
Đối với bài toán cập nhật Progress Bar, luồng dữ liệu chỉ đi một chiều từ Backend -> Frontend. SSE là giải pháp tối ưu nhất: code nhẹ hơn WebSockets, tận dụng được chuẩn HTTP, tự động reconnect từ phía trình duyệt (Chrome Extension cực kì tương thích với SSE). Các lệnh điều khiển (Pause, Resume, Cancel) vẫn có thể dùng các endpoint REST API thông thường, tạo thành một kiến trúc rành mạch và dễ bảo trì.
