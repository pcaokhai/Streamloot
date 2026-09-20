"""
Tên thư mục con theo site, để file tải về không dồn hết vào một chỗ.

Trước đây mọi video đổ chung vào `~/Downloads/downloader`, nên sau vài chục lượt
tải thì không còn tìm được gì. Giờ mỗi site một thư mục con.
"""
import re
from urllib.parse import urlparse

#: Tiền tố host không mang thông tin site, bỏ đi để `m.vidu.com` và `vidu.com`
#: không thành hai thư mục khác nhau.
_NOISE = ("www", "m", "mobile", "vn", "en", "video", "watch", "player")

#: Dùng khi không moi được gì từ URL. Có tên còn hơn đổ vào thư mục gốc, vì
#: thư mục gốc là chỗ người dùng nhìn thấy mọi lượt tải lẫn lộn.
FALLBACK = "khac"


def site_folder(url: str) -> str:
    """
    Tên thư mục cho một URL trang.

    Lấy nhãn đầu tiên có nghĩa của hostname: `www.vi-du.co.uk` -> `vi-du`.
    Không dùng danh sách site viết cứng — vừa không bao giờ đủ, vừa là thứ
    CLAUDE.md §3.1 cấm.
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        host = ""

    labels = [l for l in host.split(".") if l]
    # Bỏ tiền tố vô nghĩa ở ĐẦU, nhưng luôn chừa lại ít nhất một nhãn.
    while len(labels) > 1 and labels[0] in _NOISE:
        labels.pop(0)
    name = labels[0] if labels else ""

    # Chỉ giữ ký tự an toàn cho tên thư mục trên cả macOS lẫn Windows.
    name = re.sub(r"[^a-z0-9._-]", "", name).strip("._-")
    return name or FALLBACK
