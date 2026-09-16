import json
import subprocess
from typing import Optional, List
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from core.extractor import BaseExtractor
from core.models import VideoInfo
from utils.logger import Logger

def sanitize_youtube_url(url: str) -> str:
    """
    Cleans up YouTube URL. If it's a single video with a Mix/Radio list (list=RD... or list=UL...),
    strips the list and index parameters to avoid downloading an endless mix playlist.
    """
    parsed = urlparse(url)
    if "youtube.com" in parsed.netloc or "youtu.be" in parsed.netloc:
        query_params = parse_qs(parsed.query)
        if "v" in query_params:
            list_param = query_params.get("list", [None])[0]
            if list_param and (list_param.startswith("RD") or list_param.startswith("UL")):
                Logger.get_logger().debug("Detected YouTube Mix/Radio URL. Extracting single video instead of endless mix.")
                query_params.pop("list", None)
                query_params.pop("start_radio", None)
                query_params.pop("index", None)
                new_query = urlencode(query_params, doseq=True)
                return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
    return url

class YoutubeExtractor(BaseExtractor):
    """
    Plugin extractor for YouTube to handle both single videos and playlists.
    """
    SUPPORTED_DOMAINS = ["youtube.com", "youtu.be"]

    def extract(self, url: str) -> Optional[List[VideoInfo]]:
        url = sanitize_youtube_url(url)
        Logger.get_logger().debug(f"Extracting YouTube information for: {url}")
        try:
            cmd = ['yt-dlp', '--dump-json', '--flat-playlist', '--playlist-end', '50', url]
            
            with Logger._console.status("[bold cyan]Extracting YouTube metadata...[/bold cyan]", spinner="dots"):
                result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            
            videos = []
            for line in result.stdout.strip().split('\n'):
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    video_url = data.get('url') or data.get('webpage_url')
                    if not video_url:
                        vid = data.get('id')
                        if vid:
                            video_url = f"https://www.youtube.com/watch?v={vid}"
                    
                    if video_url:
                        playlist_name = data.get('playlist') or data.get('playlist_title')
                        vid_title = data.get('title') or "%(title)s"
                        vid_id = data.get('id')
                        videos.append(VideoInfo(
                            title=vid_title,
                            m3u8_url=video_url,
                            page_url=video_url,
                            playlist_name=playlist_name,
                            video_id=vid_id
                        ))
                except json.JSONDecodeError:
                    continue
            
            if videos:
                if len(videos) > 1:
                    playlist_name = videos[0].playlist_name or "Playlist"
                    Logger.info(f"Found YouTube Playlist: '{playlist_name}' with {len(videos)} videos")
                else:
                    Logger.get_logger().debug("Found single YouTube video")
                return videos
            else:
                Logger.warning("Could not extract any videos from YouTube URL")
                return None
                
        except subprocess.CalledProcessError as e:
            Logger.error(f"yt-dlp extraction failed: {e.stderr}")
            return None
