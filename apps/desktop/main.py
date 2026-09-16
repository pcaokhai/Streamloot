import webview
import os
import sys
import secrets
from pathlib import Path
import threading
import uvicorn
import time

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Generate a random API key for this session and set it before the backend
# import/startup reads os.environ["API_KEY"] — the desktop app is the only
# client of its own local port, so the key never needs to be typed by a
# human; it's handed to the page via the js_api bridge below instead of
# being hardcoded in the JS source.
os.environ.setdefault("API_KEY", secrets.token_urlsafe(32))

DESKTOP_PORT = 8001
# pywebview's own UI page is served through its built-in local HTTP server
# (see below) on this fixed port, so it has a real http:// origin — never
# load the page via a bare file:// URL. WKWebView sandboxes file:// pages
# hard enough that fetch() to any other origin, including localhost, fails
# outright with "Load failed"; pywebview's docs call this out explicitly.
# The page's origin is therefore http://127.0.0.1:UI_PORT, which needs to be
# allowlisted in CORS for it to reach the API on DESKTOP_PORT.
UI_PORT = 8002
os.environ.setdefault("CORS_ALLOWED_ORIGINS", f"http://127.0.0.1:{UI_PORT}")

# We can reuse the FastAPI backend for the Desktop UI!
from apps.api.main import app as fastapi_app
from utils import paths


class JsApi:
    """Exposed to the page as window.pywebview.api.*"""

    def get_api_config(self):
        return {"base_url": f"http://127.0.0.1:{DESKTOP_PORT}/api/v1", "api_key": os.environ["API_KEY"]}

    def reveal_in_finder(self, path: str) -> bool:
        """Context-menu 'Show in Finder' — no JS API can do this directly."""
        import subprocess
        if not path or not os.path.exists(path):
            return False
        subprocess.run(["open", "-R", path])
        return True

    def path_exists(self, path: str) -> bool:
        """Lets the UI decide whether to ask about deleting the file too."""
        return bool(path) and os.path.exists(path)


def start_backend():
    uvicorn.run(fastapi_app, host="127.0.0.1", port=DESKTOP_PORT, log_level="error")


def main():
    server_thread = threading.Thread(target=start_backend, daemon=True)
    server_thread.start()
    time.sleep(1)  # give the backend a moment to bind before the page's first fetch

    # UI is now a React/TypeScript/Vite app (apps/desktop/ui/) — this loads
    # its production build, not raw source. Run `npm run build` in ui/ after
    # any UI change; there's no dev-server wiring here (pywebview always
    # loads the built dist/, not `vite dev`).
    # Resolved via paths.resource_dir() rather than __file__ so this works both
    # from source and from inside the .app, where the bundled UI lives under
    # Contents/Frameworks, not next to this module.
    html_path = str(paths.resource_dir() / "apps" / "desktop" / "ui" / "dist" / "index.html")
    if not os.path.exists(html_path):
        raise SystemExit(
            f"UI build not found at {html_path}.\n"
            "Run: cd apps/desktop/ui && npm install && npm run build"
        )

    webview.create_window(
        "Downloads",
        html_path,  # no file:// prefix — pywebview serves this via its own
                    # local HTTP server (below), giving the page a real
                    # http:// origin instead of a sandboxed file:// one.
        js_api=JsApi(),
        width=980,
        height=620,
        min_size=(720, 420),
        vibrancy=True,  # native sidebar material, per DESIGN.md
        background_color="#1E1E1E",
    )
    # http_server=True pins pywebview's own local server to UI_PORT (rather
    # than an auto-picked port) so the CORS_ALLOWED_ORIGINS value set above
    # actually matches the page's real origin.
    # DOWNLOADER_DEBUG=1 enables the WKWebView inspector (right-click ->
    # Inspect Element) — with debug=False there is zero visibility into JS
    # errors, so a blank/broken window gives no signal at all to diagnose.
    debug = os.getenv("DOWNLOADER_DEBUG") == "1"
    webview.start(debug=debug, http_server=True, http_port=UI_PORT)


if __name__ == "__main__":
    main()
