#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Streamloot — macOS .app build
#
#   ./build_app.sh                 build dist/Streamloot.app (~45MB, KHÔNG nhúng binary)
#   ./build_app.sh --clean         wipe build/ dist/ vendor/ first
#   ./build_app.sh --with-ytdlp    nhúng yt-dlp (+35MB)
#   ./build_app.sh --with-ffmpeg   nhúng ffmpeg (+43MB)
#   ./build_app.sh --with-chromium nhúng Chromium (+359MB)
#   ./build_app.sh --bundle-all    nhúng cả ba (bản cũ, ~482MB)
#   ./build_app.sh --sign "Developer ID Application: Name (TEAMID)"
#   ./build_app.sh --open          reveal the result in Finder when done
#
# MẶC ĐỊNH KHÔNG NHÚNG BINARY NÀO. App tự tải yt-dlp và ffmpeg khi chạy lần
# đầu, còn Chromium thì người dùng tự bấm cài trong Cài đặt nếu cần đường
# dán-URL. Xem docs/2026-09-19-danh-gia-lai-kien-truc.md.
#
# Vì sao đảo mặc định: bản nhúng đủ ba nặng 482MB mà 359MB trong đó là Chromium,
# thứ chỉ phục vụ MỘT đường ở vài site. Nhúng cũng là nguyên nhân macOS
# Gatekeeper chặn app (một .app chưa ký nằm trong ruột .app khác).
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
UI_DIR="$ROOT_DIR/apps/desktop/ui"
VENDOR_BIN="$ROOT_DIR/packaging/vendor/bin"
VENDOR_CHROME="$ROOT_DIR/packaging/vendor/chrome"
APP_PATH="$ROOT_DIR/dist/Streamloot.app"

CLEAN=false
WITH_YTDLP=false
WITH_FFMPEG=false
WITH_CHROMIUM=false
SIGN_IDENTITY=""
REVEAL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--clean)      CLEAN=true; shift ;;
        --with-ytdlp)    WITH_YTDLP=true; shift ;;
        --with-ffmpeg)   WITH_FFMPEG=true; shift ;;
        --with-chromium) WITH_CHROMIUM=true; shift ;;
        --bundle-all)    WITH_YTDLP=true; WITH_FFMPEG=true; WITH_CHROMIUM=true; shift ;;
        # Giữ lại cho quen tay: giờ đã là mặc định nên chỉ là không-làm-gì.
        --no-ffmpeg)     WITH_FFMPEG=false; shift ;;
        --no-chromium)   WITH_CHROMIUM=false; shift ;;
        --sign)          SIGN_IDENTITY="${2:-}"; shift 2 ;;
        --open)          REVEAL=true; shift ;;
        -h|--help)       sed -n '4,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1 (--help for details)" >&2; exit 1 ;;
    esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Error: this builds a macOS .app and only runs on macOS." >&2
    exit 1
fi

command -v uv  >/dev/null || { echo "Error: 'uv' not found on PATH." >&2; exit 1; }
command -v npm >/dev/null || { echo "Error: 'npm' not found on PATH." >&2; exit 1; }

if [[ "$CLEAN" == true ]]; then
    echo "==> Cleaning build artifacts..."
    rm -rf "$ROOT_DIR/build" "$ROOT_DIR/dist" "$ROOT_DIR/packaging/vendor"
fi

# -----------------------------------------------------------------------------
echo "==> [1/5] Building the React UI..."
# The spec bundles apps/desktop/ui/dist as-is; a stale or missing build here
# becomes a blank window at runtime with no error, so always rebuild.
[[ -d "$UI_DIR/node_modules" ]] || (cd "$UI_DIR" && npm install)
(cd "$UI_DIR" && npm run build)
[[ -f "$UI_DIR/dist/index.html" ]] || { echo "Error: UI build produced no dist/index.html." >&2; exit 1; }

# -----------------------------------------------------------------------------
echo "==> [2/5] Vendoring runtime binaries..."
mkdir -p "$VENDOR_BIN"

# yt-dlp: the official macOS build is a self-contained binary. Homebrew's
# yt-dlp is NOT usable here -- it is a script whose shebang points at Homebrew's
# own Python, which will not exist on another machine.
if [[ "$WITH_YTDLP" == true && ! -x "$VENDOR_BIN/yt-dlp" ]]; then
    echo "    fetching yt-dlp (official standalone macOS build)..."
    curl -fsSL --retry 3 \
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" \
        -o "$VENDOR_BIN/yt-dlp"
    chmod +x "$VENDOR_BIN/yt-dlp"
elif [[ "$WITH_YTDLP" == true ]]; then
    echo "    yt-dlp already vendored (delete packaging/vendor to refresh)"
else
    rm -f "$VENDOR_BIN/yt-dlp"
    echo "    bỏ qua yt-dlp — app tự tải khi chạy lần đầu (--with-ytdlp để nhúng)"
