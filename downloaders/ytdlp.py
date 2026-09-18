import subprocess
import tempfile

from utils import paths

# Finder-launched .app bundles inherit a minimal PATH without Homebrew, so the
# bare ["yt-dlp", ...] and os.system("ffmpeg ...") calls below would fail with
# FileNotFoundError on a machine where both work fine in Terminal. Fixed once
# here, at the only module that shells out to them.
paths.ensure_tool_path()
import os
import re
import time
from pathlib import Path
from typing import Optional, Callable
from core.downloader import BaseDownloader
from core.models import VideoInfo
from utils.logger import Logger
from utils.info_cache import info_cache
from utils.ytdlp_progress import ProgressReader, split_updates
from utils.text import format_speed

class YtDlpDownloader(BaseDownloader):
    """
    Downloader using yt-dlp. Emits progress via callbacks.
    """

    @staticmethod
    def _build_headers(video_info: VideoInfo) -> list:
        """
        Builds the --user-agent/--add-header args shared by both an actual
        download and a format-listing (metadata-only) yt-dlp invocation.
        """
        args = []
        if video_info.user_agent:
            args.extend(["--user-agent", video_info.user_agent])
        else:
            args.extend(["--user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"])

        if video_info.cookies:
            args.extend(["--add-header", f"Cookie: {video_info.cookies}"])
        if video_info.referer:
            args.extend(["--add-header", f"Referer: {video_info.referer}"])
        if video_info.origin:
            args.extend(["--add-header", f"Origin: {video_info.origin}"])
        return args

    def list_formats(self, video_info: VideoInfo, timeout: int = 30) -> list:
        """
        Returns yt-dlp's available formats for video_info.m3u8_url without
        downloading anything. Costs roughly the same site-load/detection
        risk as a real download for anti-bot sites, since the caller must
        already have run extraction (browser-cookie harvesting etc.) to
        produce video_info — this only skips the file write.
        """
        if not video_info.m3u8_url:
            raise ValueError("Cannot list formats: m3u8_url is missing.")

        cmd = ["yt-dlp", "-J", "--no-warnings"] + self._build_headers(video_info)
        if video_info.extra_ytdlp_args:
            cmd.extend(video_info.extra_ytdlp_args)
        cmd.append(video_info.m3u8_url)

        import json
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp format listing failed: {result.stderr.strip()[-500:]}")

        data = json.loads(result.stdout)
        # Nhớ nguyên văn info này cho bước TẢI: yt-dlp --load-info-json dùng lại
        # được và bỏ qua hẳn việc extract lần hai (đo: 0.30s thay vì 1.44s).
        info_cache.put(video_info.m3u8_url, result.stdout)
        formats = data.get("formats", data.get("requested_formats", []))
        parsed = [
            {
                "format_id": f.get("format_id"),
                "ext": f.get("ext"),
                "resolution": f.get("resolution") or (f"{f.get('height')}p" if f.get("height") else None),
                "height": f.get("height"),
                "filesize": f.get("filesize") or f.get("filesize_approx"),
                "vcodec": f.get("vcodec"),
                "acodec": f.get("acodec"),
            }
            for f in formats
        ]

        # Flag yt-dlp's own best-quality pick so a consumer doesn't have to
        # reimplement yt-dlp's format-selection heuristic. For a merged
        # video+audio pick, top-level format_id looks like "137+140" —
        # match on component membership, not exact equality.
        recommended_components = set((data.get("format_id") or "").split("+"))
        for f in parsed:
            f["recommended"] = f["format_id"] in recommended_components

        return [self._mergeable(f) for f in parsed]

    @staticmethod
    def _handle_event(line, reader, progress_callback) -> None:
        """
        Sự kiện KHÔNG phải tiến trình: hoàn tất một phần, hậu xử lý, đang kết nối.

        `reader` cần thiết vì cùng một dòng mang nghĩa khác nhau tuỳ lúc:
        `[download] 100%` của phần ĐẦU trong một lượt tải hai phần không phải là
        xong — báo "Finalizing" ở đó rồi để phần sau kéo về 0% chính là cái
        nhấp nháy downloading↔processing người dùng thấy.
        """
        if not progress_callback:
            return

        if "[download] 100%" in line:
            # KHÔNG phải "completed": hậu xử lý (ghép, nhúng metadata) còn ở sau,
            # và sự kiện hoàn tất thật (kèm tốc độ trung bình) chỉ bắn sau khi
            # process.wait() thành công.
            if reader.is_last_part():
                progress_callback({
                    "status": "processing",
                    "description": "Finalizing...",
                    "completed": 100.0,
                    "speed": "--",
                    "eta": "--",
                })
            return

        if "[Merger]" in line or "[Metadata]" in line or "[EmbedThumbnail]" in line or "Merging formats" in line:
            progress_callback({
                "status": "processing",
                "description": "Merging & embedding metadata...",
                "completed": 100.0,
                "speed": "Processing",
                "eta": "--",
            })
            return

        if "[youtube]" in line or "[info]" in line or "Downloading webpage" in line:
            # CHỈ trước khi phần đầu bắt đầu. yt-dlp in `[info]` cả giữa chừng;
            # báo "extracting" lúc đó là kéo thanh tiến trình về 0 giữa lượt tải.
            if reader.part_index == 0:
                progress_callback({
                    "status": "extracting",
                    "description": "Connecting & fetching streams...",
                    "completed": 0.0,
                    "speed": "--",
                    "eta": "--",
                })

    @staticmethod
    def _path_from_line(line: str) -> Optional[str]:
        """
        Đường dẫn file thật, đọc từ một dòng output của yt-dlp. `None` nếu dòng
        đó không nói gì về tên file.

        Tách riêng để TEST ĐƯỢC: trước đây ba phép khớp này nằm lọt trong nhánh
        "extracting" nên không bao giờ chạy, và đường dẫn lưu vào DB là mẫu
        "...%(ext)s" — "Hiện trong Finder" báo không tìm thấy file. Một lỗi thụt
        lề không có test nào chạm tới thì im lặng suốt.

        Thứ tự trong lượt tải: Destination -> (Merger) -> xong. Merger nói lời
        cuối vì nó đổi cả phần mở rộng khi phải ghép hình với tiếng.
        """
        merge = re.search(r'\[Merger\] Merging formats into "(.*?)"', line)
        if merge:
            return merge.group(1)
        dest = re.search(r'\[download\] Destination: (.*)', line)
        if dest:
            return dest.group(1).strip()
        already = re.search(r'\[download\] (.*?) has already been downloaded', line)
        if already:
            return already.group(1).strip()
        return None

    @staticmethod
    def _mergeable(f: dict) -> dict:
        """
        Luồng hình KHÔNG TIẾNG phải được ghép tiếng, nếu không người dùng nhận
        một video câm.

        HLS/DASH thường tách tiếng thành luồng riêng: mọi biến thể hình đều có
        `acodec: none`, còn tiếng nằm ở một rendition khác. Trả `format_id` trần
        cho client thì lúc tải yt-dlp lấy đúng luồng đó và chỉ luồng đó. Đo thật
        trên một site tin tức: yt-dlp tự chọn `hls-973+hls-default-audio-group-128k`,
        còn ta trả `hls-973` -> mất tiếng.

        `<id>+bestaudio/<id>` là cú pháp yt-dlp: ghép nếu có tiếng để ghép,
        không có thì lùi về chính luồng đó thay vì hỏng cả lượt tải.
        """
        vcodec = f.get("vcodec")
        acodec = f.get("acodec")
        video_only = vcodec not in (None, "none") and acodec in (None, "none")
        if video_only and f.get("format_id"):
            return {**f, "format_id": f"{f['format_id']}+bestaudio/{f['format_id']}"}
        return f

    def download(self,
                 video_info: VideoInfo,
                 concurrency: int = 4,
                 output_dir: Optional[str] = None,
                 format_id: Optional[str] = None,
                 ignore_archive: bool = False,
                 progress_callback: Optional[Callable[[dict], None]] = None,
                 process_callback: Optional[Callable[[subprocess.Popen], None]] = None) -> Optional[str]:
        if not video_info.m3u8_url:
            Logger.error("Cannot download: m3u8_url is missing or was not found by the extractor.")
            return None
            
        if not output_dir:
            output_dir = str(Path.home() / "Downloads" / "downloader")
            
        if video_info.playlist_name:
            safe_playlist_name = re.sub(r'[\\/*?:"<>|\n\r\t]', "", video_info.playlist_name).strip()
            output_dir = os.path.join(output_dir, safe_playlist_name)
            
        os.makedirs(output_dir, exist_ok=True)
        
        # Sanitize title if known string, or keep template
        if video_info.title and video_info.title != "%(title)s":
            safe_title = re.sub(r'[\\/*?:"<>|\n\r\t]', "_", video_info.title).strip()
            filename_template = f"{safe_title}.%(ext)s"
        else:
            filename_template = "%(title)s.%(ext)s"
            
        output_path = os.path.join(output_dir, filename_template)
        
        archive_path = str(paths.db_dir() / "ytdlp_archive.txt")
        
        cmd = [
            "yt-dlp",
            "-N", str(concurrency),
            "--socket-timeout", "60",
            "--retries", "20",
            "--fragment-retries", "20",
            "--sleep-requests", "1",
            "--windows-filenames",
            "-P", output_dir,
            "-o", filename_template,
        ]
        
        # Embed metadata unless explicitly disabled by the plugin/extractor
        if video_info.embed_metadata:
            cmd.extend(["--embed-thumbnail", "--embed-metadata"])
        
        cmd.extend(self._build_headers(video_info))

        # Do not use archive for generic direct media links (m3u8, mp4, etc.)
        # yt-dlp extracts generic IDs like 'master' which collide across different sites.
        is_generic_media = any(video_info.m3u8_url.split('?')[0].endswith(ext) for ext in ['.m3u8', '.mp4', '.ts', '.mkv'])

        if not ignore_archive and not is_generic_media:
            cmd.extend(["--download-archive", archive_path])

        # Disable yt-dlp native fixup if instructed by the plugin/extractor
        if video_info.disable_fixup:
            cmd.extend(["--fixup", "never"])
            
        # Add any extra yt-dlp arguments supplied by the plugin
        if video_info.extra_ytdlp_args:
            cmd.extend(video_info.extra_ytdlp_args)
        
        if format_id and format_id != "best":
            cmd.extend(["-f", format_id])

        # Dùng lại kết quả extract của bước liệt kê format, nếu còn.
        #
        # Không có nó thì yt-dlp extract lại từ đầu — đúng việc vừa làm xong vài
        # giây trước (1.4s trên một site tin tức, 3.0s trên YouTube). Cache dùng
        # MỘT LẦN rồi bỏ: info chứa URL có chữ ký và hết hạn, nên nếu mục cũ làm
        # lượt tải này hỏng thì lần thử lại không còn gì để dùng và tự đi đường
        # extract bình thường. Tự lành, không cần thử lại trong vòng chạy tải.
        info_json = info_cache.take(video_info.m3u8_url)
        info_file = None
        if info_json:
            fd, info_file = tempfile.mkstemp(prefix="streamloot-info-", suffix=".info.json")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(info_json)
            # Với --load-info-json thì KHÔNG truyền URL: yt-dlp lấy mọi thứ từ file.
            cmd.extend(["--load-info-json", info_file])
            Logger.get_logger().debug("Dùng lại info đã nhớ, bỏ qua bước extract")
        else:
            cmd.append(video_info.m3u8_url)

        Logger.get_logger().debug(f"Running yt-dlp for: {video_info.title}")
        Logger.get_logger().debug(f"Output directory: {output_dir}")
        if format_id:
            Logger.get_logger().debug(f"Selected Format: {format_id}")
        Logger.get_logger().debug(f"Concurrent fragments: {concurrency}")
        Logger.get_logger().debug(f"Command: {' '.join(cmd)}")
        
        try:
            start_time = time.time()
            # start_new_session: cho tiến trình tải một NHÓM riêng.
            #
            # yt-dlp giao việc tải HLS cho ffmpeg, nên tiến trình thật sự kéo
            # byte về là cháu chứ không phải con. Muốn tạm dừng/huỷ đến nơi thì
            # phải gửi tín hiệu cho cả nhóm (utils/proc.signal_tree) — mà muốn
            # gửi cho cả nhóm một cách an toàn thì nhóm đó phải KHÁC nhóm của
            # backend, nếu không backend tự dừng chính mình.
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, start_new_session=True)

            # Hand the live process handle to the caller immediately (before the
            # blocking read loop below) so it can be cancelled from outside.
            if process_callback:
                process_callback(process)

            final_path = output_path  # Default fallback
            
            if progress_callback:
                progress_callback({
                    "status": "preparing",
                    "description": "Preparing download...",
                    "completed": 0.0,
                    "speed": "--",
                    "eta": "--"
                })

            reader = ProgressReader()
            for chunk in process.stdout:
                # yt-dlp in tiến trình bằng `\r`, nên một "dòng" đọc ra có thể
                # chứa hàng chục lần cập nhật dính liền. Không tách thì `re.search`
                # lấy match ĐẦU tiên — tức luôn báo con số cũ nhất trong khối, và
                # thanh tiến trình trông như đứng im rồi nhảy lùi.
                updates = split_updates(chunk)
                latest = None  # chỉ bắn callback cho lần cập nhật MỚI NHẤT
                for line in updates:
                    clean_line = line.strip()
                    if not clean_line:
                        continue

                    # Send all raw internal details to debug file log
                    Logger.get_logger().debug(clean_line)

                    # 1. Parse progress updates
                    ev = reader.progress(line)
                    if ev:
                        latest = ev
                        continue
                    before = reader.part_index
                    reader.note_line(line)
                    if reader.part_index != before:
                        reader.force_next_emit()  # sang phần mới: báo ngay
                    self._handle_event(line, reader, progress_callback)
                    found = self._path_from_line(line)
                    if found:
                        final_path = found

                if latest and progress_callback and reader.should_emit():
                    # Có NHỊP: mỗi callback ghi SQLite, mà một lượt tải 17 giây
                    # sinh 2563 dòng tiến trình — báo hết là biến việc tải thành
                    # việc ghi DB. Giá phải trả: giá trị cuối cùng có thể bị bỏ,
                    # nên sự kiện "completed" sau process.wait() mới là thứ chốt
                    # 100%, không phải dòng tiến trình cuối.
                    progress_callback({
                        "status": "downloading",
                        "description": f"Downloading ({latest['size']})",
                        "completed": latest["percent"],
                        "speed": latest["speed"],
                        "eta": f"ETA {latest['eta']}" if latest["eta"] != "Unknown" else "--",
                    })
                continue

            # Giữ lại khối cũ cho tới khi vòng trên thay hết — không bao giờ chạy.
            process.wait()
            
            if process.returncode == 0:
                if "%(" in final_path or not os.path.exists(final_path):
                    safe_title = re.sub(r'[\\/*?:"<>|\n\r\t]', "", video_info.title).strip()
                    valid_exts = {'.mp4', '.mkv', '.webm', '.ts', '.m4v', '.mov', '.avi', '.flv'}
                    if os.path.exists(output_dir):
                        for f in os.listdir(output_dir):
                            if f.endswith('.part') or f.endswith('.ytdl') or f.endswith('.temp') or f.endswith('.webp'):
                                continue
                            base, ext = os.path.splitext(f)
                            if ext.lower() in valid_exts:
                                if safe_title and safe_title != "%(title)s" and (base == safe_title or safe_title in base):
                                    final_path = os.path.join(output_dir, f)
                                    break
                                if video_info.video_id and video_info.video_id in base:
                                    final_path = os.path.join(output_dir, f)
                                    break
                if final_path and os.path.exists(final_path):
                    with open(final_path, 'rb') as f:
                        header = f.read(4)
                    
                    if header == b'\x89PNG':
                        Logger.warning("Detected PNG-disguised MPEG-TS file. Cleaning up fake headers...")
                        with open(final_path, 'rb') as f:
                            data = f.read(1024)
                            iend_pos = data.find(b'IEND')
                            if iend_pos != -1:
                                ts_start = data.find(b'\x47', iend_pos)
                                if ts_start != -1:
                                    stripped_path = final_path + ".stripped.ts"
                                    # Strip exactly `ts_start` bytes
                                    os.system(f"tail -c +{ts_start + 1} '{final_path}' > '{stripped_path}'")
                                    
                                    clean_path = final_path.rsplit('.', 1)[0] + ".clean.mp4"
                                    # Remux with ffmpeg
                                    Logger.info("Remuxing cleaned TS stream into MP4...")
                                    os.system(f"ffmpeg -y -i '{stripped_path}' -c copy '{clean_path}' -loglevel error")
                                    
                                    if os.path.exists(clean_path) and os.path.getsize(clean_path) > 1000:
                                        os.remove(final_path)
                                        os.remove(stripped_path)
                                        final_path = clean_path
                                        Logger.info(f"Successfully cleaned and remuxed video: {final_path}")
                                    else:
                                        Logger.error("Failed to remux disguised video.")

                if progress_callback and final_path and os.path.exists(final_path):
                    elapsed = max(time.time() - start_time, 0.1)
                    avg_speed = format_speed(os.path.getsize(final_path) / elapsed)
                    progress_callback({
                        "status": "completed",
                        "description": "Download 100%",
                        "completed": 100.0,
                        "speed": avg_speed,
                        "eta": "--",
                        "output_path": final_path,
                    })

                return final_path
        except Exception as e:
            Logger.error(f"Error running yt-dlp: {e}", exc_info=True)
            return None
        finally:
            if info_file:
                # Xoá kể cả khi tải hỏng: file tạm sót lại là rác tích dần trong
                # /tmp, mà mỗi cái có thể vài trăm KB.
                try:
                    os.remove(info_file)
                except OSError:
                    pass
