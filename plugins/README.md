# Plugin System Guide

Downloader uses a dynamic plugin architecture. Any `.py` file placed inside this `plugins/` directory that inherits from `core.extractor.BaseExtractor` (or `extractors.base_browser.BaseBrowserExtractor`) will be automatically discovered and registered at runtime.

## Writing a Plugin

Create a new python file in `plugins/` (e.g. `plugins/my_custom_site.py`):

```python
from typing import Optional, List
from core.extractor import BaseExtractor
from core.models import VideoInfo

class MyCustomSiteExtractor(BaseExtractor):
    """
    Plugin for my_custom_site.com
    """
    # Define domains that this plugin handles:
    SUPPORTED_DOMAINS = ["mycustomsite.com", "mycustomsite.net"]

    def extract(self, url: str) -> Optional[List[VideoInfo]]:
        # Implement extraction logic
        return [
            VideoInfo(
                title="Example Video Title",
                m3u8_url="https://cdn.example.com/master.m3u8",
                page_url=url,
                referer="https://mycustomsite.com/",
                origin="https://mycustomsite.com",
                
                # Optional flags:
                # disable_fixup=True,      # Disable yt-dlp native ffmpeg fixup
                # embed_metadata=False,    # Disable ffmpeg thumbnail/metadata embedding
                # clean_disguised_ts=True  # Clean disguised fake PNG headers
            )
        ]
```

## Browser-based Plugins (Cloudflare / Dynamic JS)

For sites requiring Cloudflare bypass or browser automation:

```python
from typing import Optional, List
from DrissionPage import ChromiumPage
from core.models import VideoInfo
from extractors.base_browser import BaseBrowserExtractor

class MyBrowserSiteExtractor(BaseBrowserExtractor):
    SUPPORTED_DOMAINS = ["browser-site.com"]

    def __init__(self, headless: bool = False):
        super().__init__(headless=headless)

    def _extract_logic(self, page: ChromiumPage, url: str) -> Optional[List[VideoInfo]]:
        page.get(url)
        # Handle interaction, network listening, etc.
        return [...]
```

## Keeping Plugins Private

To keep sensitive or private plugins out of public Git repositories, add the plugin filename to `.gitignore`:
```gitignore
plugins/my_private_site.py
```
The core application will continue to work seamlessly for all other sites even if these plugins are excluded.
