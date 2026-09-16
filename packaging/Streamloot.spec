# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the macOS .app bundle.

Build via ./build_app.sh — it builds the React UI and vendors yt-dlp/ffmpeg
into packaging/vendor/bin first, both of which this spec expects to exist.
"""
import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

ROOT = Path(SPECPATH).parent
VENDOR_BIN = ROOT / "packaging" / "vendor" / "bin"

# --- data -----------------------------------------------------------------
datas = [
    # The webview loads this at runtime via paths.resource_dir().
    (str(ROOT / "apps" / "desktop" / "ui" / "dist"), "apps/desktop/ui/dist"),
]

# ExtractorFactory enumerates plugins/ with os.listdir before importing each
# module by name, so the .py files must exist as real files on disk inside
# the bundle -- hiddenimports alone would satisfy the import but leave the
# scan finding nothing. Ship both. If plugins/ is absent the factory falls
# back to YtDlpDefaultExtractor, which is the documented behavior.
if (ROOT / "plugins").is_dir():
    datas.append((str(ROOT / "plugins"), "plugins"))

if VENDOR_BIN.is_dir():
    datas.append((str(VENDOR_BIN), "bin"))

datas += collect_data_files("webview")

# --- imports --------------------------------------------------------------
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]
# Plugins are imported by name at runtime, so static analysis never sees them.
hiddenimports += collect_submodules("plugins")
hiddenimports += collect_submodules("webview")
# statusbar được import qua đường namespace package (apps.desktop.statusbar);
# thêm tường minh để phân tích tĩnh của PyInstaller không bỏ sót.
hiddenimports += ["apps.desktop.statusbar", "AppKit", "Foundation", "objc"]


a = Analysis(
    [str(ROOT / "apps" / "desktop" / "main.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # The desktop app never renders with rich, and DrissionPage is only pulled
    # in by browser plugins that import it themselves.
    excludes=["tkinter", "pytest", "unittest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Streamloot",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    # Apple silicon only by default; build_app.sh --universal overrides this.
    target_arch=os.environ.get("STREAMLOOT_TARGET_ARCH") or None,
    codesign_identity=os.environ.get("STREAMLOOT_CODESIGN_IDENTITY") or None,
    entitlements_file=os.environ.get("STREAMLOOT_ENTITLEMENTS") or None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Streamloot",
)

app = BUNDLE(
    coll,
    name="Streamloot.app",
    icon=str(ROOT / "packaging" / "icon.icns")
    if (ROOT / "packaging" / "icon.icns").exists()
    else None,
    bundle_identifier="dev.khaip.streamloot",
    info_plist={
        "CFBundleName": "Streamloot",
        "CFBundleDisplayName": "Streamloot",
        "CFBundleShortVersionString": os.environ.get("STREAMLOOT_VERSION", "0.1.0"),
        "CFBundleVersion": os.environ.get("STREAMLOOT_VERSION", "0.1.0"),
        "NSHighResolutionCapable": True,
        # B4: KHÔNG đặt LSUIElement ở đây. Đặt LSUIElement=True là app vĩnh viễn
        # không có icon Dock, kể cả khi cửa sổ đang mở — sai với một app có cửa
        # sổ chính. Thay vào đó apps/desktop/statusbar.py gọi
        # setActivationPolicy_() lúc chạy: có icon Dock khi cửa sổ hiện, ẩn khi
        # cửa sổ bị ẩn và app lui về menu bar.
        # main.py talks to its own backend on 127.0.0.1 over plain http, which
        # App Transport Security blocks by default inside a bundle.
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        # Nothing here is a document-based app; keep it out of the Open With menu.
        "LSMinimumSystemVersion": "11.0",
    },
)
