import re

def extract_title_from_html(html: str, default_name: str) -> str:
    """
    Extract video title from raw HTML content.
    Supports reading from og:title or <title> tags.
    """
    og_title = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html)
    if og_title:
        title = og_title.group(1).strip()
    else:
        title_tag = re.search(r'<title>([^<]+)</title>', html)
        if title_tag:
            title = title_tag.group(1).strip()
        else:
            title = default_name

    return clean_title_for_filename(title) or default_name

def format_speed(bytes_per_sec: float) -> str:
    """
    Formats bytes/sec into a human string matching yt-dlp's own convention
    (binary/1024-based units, e.g. '5.81MiB/s').
    """
    if bytes_per_sec is None or bytes_per_sec <= 0:
        return "--"
    val = float(bytes_per_sec)
    for unit in ("B", "KiB", "MiB"):
        if val < 1024:
            return f"{val:.2f}{unit}/s"
        val /= 1024
    return f"{val:.2f}GiB/s"

def clean_title_for_filename(title: str, max_length: int = 150) -> str:
    """
    Remove special characters invalid for OS filenames
    and limit length to avoid FileNotFoundError (path too long).
    """
    # Remove control characters and OS forbidden characters
    clean_title = re.sub(r'[\\/*?:"<>|\n\r\t]', "", title).strip()
    return clean_title[:max_length]
