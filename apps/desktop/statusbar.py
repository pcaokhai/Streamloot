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
import threading
import time
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

    # Ba selector dưới đây là BIÊN GIỚI Objective-C: exception ném ra khỏi đây
    # không có traceback Python nào, AppKit chỉ im lặng nuốt. Mọi thứ trong này
    # phải tự bọc và tự ghi log, nếu không một cú bấm hỏng là hỏng không dấu vết.
    def onToggle_(self, sender):
        tid = sender.representedObject()
        Logger.get_logger().info(f"Menu bar: bấm toggle cho task {tid}")
        try:
            self._handlers['task']['toggle'](tid)
        except Exception as e:
            Logger.error(f"Menu bar: onToggle_ hỏng với task {tid}: {e}", exc_info=True)

    def onCancel_(self, sender):
        tid = sender.representedObject()
        Logger.get_logger().info(f"Menu bar: bấm huỷ cho task {tid}")
        try:
            self._handlers['task']['cancel'](tid)
        except Exception as e:
            Logger.error(f"Menu bar: onCancel_ hỏng với task {tid}: {e}", exc_info=True)


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


#: Cam khớp vòng trên icon extension — cùng một khái niệm thì cùng một màu.
_RING_ACTIVE = (0.976, 0.451, 0.086)   # #f97316
_RING_PAUSED = (0.631, 0.631, 0.667)   # #a1a1aa
_RING_TRACK = (0.58, 0.64, 0.72, 0.40)

#: Cỡ icon menu bar. 18pt là cỡ chuẩn macOS dùng cho status item.
_ICON_SIZE = 18.0
_RING_W = 2.5


def _ring_image(pct: int, paused: bool):
    """
    Vẽ vòng tiến trình thành NSImage.

    Đường ray vẽ trước rồi mới tới cung, cùng lý do như bên extension: làm tròn
    xuống bội số 5 nên 2% thành 0% và cung dài 0 độ — không có ray thì lúc mới
    bắt đầu trông y hệt lúc rảnh.
    """
    img = AppKit.NSImage.alloc().initWithSize_(Foundation.NSMakeSize(_ICON_SIZE, _ICON_SIZE))
    img.lockFocus()
    try:
        c = _ICON_SIZE / 2
        r = c - _RING_W / 2

        track = AppKit.NSBezierPath.bezierPath()
        track.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_((c, c), r, 0.0, 360.0)
        track.setLineWidth_(_RING_W)
        AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(*_RING_TRACK).set()
        track.stroke()

        # Bắt đầu từ 12 giờ và chạy THEO chiều kim đồng hồ. Trong AppKit góc
        # tính ngược chiều kim đồng hồ từ trục x, nên 12 giờ là 90 độ và phải
        # dùng biến thể clockwise_.
        frac = max(0.04, pct / 100.0)
        arc = AppKit.NSBezierPath.bezierPath()
        arc.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_clockwise_(
            (c, c), r, 90.0, 90.0 - frac * 360.0, True,
        )
        arc.setLineWidth_(_RING_W)
        arc.setLineCapStyle_(AppKit.NSLineCapStyleRound)
        rgb = _RING_PAUSED if paused else _RING_ACTIVE
        AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(*rgb, 1.0).set()
        arc.stroke()

        _draw_arrow(c, rgb)
    finally:
        img.unlockFocus()
    # KHÔNG phải template image: template bị macOS tô lại thành đơn sắc theo
    # giao diện, mất hết màu cam lẫn xám phân biệt tạm-dừng.
    img.setTemplate_(False)
    return img


def _draw_arrow(c: float, rgb) -> None:
    """
    Mũi tên tải xuống nằm giữa vòng, để liếc là biết icon của app nào.

    Toạ độ theo trục Y của AppKit — hướng LÊN, ngược với canvas của trình duyệt.
    Nên "mũi tên chỉ xuống" ở đây là đỉnh có y NHỎ nhất.
    """
    tip_y = c - 3.4        # đỉnh mũi tên, thấp nhất
    barb_y = c - 0.6       # đáy đầu mũi tên
    stem_top = c + 3.2
    half_head = 2.9
    half_stem = 0.95

    p = AppKit.NSBezierPath.bezierPath()
    p.moveToPoint_((c, tip_y))
    p.lineToPoint_((c - half_head, barb_y))
    p.lineToPoint_((c - half_stem, barb_y))
    p.lineToPoint_((c - half_stem, stem_top))
    p.lineToPoint_((c + half_stem, stem_top))
    p.lineToPoint_((c + half_stem, barb_y))
    p.lineToPoint_((c + half_head, barb_y))
    p.closePath()
    AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(*rgb, 1.0).set()
    p.fill()


def _apply_ring(button, state: Optional[dict], idle_title: str) -> None:
    """Đổi icon menu bar. LUÔN gọi trên main thread."""
    try:
        if state is None:
            button.setImage_(None)
            button.setTitle_(idle_title)
        else:
            button.setTitle_("")
            button.setImage_(_ring_image(state["pct"], state["paused"]))
    except Exception as e:
        Logger.error(f"Không vẽ được vòng trên menu bar: {e}", exc_info=True)


def _start_ring_poll(button, list_tasks: Callable, idle_title: str) -> None:
    """
    Cập nhật vòng theo chu kỳ, ở THREAD NỀN.

    Đọc DB nên tuyệt đối không được chạy trên main thread — đó đúng là thứ từng
    làm treo cửa sổ khi menu bar đọc DB ngay trong action selector. Chỉ việc vẽ
    mới đẩy lên main queue.

    Chỉ vẽ lại khi trạng thái ĐÃ LÀM TRÒN đổi, nên một lượt tải tốn tối đa 20
    lần vẽ. Rảnh thì giãn nhịp ra 3s: app desktop sống lâu nên không có cái giá
    "giữ tiến trình sống" như service worker của extension, nhưng cũng không
    việc gì phải hỏi DB mỗi giây khi chẳng có gì chạy.
    """
    def loop():
        # Import trong hàm theo đúng lệ của _populate bên dưới: giữ module này
        # nạp được cả khi phần thuần đổi chỗ.
        from apps.desktop.statusbar_menu import ring_state

        last = ("chưa vẽ lần nào",)
        while True:
            try:
                state = ring_state(list_tasks() or [])
            except Exception as e:
                Logger.error(f"Vòng menu bar: không đọc được danh sách task: {e}", exc_info=True)
                state = None
            key = None if state is None else (state["pct"], state["paused"])
            if key != last:
                last = key
                Foundation.NSOperationQueue.mainQueue().addOperationWithBlock_(
                    lambda s=state: _apply_ring(button, s, idle_title)
                )
            time.sleep(1.0 if state is not None else 3.0)

    threading.Thread(target=loop, daemon=True, name="streamloot-menubar-ring").start()


def _build(on_show, on_quit, port, title, task_actions):
    """Dựng NSStatusItem. LUÔN chạy trên main thread (xem install)."""
    try:
        bar = AppKit.NSStatusBar.systemStatusBar()
        item = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)

        button = item.button()
        if button is not None:
            button.setTitle_(title)
            button.setToolTip_("Streamloot — backend đang chạy")
            # Vòng tiến trình tự cập nhật, không đợi người dùng mở menu.
            list_tasks = task_actions.get('list') if task_actions else None
            if list_tasks:
                _start_ring_poll(button, list_tasks, title)

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
