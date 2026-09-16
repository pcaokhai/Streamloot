# ADR 0004: API Security Measures

## Status
Approved (2026-08-22)

## Context
Khi ứng dụng chạy trong chế độ API Mode (thông qua Docker hoặc trực tiếp trên máy host) để phục vụ Chrome Extension, một port cục bộ (ví dụ `8000`) sẽ được mở. Mặc dù chỉ chạy ở môi trường Local, việc mở port HTTP này vẫn tạo ra nguy cơ bảo mật, cụ thể là tấn công CSRF (Cross-Site Request Forgery). Bất kỳ trang web độc hại nào người dùng truy cập bằng trình duyệt cũng có thể thực thi mã JavaScript ngầm gọi tới `localhost:8000` để bắt ứng dụng tải file độc hại hoặc lạm dụng tài nguyên mạng.

## Decision
Để ngăn chặn hoàn toàn rủi ro này, kiến trúc bảo mật của FastAPI Backend sẽ áp dụng ba lớp bảo vệ bắt buộc:

1. **Localhost Binding Only:**
   Backend server sẽ chỉ listen (ràng buộc) trên địa chỉ IP cục bộ `127.0.0.1` (hoặc cấu hình tương đương trong Docker để không expose port ra mạng lưới public/LAN). Điều này ngăn chặn các thiết bị khác trong cùng mạng Wi-Fi gửi yêu cầu đến server.

2. **CORS Restrictions (Cross-Origin Resource Sharing):**
   Cấu hình middleware CORS của FastAPI chỉ cho phép các origins hợp lệ. Cụ thể:
   - Origin của Chrome Extension nội bộ: `chrome-extension://<EXTENSION_ID>`
   - Bất kỳ URL Web UI nội bộ nào được sử dụng bởi Desktop App.
   - Các requests từ trình duyệt web thông thường (từ các domain ngẫu nhiên) sẽ bị trình duyệt block ở mức độ Preflight (OPTIONS request).

3. **API Key Authentication (Token-based Auth):**
   Bởi vì CORS không chặn được việc gọi API từ các công cụ ngoài trình duyệt (như cURL, Postman) và một số cấu hình mạng đặc thù, một lớp xác thực Token tĩnh sẽ được sử dụng.
   - Ứng dụng sẽ sinh ra (hoặc được cấu hình) một `API_KEY` bí mật lưu trong file `.env`.
   - Mọi request thay đổi trạng thái (như `POST /api/v1/downloads`) đều phải đính kèm header `Authorization: Bearer <API_KEY>`.
   - Bất kỳ request nào thiếu token hoặc token sai đều bị reject với status `401 Unauthorized`.

## Consequences
* **Positive:** Chặn hoàn toàn nguy cơ CSRF và lạm dụng API trái phép từ bên ngoài.
* **Negative:** Chrome Extension cần được thiết kế để đọc cấu hình API Key một cách an toàn (có thể qua options page) và đính kèm vào mỗi request. Việc setup lúc đầu sẽ cần copy-paste API key giữa app và extension nếu chưa tự động hóa.
