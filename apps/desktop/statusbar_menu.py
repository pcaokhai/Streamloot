"""
Quyết định NỘI DUNG menu bar, tách khỏi phần dựng NSMenu.

Tách ra để test được mà không cần AppKit và không cần chạy vòng lặp giao diện —
`statusbar.py` lo phần Objective-C, file này lo phần logic.
"""
from typing import Optional

MAX_LABEL = 44


def build_menu_model(active_tasks: list) -> dict:
    """
    Dựng mô tả menu từ danh sách task đang chạy.

    Chỉ hiện MỘT task — task khởi động gần nhất, tức phần tử đầu của
    `get_active_tasks()` (đã sắp xếp mới nhất trước). Menu bar để liếc, danh sách
    đầy đủ nằm ở cửa sổ app.

    Returns:
        {"download": None} khi không có gì chạy, hoặc
        {"download": {"task_id", "label", "action", "enabled"}} với action là
        'pause'|'resume'. `enabled=False` khi hành động chưa thể thực hiện.
    """
    if not active_tasks:
        return {"download": None}

    task = active_tasks[0]
    title = (task.get("title") or "Đang chuẩn bị…").strip()
    if len(title) > MAX_LABEL:
        title = title[: MAX_LABEL - 1] + "…"

    status = task.get("status")
    if status == "paused":
        label = f"{title} — Tạm dừng"
        action = "resume"
    else:
        progress = task.get("progress")
        pct = f"{int(progress)}%" if isinstance(progress, (int, float)) else "…"
        label = f"{title} — {pct}"
        action = "pause"

    # 'pending' = chưa có tiến trình con nào để tạm dừng; endpoint sẽ trả 409 và
    # từ chỗ người dùng ngồi thì cú bấm biến mất không dấu vết. Thà hiện mục mờ
    # đi: hành động bất khả thi thì đừng mời bấm.
    return {
        "download": {
            "task_id": task["task_id"],
            "label": label,
            "action": action,
            "enabled": status != "pending",
        }
    }


#: Bước làm tròn phần trăm cho vòng tiến trình trên menu bar.
#:
#: Giống hệt lý do bên extension: vẽ lại icon là việc tốn kém, và mắt không
#: phân biệt nổi 37% với 39% trên một hình 18pt. Làm tròn xuống bội số 5 thì một
#: lượt tải tốn tối đa 20 lần vẽ bất kể poll bao nhiêu lần.
RING_STEP = 5


def ring_state(active_tasks: list) -> Optional[dict]:
    """
    Trạng thái vòng tiến trình cho icon menu bar, hoặc None khi không có gì tải.

    Bám **task khởi động gần nhất**, tức phần tử đầu của `get_active_tasks()`
    (đã sắp xếp mới nhất trước) — cùng quy tắc với `build_menu_model` và với
    vòng trên icon extension. Cố ý KHÔNG lấy trung bình mọi task: thêm một
    download mới sẽ kéo tổng phần trăm tụt xuống và vòng chạy ngược.

    Returns:
        None khi rảnh, hoặc {"pct": int (bội số 5, 0..100), "paused": bool}.
    """
    if not active_tasks:
        return None

    task = active_tasks[0]
    progress = task.get("progress")
    if not isinstance(progress, (int, float)) or progress != progress:  # loại NaN
        pct = 0
    else:
        pct = int(max(0.0, min(100.0, float(progress))) // RING_STEP * RING_STEP)

    return {"pct": pct, "paused": task.get("status") == "paused"}


def refresh_off_main(window, script: str, logger=None) -> "threading.Thread":
    """
    Gửi JS vào cửa sổ từ một thread NỀN, không bao giờ từ main thread.

    `evaluate_js` của pywebview (platforms/cocoa.py) làm hai việc: xếp hàng
    việc chạy JS lên main run loop bằng `AppHelper.callAfter`, rồi ĐỨNG ĐỢI
    semaphore kết quả. Gọi nó từ một action selector của menu bar (đang chạy
    trên chính main thread) là tự khoá: block JS xếp hàng phía sau không bao
    giờ tới lượt vì main thread đang bận đợi nó. Spindump 2026-09-18 20:21
    ghi nhận main thread kẹt 214s ở `lock_PyThread_acquire_lock` đúng chỗ này.

    Trả về thread để test kiểm được nó chạy ở đâu; caller bình thường bỏ qua.
    """
    import threading as _t

    def run():
        try:
            window.evaluate_js(script)
        except Exception as e:  # webview chưa sẵn sàng, trang đang điều hướng
            if logger is not None:
                logger(f"Không gửi được JS vào cửa sổ: {e}")

    th = _t.Thread(target=run, daemon=True, name="streamloot-page-refresh")
    th.start()
    return th
