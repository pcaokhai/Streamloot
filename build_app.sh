#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Streamloot — macOS .app build
#
#   ./build_app.sh                 build dist/Streamloot.app
#   ./build_app.sh --clean         wipe build/ dist/ vendor/ first
#   ./build_app.sh --no-ffmpeg     skip vendoring ffmpeg (falls back to PATH)
#   ./build_app.sh --sign "Developer ID Application: Name (TEAMID)"
#   ./build_app.sh --open          reveal the result in Finder when done
#
# Produces a self-contained bundle: Python runtime, the built React UI, the
# plugins, and yt-dlp are all inside it. Nothing on PATH is required at run
# time except ffmpeg, and only when --no-ffmpeg was used.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
UI_DIR="$ROOT_DIR/apps/desktop/ui"
VENDOR_BIN="$ROOT_DIR/packaging/vendor/bin"
APP_PATH="$ROOT_DIR/dist/Streamloot.app"

CLEAN=false
WITH_FFMPEG=true
SIGN_IDENTITY=""
REVEAL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--clean)      CLEAN=true; shift ;;
        --no-ffmpeg)     WITH_FFMPEG=false; shift ;;
        --sign)          SIGN_IDENTITY="${2:-}"; shift 2 ;;
        --open)          REVEAL=true; shift ;;
        -h|--help)       sed -n '4,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
if [[ ! -x "$VENDOR_BIN/yt-dlp" ]]; then
    echo "    fetching yt-dlp (official standalone macOS build)..."
    curl -fsSL --retry 3 \
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" \
        -o "$VENDOR_BIN/yt-dlp"
    chmod +x "$VENDOR_BIN/yt-dlp"
else
    echo "    yt-dlp already vendored (delete packaging/vendor to refresh)"
fi

if [[ "$WITH_FFMPEG" == true && ! -x "$VENDOR_BIN/ffmpeg" ]]; then
    echo "    fetching ffmpeg (static build from evermeet.cx)..."
    # yt-dlp needs ffmpeg to merge separate video/audio streams, which is the
    # common case -- without it downloads silently come out video-only.
    TMP_ZIP="$(mktemp -t ffmpeg).zip"
    if curl -fsSL --retry 3 "https://evermeet.cx/ffmpeg/getrelease/zip" -o "$TMP_ZIP"; then
        unzip -qo "$TMP_ZIP" -d "$VENDOR_BIN"
        chmod +x "$VENDOR_BIN/ffmpeg"
        rm -f "$TMP_ZIP"
    else
        rm -f "$TMP_ZIP"
        echo "    WARNING: ffmpeg download failed. The app will fall back to" >&2
        echo "             /opt/homebrew/bin and /usr/local/bin at run time." >&2
    fi
elif [[ "$WITH_FFMPEG" == false ]]; then
    echo "    skipping ffmpeg (--no-ffmpeg); app falls back to PATH at run time"
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
check "bin/yt-dlp"
[[ "$WITH_FFMPEG" == true ]] && check "bin/ffmpeg"
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
