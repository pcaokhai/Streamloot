"""
Icon menu bar (NSStatusItem) cho Desktop app — ADR 0005 §5, B3.

Vì sao tự viết: pywebview 6.2.1 **không có** NSStatusItem. `webview.menu` chỉ
dựng menu ứng dụng (File/Edit/View khi app focus), không phải icon góc phải menu
bar. Kiểm chứng: `grep -r "NSStatusItem\\|NSStatusBar"` trên package trả 0 kết quả.

Không thêm dependency: pywebview trên macOS đã kéo sẵn pyobjc/AppKit, và
`NSApplication.sharedApplication()` là singleton nên ta lấy đúng instance mà
pywebview đang chạy.

Không dùng `rumps` — nó chạy NSApplication run loop riêng, xung đột với pywebview.
"""
from typing import Callable, Optional

import AppKit
import Foundation
import objc

from utils.logger import Logger

# NSApplicationActivationPolicy
_REGULAR = 0    # có icon Dock, app bình thường
_ACCESSORY = 1  # không icon Dock, chỉ sống ở menu bar

# Giữ tham chiếu ở cấp module: NSStatusItem và target bị thu gom rác thì icon
# biến mất khỏi menu bar mà không có lỗi nào.
_keepalive: list = []


class _Target(AppKit.NSObject):
    """
    Bộ nhận action của menu. Objective-C cần một NSObject thật để gửi selector;
    hàm Python thuần không gắn vào `setAction_` được.

    `objc.super(...)` là bắt buộc — gọi `AppKit.NSObject.init(self)` sẽ ném
    "Need 0 arguments, got 1" vì selector `init` không nhận tham số nào.
    """

    def initWithHandlers_(self, handlers):
        self = objc.super(_Target, self).init()
        if self is None:
            return None
        self._handlers = handlers
        return self

    def onShow_(self, sender):
        self._handlers['show']()

    def onQuit_(self, sender):
        self._handlers['quit']()

    def onToggle_(self, sender):
        self._handlers['task']['toggle'](sender.representedObject())

    def onCancel_(self, sender):
        self._handlers['task']['cancel'](sender.representedObject())


class _MenuDelegate(AppKit.NSObject):
    """
    macOS gọi menuNeedsUpdate_ NGAY TRƯỚC khi hiện menu, nên menu bar lấy dữ
    liệu tươi mà không cần poll gì cả — khác hẳn panel và popup của extension.

    Menu cũ được dựng một lần lúc cài nên nội dung đóng băng vĩnh viễn.
    """

    def initWithBuilder_(self, builder):
        self = objc.super(_MenuDelegate, self).init()
        if self is None:
            return None
        self._builder = builder
        return self

    def menuNeedsUpdate_(self, menu):
        self._builder(menu)


def set_dock_icon(visible: bool) -> None:
    """
    Bật/tắt icon Dock lúc chạy.

    `platforms/cocoa.py:59` hardcode `setActivationPolicy_(0)` ngay lúc import
    module, nên muốn đổi thì phải gọi SAU khi GUI loop đã khởi động.
    """
    AppKit.NSApplication.sharedApplication().setActivationPolicy_(
        _REGULAR if visible else _ACCESSORY
    )


def activate() -> None:
    """Đưa app lên trước — cần sau khi hiện lại cửa sổ đã ẩn."""
    AppKit.NSApplication.sharedApplication().activateIgnoringOtherApps_(True)


def install(
    on_show: Callable[[], None],
    on_quit: Callable[[], None],
    port: int,
    task_actions: dict,
    title: str = "⤓",
) -> None:
    """
    Gắn icon vào menu bar.

    Phải gọi trong `webview.start(func=...)` — tức sau khi NSApplication đã chạy,
    vì `platforms/cocoa.py` cố định activation policy ngay lúc import.

    **Nhưng `webview.start(func=...)` chạy func trên thread nền**, mà AppKit bắt
    buộc dựng UI trên main thread; gọi thẳng ở đây sẽ ném
    `NSInternalInconsistencyException: NSWindow should only be instantiated on
    the main thread`. Nên việc dựng được đẩy về main queue.

    Không ném tiếp khi lỗi: menu bar là tiện ích, app vẫn tải được video mà không
    có nó — nhưng phải ghi log, vì hỏng im lặng nghĩa là người dùng không có cách
    nào thoát app hay biết backend đang chạy.
    """
    Foundation.NSOperationQueue.mainQueue().addOperationWithBlock_(
        lambda: _build(on_show, on_quit, port, title, task_actions)
    )


