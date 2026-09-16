import re
from typing import Optional
from utils.logger import Logger

class InteractivePrompt:
    """
    Handles user interaction and CLI prompts for resolution selection.
    """
    
    # Tuple format: (Display Name, yt-dlp Format String, Clean Short Name)
    RESOLUTIONS = [
        ("4K (2160p)", "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best", "2160p"),
        ("2K (1440p)", "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best", "1440p"),
        ("Full HD (1080p)", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best", "1080p"),
        ("HD (720p)", "bestvideo[height<=720]+bestaudio/best[height<=720]/best", "720p"),
        ("SD (480p)", "bestvideo[height<=480]+bestaudio/best[height<=480]/best", "480p"),
        ("Low (360p)", "bestvideo[height<=360]+bestaudio/best[height<=360]/best", "360p"),
    ]
    
    @staticmethod
    def to_clean_resolution(format_str: Optional[str]) -> str:
        """
        Converts any raw format string into a clean resolution string like '720p', '1080p', 'best'.
        """
        if not format_str or format_str in ("best", "bestvideo+bestaudio/best"):
            return "best"
            
        for _, fmt, clean in InteractivePrompt.RESOLUTIONS:
            if format_str == fmt or format_str == clean:
                return clean
                
        # Regex matching height<=(\d+)
        match = re.search(r'height<=(\d+)', format_str)
        if match:
            return f"{match.group(1)}p"
            
        res_match = re.search(r'(\d{3,4}p)', format_str)
        if res_match:
            return res_match.group(1)
            
        return format_str

    @staticmethod
    def to_ytdlp_format(clean_res: Optional[str]) -> Optional[str]:
        """
        Converts a clean resolution like '720p' or 'best' back into yt-dlp format selector string.
        """
        if not clean_res or clean_res == "best":
            return "best"
            
        for _, fmt, clean in InteractivePrompt.RESOLUTIONS:
            if clean_res.lower() == clean.lower() or clean_res.lower() == fmt.lower():
                return fmt
                
        if clean_res.endswith('p') and clean_res[:-1].isdigit():
            h = clean_res[:-1]
            return f"bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"
            
        return clean_res

    @staticmethod
    def select_format() -> Optional[str]:
        Logger.plain("\n[bold magenta]=== Select Target Video Quality ===[/bold magenta]")
        Logger.plain("[cyan][0][/cyan] Best Quality (Default)")
        
        for idx, (name, _, _) in enumerate(InteractivePrompt.RESOLUTIONS, 1):
            Logger.plain(f"[cyan][{idx}][/cyan] {name}")
            
        while True:
            try:
                choice = input(f"\nSelect a resolution (0-{len(InteractivePrompt.RESOLUTIONS)}) [0]: ").strip()
                if not choice or choice == "0":
                    return "best"
                
                choice_idx = int(choice)
                if 1 <= choice_idx <= len(InteractivePrompt.RESOLUTIONS):
                    _, format_str, _ = InteractivePrompt.RESOLUTIONS[choice_idx - 1]
                    return format_str
                else:
                    Logger.error("Invalid choice. Try again.")
            except ValueError:
                Logger.error("Please enter a number.")
            except (KeyboardInterrupt, EOFError):
                raise KeyboardInterrupt
