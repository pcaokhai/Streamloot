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
        lambda: _build(on_show, on_quit, port, title)
    )


def _build(
    on_show: Callable[[], None],
    on_quit: Callable[[], None],
    port: int,
    title: str,
) -> None:
    """Dựng NSStatusItem. LUÔN chạy trên main thread (xem install)."""
    try:
        bar = AppKit.NSStatusBar.systemStatusBar()
        item = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)

        button = item.button()
        if button is not None:
            button.setTitle_(title)
            button.setToolTip_("Streamloot — backend đang chạy")

        target = _Target.alloc().initWithHandlers_({'show': on_show, 'quit': on_quit})

        menu = AppKit.NSMenu.alloc().init()

        show_item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Mở cửa sổ Streamloot", "onShow:", ""
        )
        show_item.setTarget_(target)
        menu.addItem_(show_item)

        menu.addItem_(AppKit.NSMenuItem.separatorItem())

        # Mục trạng thái: người dùng phải thấy được backend đang chạy ở cổng nào,
        # nếu không thì extension báo "không kết nối được" mà không ai hiểu vì sao.
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

        item.setMenu_(menu)

        _keepalive.extend([item, target, menu])
        Logger.get_logger().debug("Menu bar item installed")
    except Exception as e:
        Logger.error(f"Không dựng được menu bar item: {e}", exc_info=True)
