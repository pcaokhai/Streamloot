import os
import re
from typing import Optional, List, Callable
from pathlib import Path
from extractors.factory import ExtractorFactory
from downloaders.ytdlp import YtDlpDownloader
from services.history_service import HistoryService
from utils import paths
from utils.logger import Logger
from ui.interactive import InteractivePrompt
from core.models import VideoInfo

def is_video_on_disk(video_info: VideoInfo, target_dir: str) -> bool:
    """
    Checks if a matching video file actually exists in target_dir.
    """
    if not os.path.exists(target_dir) or not os.path.isdir(target_dir):
        return False

    safe_title = re.sub(r'[\\/*?:"<>|\n\r\t]', "", video_info.title).strip()
    valid_exts = {'.mp4', '.mkv', '.webm', '.ts', '.m4v', '.mov', '.avi', '.flv'}

    try:
        for f in os.listdir(target_dir):
            if f.endswith('.part') or f.endswith('.ytdl') or f.endswith('.temp'):
                continue
            
            base_name, ext = os.path.splitext(f)
            if ext.lower() in valid_exts:
                if safe_title and safe_title != "%(title)s":
                    if base_name == safe_title or safe_title in base_name:
                        return True
                if video_info.video_id and video_info.video_id in base_name:
                    return True
    except Exception:
        pass
        
    return False

