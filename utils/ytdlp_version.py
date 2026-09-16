import subprocess
import urllib.request
import json
from typing import Optional

GITHUB_RELEASES_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"


def get_current_version(timeout: int = 5) -> Optional[str]:
    try:
        result = subprocess.run(["yt-dlp", "--version"], capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip() or None
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def get_latest_version(timeout: int = 5) -> Optional[str]:
    try:
        with urllib.request.urlopen(GITHUB_RELEASES_URL, timeout=timeout) as resp:
            data = json.loads(resp.read())
            tag = data.get("tag_name")
            return tag.lstrip("v") if tag else None
    except Exception:
        return None


def check_ytdlp_update() -> dict:
    """
    Compares the locally installed yt-dlp version against the latest GitHub
    release. Never invokes 'yt-dlp -U' — that flag self-updates (or refuses
    outright on pip/Homebrew-managed installs) rather than checking, and the
    correct update command differs by install method. This function only
    reports; it never applies an update.
    """
    current = get_current_version()
    latest = get_latest_version()
    return {
        "current": current,
        "latest": latest,
        "update_available": bool(current and latest and current != latest),
    }
