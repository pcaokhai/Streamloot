"""
Quyết định NỘI DUNG menu bar, tách khỏi phần dựng NSMenu.

Tách ra để test được mà không cần AppKit và không cần chạy vòng lặp giao diện —
`statusbar.py` lo phần Objective-C, file này lo phần logic.
"""
MAX_LABEL = 44


def build_menu_model(active_tasks: list) -> dict:
    """
    Dựng mô tả menu từ danh sách task đang chạy.

    Chỉ hiện MỘT task — task khởi động gần nhất, tức phần tử đầu của
    `get_active_tasks()` (đã sắp xếp mới nhất trước). Menu bar để liếc, danh sách
    đầy đủ nằm ở cửa sổ app.

    Returns:
        {"download": None} khi không có gì chạy, hoặc
        {"download": {"task_id", "label", "action"}} với action là 'pause'|'resume'.
    """
    if not active_tasks:
        return {"download": None}

    task = active_tasks[0]
    title = (task.get("title") or "Đang chuẩn bị…").strip()
    if len(title) > MAX_LABEL:
        title = title[: MAX_LABEL - 1] + "…"

    if task.get("status") == "paused":
        label = f"{title} — Tạm dừng"
        action = "resume"
    else:
        progress = task.get("progress")
        pct = f"{int(progress)}%" if isinstance(progress, (int, float)) else "…"
        label = f"{title} — {pct}"
        action = "pause"

    return {"download": {"task_id": task["task_id"], "label": label, "action": action}}
