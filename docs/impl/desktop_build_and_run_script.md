# Desktop Build and Run Script

Tài liệu mô tả script `./run_desktop.sh` được dùng để tự động hóa quy trình build giao diện React/Vite/Tailwind và khởi chạy ứng dụng Desktop App (`pywebview`).

## 1. Mục đích
Giao diện Desktop hiện tại nằm ở `apps/desktop/ui/` được xây dựng bằng **React + TypeScript + Vite + Tailwind CSS**. `apps/desktop/main.py` yêu cầu file build hoàn chỉnh tại `apps/desktop/ui/dist/index.html` để phục vụ qua server nội bộ của `pywebview`.

Script `./run_desktop.sh` giúp đơn giản hóa quy trình:
1. Kiểm tra môi trường (`npm`, `uv`).
2. Kiểm tra và tự động chạy `npm install` nếu chưa có `node_modules`.
3. Tự động chạy `npm run build` nếu thư mục `dist/` chưa tồn tại hoặc khi người dùng yêu cầu build lại.
4. Khởi chạy ứng dụng Desktop qua `uv run apps/desktop/main.py`.

## 2. Cách sử dụng

```bash
# 1. Tự động kiểm tra build (nếu chưa có dist/ thì build) và chạy Desktop App:
./run_desktop.sh

# 2. Ép buộc build lại UI (rebuild) rồi chạy:
./run_desktop.sh --build
# hoặc:
./run_desktop.sh -b

# 3. Chỉ build UI mà không khởi chạy app (dùng cho CI hoặc test build):
./run_desktop.sh --build-only

# 4. Xóa sạch cache, node_modules, dist và cài đặt + build lại từ đầu:
./run_desktop.sh --clean
# hoặc:
./run_desktop.sh -c
```

## 3. Chi tiết các bước thực thi trong Script
1. **Kiểm tra công cụ:** Xác thực lệnh `npm` và `uv` có sẵn trong `PATH`.
2. **Quản lý dependencies:** Nếu thư mục `apps/desktop/ui/node_modules/` chưa có, tự động thực hiện `npm install`.
3. **Build Frontend:** Thực thi `npm run build` trong `apps/desktop/ui/` để sinh ra bundle tối ưu tại `apps/desktop/ui/dist/`.
4. **Chạy Backend & Webview:** Dùng `exec uv run apps/desktop/main.py` từ thư mục gốc của project để giữ luồng tiến trình và tín hiệu dừng (`Ctrl + C`).
