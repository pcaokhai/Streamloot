# ADR 0001: Desktop App Framework Selection

## Status
Approved (2026-08-22)

## Context
Dự án cần phát triển một giao diện Desktop Standalone App cho macOS (và có thể mở rộng ra Windows/Linux sau này). Chúng ta cần chọn framework phù hợp nhất để xây dựng UI cho Python application này, có khả năng đóng gói (packaging) dễ dàng mà không yêu cầu user cài đặt Python.

## Options Considered

### Option 1: PyQt6 / PySide6 (Native GUI)
Sử dụng bộ công cụ Qt thông qua Python bindings.

* **Pros:**
  * Performance rất cao, Native look-and-feel trên macOS/Windows.
  * Hệ sinh thái cực kỳ mạnh mẽ, rất nhiều widget có sẵn.
  * Tích hợp tốt với tiến trình đa luồng (QThread) rất phù hợp cho ứng dụng tải xuống.
* **Cons:**
  * Dung lượng sau khi build (packaging bằng PyInstaller) rất nặng (có thể >100MB).
  * Khó tùy biến giao diện hiện đại (ví dụ: animations mượt, bo góc kiểu web, gradient phức tạp) so với CSS.
  * Cần học Qt Designer và hiểu về Signal/Slot.

### Option 2: PyWebView + Web Frontend (HTML/JS/Tailwind)
Sử dụng PyWebView để tạo ra một cửa sổ Native Browser nhẹ, bên trong hiển thị giao diện web (React/Vue hoặc Vanilla JS + Tailwind) gọi về Python Backend (qua REST hoặc JS API).

* **Pros:**
  * Tái sử dụng được kiến thức Web (HTML, CSS, JS). Rất dễ để thiết kế một UI hiện đại, đẹp mắt.
  * Có thể tái sử dụng gần như toàn bộ layout/code UI cho bản Chrome Extension sau này.
  * Dung lượng build nhẹ hơn Qt vì nó dùng thẳng engine WebKit/Edge có sẵn trên hệ điều hành.
* **Cons:**
  * Phải duy trì thêm một lớp Web Frontend (NodeJS toolchain nếu dùng framework).
  * Giao tiếp giữa JS và Python tốn thêm một chút overhead (tuy không đáng kể với app tải file).

### Option 3: Tkinter / CustomTkinter
Thư viện mặc định đi kèm với Python.

* **Pros:**
  * Có sẵn, không cần cài đặt thêm.
  * Dung lượng siêu nhẹ.
* **Cons:**
  * Giao diện rất cũ và khó custom để đạt chuẩn "đẹp hiện đại".
  * Thiếu các widget cao cấp.

## Recommendation
Đề xuất **Option 2 (PyWebView + Web Frontend)**. 
Vì dự án có kế hoạch làm Chrome Extension, việc dùng Web UI cho Desktop app sẽ giúp tái sử dụng tối đa code giao diện (Share components). Hơn nữa, Web UI mang lại trải nghiệm thị giác tốt hơn và dễ bảo trì hơn đối với đa số lập trình viên hiện nay.
