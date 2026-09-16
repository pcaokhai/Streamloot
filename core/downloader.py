from abc import ABC, abstractmethod
from typing import Optional, Callable
from .models import VideoInfo

class BaseDownloader(ABC):
    """
    Abstract base class for all Downloaders.
    Allows using yt-dlp, ffmpeg or custom downloaders.
    """
    
    @abstractmethod
    def download(self,
                 video_info: VideoInfo,
                 concurrency: int = 2,
                 output_dir: Optional[str] = None,
                 format_id: Optional[str] = None,
                 ignore_archive: bool = False,
                 progress_callback: Optional[Callable[[dict], None]] = None,
                 process_callback: Optional[Callable] = None) -> Optional[str]:
        """
        Download video based on provided info.
        :param video_info: Extracted video information
        :param concurrency: Number of concurrent download threads
        :param output_dir: Directory to save the file (default used if None)
        :param format_id: Specific format ID to download (best if None)
        :param ignore_archive: Whether to ignore the download archive
        :param progress_callback: Function to call with progress updates
        :param process_callback: Function called with the live process handle
            (e.g. subprocess.Popen) as soon as the download starts, so callers
            can cancel it
        :return: Path to the downloaded file if successful, None otherwise
        """
        pass
