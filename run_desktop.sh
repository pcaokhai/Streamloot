#!/usr/bin/env bash
set -e

# =============================================================================
# Downloader Desktop App - Build & Run Script
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
UI_DIR="$ROOT_DIR/apps/desktop/ui"

FORCE_BUILD=false
BUILD_ONLY=false
CLEAN=false

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        -b|--build)
            FORCE_BUILD=true
            shift
            ;;
        --build-only)
            BUILD_ONLY=true
            FORCE_BUILD=true
            shift
            ;;
        -c|--clean)
            CLEAN=true
            FORCE_BUILD=true
            shift
            ;;
        -h|--help)
            echo "Usage: ./run_desktop.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -b, --build       Force rebuild of the React UI before launching"
            echo "  --build-only      Build the UI only, do not launch the desktop app"
            echo "  -c, --clean       Clean dist & node_modules, reinstall and rebuild"
            echo "  -h, --help        Show this help message"
            echo ""
            echo "Example:"
            echo "  ./run_desktop.sh           # Auto-build if needed, then run"
            echo "  ./run_desktop.sh --build   # Rebuild UI and run"
            exit 0
            ;;
        *)
            echo "Unknown option: $1 (Use --help for details)"
            exit 1
            ;;
    esac
done

echo "==> [1/3] Checking environment requirements..."

# Check npm & node
if ! command -v npm &> /dev/null; then
    echo "Error: 'npm' is not installed or not in PATH."
    exit 1
fi

# Check uv
if ! command -v uv &> /dev/null; then
    echo "Error: 'uv' is not installed or not in PATH."
    exit 1
fi

# 1. Clean if requested
if [ "$CLEAN" = true ]; then
    echo "==> Cleaning UI build artifacts and node_modules..."
    rm -rf "$UI_DIR/dist" "$UI_DIR/node_modules"
fi

# 2. Check node_modules
if [ ! -d "$UI_DIR/node_modules" ]; then
    echo "==> Installing UI dependencies (npm install)..."
    (cd "$UI_DIR" && npm install)
fi

# 3. Build UI if dist/index.html is missing or forced
if [ "$FORCE_BUILD" = true ] || [ ! -f "$UI_DIR/dist/index.html" ]; then
    echo "==> [2/3] Building Frontend UI (Vite + React + Tailwind)..."
    (cd "$UI_DIR" && npm run build)
else
    echo "==> [2/3] Frontend build already exists in apps/desktop/ui/dist (use --build to force rebuild)"
fi

if [ "$BUILD_ONLY" = true ]; then
    echo "==> Build complete (--build-only specified). Exiting."
    exit 0
fi

# 4. Launch Desktop App
echo "==> [3/3] Launching Desktop App via uv..."
cd "$ROOT_DIR"
exec uv run apps/desktop/main.py