fi

if [[ "$WITH_FFMPEG" == true && ! -x "$VENDOR_BIN/ffmpeg" ]]; then
    # ffmpeg phải CÙNG KIẾN TRÚC với máy đang chạy.
    #
    # evermeet.cx (nguồn cũ) chỉ phát hành bản x86_64. Nhét bản đó vào một app
    # arm64 thì nó vẫn chạy qua Rosetta, nhưng macOS bắn thông báo "Support
    # Ending for Intel-based Apps" cho người dùng, và Rosetta sẽ biến mất ở một
    # bản macOS nào đó. Chọn nguồn theo `uname -m`.
    HOST_ARCH="$(uname -m)"
    case "$HOST_ARCH" in
        arm64)  FFMPEG_ASSET="ffmpeg-darwin-arm64" ;;
        x86_64) FFMPEG_ASSET="ffmpeg-darwin-x64" ;;
        *)      FFMPEG_ASSET="" ;;
    esac
    echo "    fetching ffmpeg ($HOST_ARCH static build)..."
    # yt-dlp needs ffmpeg to merge separate video/audio streams, which is the
    # common case -- without it downloads silently come out video-only.
    if [[ -n "$FFMPEG_ASSET" ]] && curl -fsSL --retry 3 \
        "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/$FFMPEG_ASSET" \
        -o "$VENDOR_BIN/ffmpeg"; then
        chmod +x "$VENDOR_BIN/ffmpeg"
        # Kiểm lại thay vì tin: tải nhầm kiến trúc là lỗi thầm lặng, app vẫn
        # chạy được nên không ai phát hiện cho tới khi macOS cảnh báo.
        GOT_ARCH="$(lipo -archs "$VENDOR_BIN/ffmpeg" 2>/dev/null || echo unknown)"
        if [[ "$GOT_ARCH" != *"$HOST_ARCH"* ]]; then
            echo "    ERROR: ffmpeg tải về là '$GOT_ARCH', máy này là '$HOST_ARCH'." >&2
            rm -f "$VENDOR_BIN/ffmpeg"
            exit 1
        fi
        echo "    ffmpeg OK ($GOT_ARCH)"
    else
        rm -f "$VENDOR_BIN/ffmpeg"
        echo "    WARNING: ffmpeg download failed. The app will fall back to" >&2
        echo "             /opt/homebrew/bin and /usr/local/bin at run time." >&2
    fi
elif [[ "$WITH_FFMPEG" == false ]]; then
    rm -f "$VENDOR_BIN/ffmpeg"
    echo "    bỏ qua ffmpeg — app tự tải khi chạy lần đầu (--with-ffmpeg để nhúng)"
fi

# Chromium: các extractor dùng browser điều khiển nó qua CDP. Đóng gói riêng để
# không phải đụng Chrome trong /Applications — app chỉ ký ad-hoc nên macOS App
# Management chặn và hiện cảnh báo bảo mật. Kèm lợi: không đòi máy người dùng có
# sẵn Chrome, và phiên bản bị ghim nên Chrome tự cập nhật không làm vỡ plugin.
# Đổi lại ~300MB. Dùng --no-chromium để bỏ qua.
if [[ "$WITH_CHROMIUM" == true && ! -d "$VENDOR_CHROME/Google Chrome for Testing.app" ]]; then
    echo "    fetching Chrome for Testing (~182MB, chỉ tải một lần)..."
    CFT_JSON="$(mktemp)"
    if curl -fsSL --retry 3 \
        "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json" \
        -o "$CFT_JSON"; then
        CFT_URL="$(python3 -c "
import json,sys
d=json.load(open('$CFT_JSON'))
for x in d['channels']['Stable']['downloads']['chrome']:
    if x['platform']=='mac-arm64':
        print(x['url']); break