def sync_archive_with_disk(video_infos: List[VideoInfo], target_dir: str, archive_path: str):
    """
    Ensures db/ytdlp_archive.txt reflects reality. If a video was deleted from disk,
    its ID is purged from the archive so yt-dlp won't skip it.
    """
    if not os.path.exists(archive_path) or not video_infos:
        return
        
    ids_to_remove = set()
    for v in video_infos:
        if v.video_id and not is_video_on_disk(v, target_dir):
            ids_to_remove.add(v.video_id)
            
    if not ids_to_remove:
        return
        
    try:
        with open(archive_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        new_lines = []
        for line in lines:
            parts = line.strip().split()
            # If line contains any ID to remove, purge it
            if any(vid in parts for vid in ids_to_remove):
                continue
            new_lines.append(line)
            
        with open(archive_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
    except Exception as e:
        Logger.error(f"Error syncing archive: {e}", exc_info=True)

class DownloadService:
    """
    Application Service Layer coordinating Extractor, Downloader, and UI.
    """
    
    def __init__(self):
        self.downloader = YtDlpDownloader()
        self.history = HistoryService()

    def _is_cancel_requested(self, task_id: Optional[str]) -> bool:
        if not task_id:
            return False
        task = self.history.get_task(task_id)
        return bool(task) and task["status"] == "cancelling"

    def process_url(self, url: str, concurrency: int = 2, output_dir: Optional[str] = None,
                    interactive: bool = True, format_id: Optional[str] = None,
                    progress_callback: Optional[Callable[[dict], None]] = None,
                    task_id: Optional[str] = None,
                    process_callback: Optional[Callable] = None,
                    source: str = "unknown") -> bool:
        """
        Processes the complete flow: Get Extractor -> Extract VideoInfo -> [Optional UI] -> Download Video

        :param task_id: When set (API mode), enables cancellation: after each
            video download, the task's DB status is checked, and if a caller
            has set it to 'cancelling' (via HistoryService.update_task), the
            remaining work is abandoned and the task is marked 'cancelled'.
        :param process_callback: Forwarded to the downloader so the caller can
            get the live process handle for cancellation.
        """
        if self._is_cancel_requested(task_id):
            self.history.update_task(task_id, status="cancelled")
            return False

        extractor = ExtractorFactory.get_extractor(url)
        
        video_infos = extractor.extract(url)
        
        if not video_infos:
            Logger.error("Video information extraction failed.")
            if task_id:
                self.history.update_task(task_id, status="failed", error_msg="Video information extraction failed.")
            return False

        return self.process_video_infos(
            video_infos,
            concurrency=concurrency,
            output_dir=output_dir,
            interactive=interactive,
            format_id=format_id,
            progress_callback=progress_callback,
            task_id=task_id,
            process_callback=process_callback,
            source=source,
        )

    def process_video_infos(self, video_infos: List[VideoInfo], concurrency: int = 2,
                            output_dir: Optional[str] = None, interactive: bool = True,
                            format_id: Optional[str] = None,
                            progress_callback: Optional[Callable[[dict], None]] = None,
                            task_id: Optional[str] = None,
                            process_callback: Optional[Callable] = None,
                            source: str = "unknown") -> bool:
        """
        Tải từ VideoInfo đã dựng sẵn, BỎ QUA bước extract.

        Tách ra từ process_url để browser extension dùng được (ADR 0005 B1):
        extension đã quan sát được manifest trong session thật của người dùng rồi,
        nên bắt app mở lại Chromium và vượt Cloudflare lần nữa là lãng phí ~30s và
        tự chuốc lấy một lớp lỗi không cần thiết.

        process_url() giờ chỉ là: extract rồi gọi hàm này. Đường cũ giữ nguyên
        cho CLI/Desktop và cho chính extension khi nó không bắt được manifest
        (ADR 0005 B9).
        """
        if self._is_cancel_requested(task_id):
            self.history.update_task(task_id, status="cancelled")
            return False

        # Determine target directory
        base_dir = output_dir if output_dir else str(Path.home() / "Downloads" / "downloader")
        is_playlist = len(video_infos) > 1 and video_infos[0].playlist_name is not None
        playlist_name = video_infos[0].playlist_name if is_playlist else None
        
        if is_playlist:
            safe_playlist_name = re.sub(r'[\\/*?:"<>|\n\r\t]', "", playlist_name).strip()
            target_dir = os.path.join(base_dir, safe_playlist_name)
        else:
            target_dir = base_dir

        # Sync archive file with actual disk content
        archive_path = str(paths.db_dir() / "ytdlp_archive.txt")
        sync_archive_with_disk(video_infos, target_dir, archive_path)

        # Single video handling
        if not is_playlist:
            if is_video_on_disk(video_infos[0], target_dir):
                Logger.success(f"✓ Video '{video_infos[0].title}' is already downloaded in '{target_dir}'.")
                if task_id:
                    self.history.update_task(task_id, status="completed", progress=100.0, title=video_infos[0].title)
                return True
                
            if interactive and not format_id:
                selected_format = InteractivePrompt.select_format()
                if selected_format:
                    format_id = selected_format

            Logger.plain(f"\n[bold magenta]--- Downloading: {video_infos[0].title} ---[/bold magenta]")
            Logger.get_logger().debug(f"Stream URL: {video_infos[0].m3u8_url}")
            
            output_path = self.downloader.download(video_infos[0], concurrency, output_dir, format_id,
                                                     progress_callback=progress_callback,
                                                     process_callback=process_callback)
            success = output_path is not None

            if self._is_cancel_requested(task_id):
                self.history.update_task(task_id, status="cancelled")
                Logger.warning(f"Cancelled: {video_infos[0].title}")
                return False

            status = "SUCCESS" if success else "FAILED"
            final_title = video_infos[0].title
            if success and output_path and final_title == "%(title)s":
                final_title = os.path.splitext(os.path.basename(output_path))[0]

            self.history.save_record(
                title=final_title,
                url=video_infos[0].page_url,
                m3u8_url=video_infos[0].m3u8_url,
                format_id=format_id or "best",
                status=status,
                output_path=output_path,
                playlist_name=None,
                source=source,
            )
            if task_id:
                self.history.update_task(task_id, status="completed" if success else "failed",
                                          progress=100.0 if success else None, title=final_title,
                                          output_path=output_path)

            if success:
                Logger.success(f"Downloaded: {final_title}")
            else:
                Logger.error(f"Failed to download: {video_infos[0].title}")
            return success

        # Playlist handling
        if os.path.exists(target_dir):
            if not format_id:
                last_format = self.history.get_last_format_for_playlist(playlist_name)
                if last_format:
                    format_id = last_format
                    Logger.info(f"Resuming playlist '{playlist_name}' with saved resolution: {format_id}")
        else:
            Logger.info(f"Playlist folder '{playlist_name}' not found. Downloading from scratch...")

        already_downloaded = [v for v in video_infos if is_video_on_disk(v, target_dir)]
        pending_videos = [v for v in video_infos if not is_video_on_disk(v, target_dir)]
        
        if already_downloaded:
            Logger.info(f"Checking previous download status for playlist: '{playlist_name}'")
            for v in already_downloaded:
                Logger.success(f"✓ [Already Downloaded] {v.title}")
                
            if not pending_videos:
                Logger.success(f"All {len(video_infos)} videos in playlist '{playlist_name}' have already been downloaded!")
                if task_id:
                    self.history.update_task(task_id, status="completed", progress=100.0)
                return True
            else:
                Logger.info(f"Found {len(pending_videos)} new/remaining video(s) to download.\n")

        # Interactive format selection (Ask once for playlist)
        if interactive and not format_id:
            selected_format = InteractivePrompt.select_format()
            if selected_format:
                format_id = selected_format
                
        all_success = True
        for idx, video_info in enumerate(pending_videos, 1):
            if self._is_cancel_requested(task_id):
                self.history.update_task(task_id, status="cancelled")
                Logger.warning(f"Playlist download cancelled before video {idx}/{len(pending_videos)}.")
                return False

            Logger.plain(f"\n[bold magenta]--- Downloading [{idx}/{len(pending_videos)}]: {video_info.title} ---[/bold magenta]")
            Logger.get_logger().debug(f"Stream URL: {video_info.m3u8_url}")

            output_path = self.downloader.download(video_info, concurrency, output_dir, format_id,
                                                     progress_callback=progress_callback,
                                                     process_callback=process_callback)
            success = output_path is not None

            if self._is_cancel_requested(task_id):
                self.history.update_task(task_id, status="cancelled")
                Logger.warning(f"Cancelled: {video_info.title}")
                return False

            if not success:
                all_success = False

            status = "SUCCESS" if success else "FAILED"
            final_title = video_info.title
            if success and output_path and final_title == "%(title)s":
                final_title = os.path.splitext(os.path.basename(output_path))[0]

            self.history.save_record(
                title=final_title,
                # Per-video, không phải video_infos[0]: đây là vòng lặp, mỗi
                # dòng history là một video riêng.
                url=video_info.page_url,
                m3u8_url=video_info.m3u8_url,
                format_id=format_id or "best",
                status=status,
                output_path=output_path,
                playlist_name=video_info.playlist_name,
                source=source,
            )
            if task_id:
                self.history.update_task(task_id, status="downloading",
                                          progress=round(idx / len(pending_videos) * 100, 1),
                                          title=final_title, output_path=output_path)

            if success:
                Logger.success(f"Downloaded: {final_title}")
            else:
                Logger.error(f"Failed to download: {video_info.title}")

        if task_id:
            self.history.update_task(task_id, status="completed" if all_success else "failed")

        if len(pending_videos) > 1:
            if all_success:
                Logger.success(f"All {len(pending_videos)} videos downloaded successfully!")
            else:
                Logger.warning("Download completed with some errors.")
                
        return all_success
