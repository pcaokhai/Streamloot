import socket
import tempfile
import uuid
from contextlib import closing
from threading import Lock

from DrissionPage import ChromiumPage, ChromiumOptions
from core.extractor import BaseExtractor
from core.models import VideoInfo
from typing import Optional, List
from utils.logger import Logger

# ponytail: process-wide lock, serializes concurrent browser extractions
# (format preview + actual download) so no two ChromiumPage instances share
# a CDP port/profile and kill each other's session. Per-request pooling if
# throughput ever matters.
_browser_lock = Lock()


def _free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class BaseBrowserExtractor(BaseExtractor):
    """
    Abstract intermediary class managing DrissionPage lifecycle.
    Sites requiring Cloudflare bypass should inherit from this.
    """
    def __init__(self, headless: bool = False):
        self.headless = headless

    def _init_browser(self) -> ChromiumPage:
        """
        Initialize and configure ChromiumPage for optimized scraping.
        Uses a fresh port + temp user-data-dir so concurrent extractions
        (e.g. format preview + download task) don't share one Chromium
        session and tear it down under each other.
        """
        co = ChromiumOptions()
        co.set_argument('--no-sandbox')
        co.set_argument('--disable-gpu')
        co.set_argument('--mute-audio')
        co.headless(self.headless)
        co.set_local_port(_free_port())
        co.set_user_data_path(tempfile.mkdtemp(prefix=f'drission_{uuid.uuid4().hex}_'))
        return ChromiumPage(co)

    def extract(self, url: str) -> Optional[List[VideoInfo]]:
        """
        Manage browser lifecycle (setup/teardown).
        Calls _extract_logic() which must be implemented by child classes.
        """
        page = None
        with _browser_lock:
            try:
                page = self._init_browser()
                return self._extract_logic(page, url)
            except Exception as e:
                Logger.error(f"Browser extraction error ({url}): {e}")
                return None
            finally:
                if page:
                    page.quit()
                
    def _extract_logic(self, page: ChromiumPage, url: str) -> Optional[List[VideoInfo]]:
        """
        Child classes MUST implement this logic.
        """
        raise NotImplementedError("Child classes must implement this method")