" 2>/dev/null)"
        CFT_VER="$(python3 -c "import json;print(json.load(open('$CFT_JSON'))['channels']['Stable']['version'])" 2>/dev/null)"
        rm -f "$CFT_JSON"
        if [[ -n "$CFT_URL" ]]; then
            echo "    version $CFT_VER"
            TMP_CHROME="$(mktemp -d)"
            if curl -fL --retry 3 "$CFT_URL" -o "$TMP_CHROME/chrome.zip"; then
                mkdir -p "$VENDOR_CHROME"
                unzip -qo "$TMP_CHROME/chrome.zip" -d "$TMP_CHROME"
                # Zip giải ra thư mục chrome-mac-arm64/ chứa bundle .app bên trong.
                mv "$TMP_CHROME"/chrome-mac-arm64/* "$VENDOR_CHROME/" 2>/dev/null || true
                echo "$CFT_VER" > "$VENDOR_CHROME/.version"
            else
                echo "    WARNING: tải Chromium thất bại; app sẽ dùng Chrome hệ thống" >&2
            fi
            rm -rf "$TMP_CHROME"
        fi
    else
        rm -f "$CFT_JSON"
        echo "    WARNING: không lấy được danh sách phiên bản Chrome for Testing" >&2
    fi
elif [[ "$WITH_CHROMIUM" == false ]]; then
    rm -rf "$VENDOR_CHROME"
    echo "    bỏ qua Chromium — người dùng tự cài trong Cài đặt (--with-chromium để nhúng)"
else
    echo "    Chromium đã vendor sẵn ($(cat "$VENDOR_CHROME/.version" 2>/dev/null || echo '?'))"
fi

# -----------------------------------------------------------------------------
echo "==> [3/5] Syncing Python dependencies..."
uv sync 2>/dev/null || true
uv pip install --quiet pyinstaller

# -----------------------------------------------------------------------------
echo "==> [4/5] Running PyInstaller..."
[[ -n "$SIGN_IDENTITY" ]] && export STREAMLOOT_CODESIGN_IDENTITY="$SIGN_IDENTITY"
cd "$ROOT_DIR"
uv run pyinstaller \
    --noconfirm \
    --clean \
    --distpath "$ROOT_DIR/dist" \
    --workpath "$ROOT_DIR/build" \
    "$ROOT_DIR/packaging/Streamloot.spec"

[[ -d "$APP_PATH" ]] || { echo "Error: PyInstaller finished but $APP_PATH is missing." >&2; exit 1; }

# Chromium chép vào SAU PyInstaller, không qua datas: PyInstaller quét datas tìm
# binary rồi ký đè ad-hoc, mà Chrome đã có chữ ký của Google — codesign fail và
# sụp cả build. `ditto` giữ nguyên extended attributes và chữ ký, `cp -R` thì không.
if [[ "$WITH_CHROMIUM" == true && -d "$VENDOR_CHROME/Google Chrome for Testing.app" ]]; then
    echo "==> Chép Chromium vào bundle..."
    ditto "$VENDOR_CHROME" "$APP_PATH/Contents/Frameworks/chrome"
fi

# -----------------------------------------------------------------------------
echo "==> [5/5] Verifying the bundle..."
FAILED=0
check() {
    if [[ -e "$APP_PATH/Contents/Resources/$1" || -e "$APP_PATH/Contents/Frameworks/$1" ]]; then
        echo "    ok   $1"
    else
        echo "    MISS $1" >&2
        FAILED=1
    fi
}
check "apps/desktop/ui/dist/index.html"

# Binary giờ là TUỲ CHỌN: chỉ kiểm khi build có yêu cầu nhúng. Kiểm vô điều
# kiện thì bản mặc định (không nhúng gì) luôn báo hỏng, mà nó là bản đúng.
[[ "$WITH_YTDLP" == true ]]    && check "bin/yt-dlp"
[[ "$WITH_FFMPEG" == true ]]   && check "bin/ffmpeg"
[[ "$WITH_CHROMIUM" == true ]] && check "chrome/Google Chrome for Testing.app"

# Plugin là file .py dạng data, nhưng thư viện chúng import phải nằm trong PYZ.
# Thiếu DrissionPage thì mọi private extractor ném ImportError lúc chạy, factory
# nuốt exception theo đúng thiết kế, và người dùng chỉ thấy "Couldn't load
# formats" — suy giảm hoàn toàn im lặng. Kiểm ở đây để nó không im lặng nữa.
if [[ -d "$ROOT_DIR/plugins" ]]; then
    if grep -q "DrissionPage" "$ROOT_DIR/build/Streamloot/PYZ-00.toc" 2>/dev/null; then
        echo "    ok   DrissionPage (trong PYZ)"
    else
        echo "    MISS DrissionPage — private extractor sẽ fail im lặng lúc chạy" >&2
        FAILED=1
    fi
fi
[[ "$WITH_FFMPEG" == true ]] && check "bin/ffmpeg"
[[ "$WITH_CHROMIUM" == true ]] && check "chrome/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
[[ -d "$ROOT_DIR/plugins" ]] && check "plugins"

if [[ $FAILED -ne 0 ]]; then
    echo "" >&2
    echo "Bundle is missing files listed above — it will fail at run time." >&2
    exit 1
fi

if [[ -z "$SIGN_IDENTITY" ]]; then
    # An unsigned bundle is quarantined on any Mac that downloads it; stripping
    # the attribute locally keeps the build testable without a Developer ID.
    xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
    echo ""
    echo "NOTE: unsigned build. It runs here, but on another Mac Gatekeeper will"
    echo "      block it until the user right-clicks > Open. Pass --sign to fix."
fi

SIZE="$(du -sh "$APP_PATH" | cut -f1)"
echo ""
echo "Built: $APP_PATH ($SIZE)"
echo "Run:   open \"$APP_PATH\""
echo "Logs:  ~/Library/Application Support/Streamloot/logs/"

[[ "$REVEAL" == true ]] && open -R "$APP_PATH"
exit 0
