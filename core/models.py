from dataclasses import dataclass, field
from typing import Optional, List

@dataclass
class VideoInfo:
    """
    Data Transfer Object (DTO) containing extracted video information.
    """
    title: str
    m3u8_url: str
    page_url: str
    referer: Optional[str] = None
    origin: Optional[str] = None
    playlist_name: Optional[str] = None
    video_id: Optional[str] = None
    user_agent: Optional[str] = None
    cookies: Optional[str] = None
    
    # Generic download & post-processing flags configurable by plugins
    disable_fixup: bool = False
    embed_metadata: bool = True
    clean_disguised_ts: bool = False
    extra_ytdlp_args: List[str] = field(default_factory=list)