def _build(on_show, on_quit, port, title, task_actions):
    """Dựng NSStatusItem. LUÔN chạy trên main thread (xem install)."""
    try:
        bar = AppKit.NSStatusBar.systemStatusBar()
        item = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)

        button = item.button()
        if button is not None:
            button.setTitle_(title)
            button.setToolTip_("Streamloot — backend đang chạy")

        target = _Target.alloc().initWithHandlers_({
            'show': on_show,
            'quit': on_quit,
            'task': task_actions,
        })
        menu = AppKit.NSMenu.alloc().init()
        # Bắt buộc: mặc định NSMenu tự bật lại mọi item có target+action hợp lệ,
        # ghi đè setEnabled_ của ta — mục "Tạm dừng" của task 'pending' sẽ lại
        # bấm được. Tắt đi thì setEnabled_ mới là tiếng nói cuối cùng.
        menu.setAutoenablesItems_(False)

        def rebuild(m):
            _rebuild_safe(m, target, port, task_actions)

        delegate = _MenuDelegate.alloc().initWithBuilder_(rebuild)
        menu.setDelegate_(delegate)
        rebuild(menu)

        item.setMenu_(menu)
        _keepalive.extend([item, target, menu, delegate])
        Logger.get_logger().debug("Menu bar item installed")
    except Exception as e:
        Logger.error(f"Không dựng được menu bar item: {e}", exc_info=True)


def _rebuild_safe(menu, target, port, task_actions):
    """
    Dựng lại menu, được gọi từ `_MenuDelegate.menuNeedsUpdate_` mỗi lần menu
    sắp mở — ngoài phạm vi try/except một lần lúc cài trong `_build`. Không để
    lộ exception ra ngoài callback ObjC: menu vỡ trong im lặng là đúng loại bug
    đắt nhất của app này — log rồi để menu ở trạng thái dở dang, còn hơn ném ra
    ngoài mất luôn dấu vết.
    """
    try:
        menu.removeAllItems()
        _populate(menu, target, port, task_actions['list']())
    except Exception as e:
        Logger.error(f"Không dựng lại được menu bar: {e}", exc_info=True)


def _populate(menu, target, port, active_tasks):
    from apps.desktop.statusbar_menu import build_menu_model

    model = build_menu_model(active_tasks)
    dl = model["download"]

    if dl is not None:
        info = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            dl["label"], "", ""
        )
        info.setEnabled_(False)
        menu.addItem_(info)

        label = "Tiếp tục" if dl["action"] == "resume" else "Tạm dừng"
        toggle = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            label, "onToggle:", ""
        )
        toggle.setTarget_(target)
        toggle.setRepresentedObject_(dl["task_id"])
        toggle.setEnabled_(dl.get("enabled", True))
        menu.addItem_(toggle)

        cancel = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Huỷ", "onCancel:", ""
        )
        cancel.setTarget_(target)
        cancel.setRepresentedObject_(dl["task_id"])
        menu.addItem_(cancel)

        menu.addItem_(AppKit.NSMenuItem.separatorItem())

    show = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        "Mở cửa sổ Streamloot", "onShow:", ""
    )
    show.setTarget_(target)
    menu.addItem_(show)
    menu.addItem_(AppKit.NSMenuItem.separatorItem())

    status = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        f"Backend: 127.0.0.1:{port}", "", ""
    )
    status.setEnabled_(False)
    menu.addItem_(status)
    menu.addItem_(AppKit.NSMenuItem.separatorItem())

    quit_item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        "Thoát Streamloot", "onQuit:", "q"
    )
    quit_item.setTarget_(target)
    menu.addItem_(quit_item)
