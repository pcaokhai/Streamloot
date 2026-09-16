# ADR 0002: Database Selection for History and State Management

## Status
Approved (2026-08-22)

## Context
App cần lưu lại Lịch sử tải xuống (History) và Trạng thái hiện tại của các task (Status: Pending, Downloading, Completed, Failed) để Backend API và Desktop App có thể truy xuất. Database cần chạy ổn định cả trên Docker (API mode) và Standalone local (Desktop / CLI mode).

## Options Considered

### Option 1: SQLite + SQLAlchemy (hoặc SQLModel)
Sử dụng SQLite làm file storage cục bộ (e.g. `db/downloader.sqlite`), kết hợp ORM.

* **Pros:**
  * File-based, zero configuration, không cần setup server rời (như MySQL/Postgres), rất lý tưởng cho ứng dụng Desktop hoặc local Docker.
  * Hỗ trợ Transaction, kiểu dữ liệu chặt chẽ (Schema validation).
  * Dễ dàng query phức tạp (phân trang, search lịch sử theo ngày tháng).
  * Tích hợp cực tốt với FastAPI (qua SQLAlchemy/SQLModel).
* **Cons:**
  * Có thể bị lock (database is locked) nếu ghi đồng thời từ quá nhiều thread/process, tuy nhiên với mô hình này (chỉ có một service xử lý download) thì rủi ro rất thấp.

### Option 2: NoSQL File-based (TinyDB / JSON file)
Lưu data dưới dạng một file JSON lớn hoặc dùng thư viện TinyDB.

* **Pros:**
  * Setup siêu nhanh, không cần khai báo schema phức tạp.
  * Đọc ghi file JSON là đủ cho các nhu cầu đơn giản.
* **Cons:**
  * Không phù hợp để update trạng thái (progress) liên tục, vì mỗi lần cập nhật progress là phải ghi lại toàn bộ file hoặc khóa file.
  * Hiệu năng cực kì thấp khi file lịch sử lớn lên.
  * Thiếu index và query phức tạp.

### Option 3: Redis
Sử dụng Redis để lưu state realtime và history.

* **Pros:**
  * Tốc độ cực cao, hoàn hảo cho việc lưu progress realtime.
* **Cons:**
  * Yêu cầu cài đặt thêm Redis server. Không khả thi để đóng gói vào một ứng dụng macOS Standalone cho end-user. Quá phức tạp và cồng kềnh cho quy mô project này.

## Recommendation
Đề xuất **Option 1 (SQLite + SQLAlchemy)**. 
SQLite là tiêu chuẩn vàng cho các ứng dụng cục bộ. Nó đủ nhẹ để nhúng vào Desktop App, và đủ mạnh mẽ, có cấu trúc để làm database cho FastAPI Backend. Kết hợp SQLAlchemy sẽ giúp code an toàn và dễ bảo trì. Để xử lý cập nhật progress liên tục mà không bị lock database quá mức, ta có thể kết hợp việc đẩy progress event ra Websocket và chỉ thỉnh thoảng (hoặc khi hoàn tất) mới ghi vào SQLite.
