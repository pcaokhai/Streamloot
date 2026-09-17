import os
import logging
from datetime import datetime

from utils import paths
from rich.logging import RichHandler
from rich.console import Console
from rich.theme import Theme
from rich.text import Text
import re

def strip_ansi(text: str) -> str:
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

class CleanFileFormatter(logging.Formatter):
    """
    Formatter for FileHandler that strips Rich markup and ANSI escape codes.
    """
    def format(self, record: logging.LogRecord) -> str:
        # Create a copy or temporarily modify msg to strip rich tags
        original_msg = record.msg
        if isinstance(original_msg, str):
            try:
                # Use Rich to strip markup cleanly
                clean_text = Text.from_markup(strip_ansi(original_msg)).plain
                record.msg = clean_text
            except Exception:
                record.msg = strip_ansi(original_msg)
        
        result = super().format(record)
        record.msg = original_msg  # Restore original message
        return result

class Logger:
    """
    Production-grade Logger wrapper.
    - Console: Rich colorful UI output (INFO level).
    - File: Session log file (Default: ERROR level only, or DEBUG level if --debug is enabled).
    """
    _logger = None
    _console = None
    _file_handler = None
    _debug_mode = False

    # Keep constants for backwards compatibility
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

    @classmethod
    def init(cls, debug: bool = False):
        """
        Explicitly initialize the logger with debug flag.
        """
        cls._debug_mode = debug
        cls._init_logger()
        if cls._file_handler:
            # INFO chứ không phải ERROR cho file log.
            #
            # Để ERROR thì cả một phiên chạy chỉ để lại vài dòng, và mọi sự kiện
            # "đã bấm nút này, đã đi vào nhánh kia" đều biến mất — đúng lúc cần
            # tìm nguyên nhân thì không có gì để đọc. File log là thứ người dùng
            # gửi lại khi báo lỗi; nó phải kể được câu chuyện. Console vẫn sạch
            # vì đó là handler riêng.
            cls._file_handler.setLevel(logging.DEBUG if debug else logging.INFO)

    @classmethod
    def _init_logger(cls):
        if cls._logger is not None:
            return

        # Setup paths
        logs_dir = str(paths.logs_dir())

        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = os.path.join(logs_dir, f"session_{session_id}.log")

        # Configure rich console
        custom_theme = Theme({
            "info": "cyan",
            "warning": "yellow",
            "danger": "bold red",
            "success": "bold green"
        })
        cls._console = Console(theme=custom_theme)

        # Create logger
        cls._logger = logging.getLogger("Downloader")
        cls._logger.setLevel(logging.DEBUG) 
        cls._logger.propagate = False

        # File Handler: Only logs ERROR by default, or DEBUG if debug_mode is True.
        # delay=True ensures NO file is created on disk unless a record is actually emitted.
        cls._file_handler = logging.FileHandler(log_file, encoding='utf-8', delay=True)
        cls._file_handler.setLevel(logging.DEBUG if cls._debug_mode else logging.ERROR)
        
        file_format = CleanFileFormatter(
            fmt='[%(asctime)s] [%(levelname)s] [%(module)s:%(lineno)d] - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        cls._file_handler.setFormatter(file_format)

        # Rich Console Handler: Always INFO level for clean UI
        console_handler = RichHandler(
            console=cls._console,
            show_time=False,
            show_path=False,
            markup=True,
            rich_tracebacks=True
        )
        console_handler.setLevel(logging.INFO)

        cls._logger.addHandler(cls._file_handler)
        cls._logger.addHandler(console_handler)

    @classmethod
    def get_logger(cls):
        cls._init_logger()
        return cls._logger

    @classmethod
    def info(cls, msg: str):
        clean_msg = strip_ansi(msg)
        cls.get_logger().info(f"[info][*] {clean_msg}[/info]", stacklevel=2)

    @classmethod
    def success(cls, msg: str):
        clean_msg = strip_ansi(msg)
        cls.get_logger().info(f"[success][+] {clean_msg}[/success]", stacklevel=2)

    @classmethod
    def warning(cls, msg: str):
        clean_msg = strip_ansi(msg)
        cls.get_logger().warning(f"[warning][!] {clean_msg}[/warning]", stacklevel=2)

    @classmethod
    def error(cls, msg: str, exc_info=False):
        clean_msg = strip_ansi(msg)
        cls.get_logger().error(f"[danger][-] {clean_msg}[/danger]", stacklevel=2, exc_info=exc_info)

    @classmethod
    def divider(cls):
        cls._init_logger()
        cls._console.rule(style="magenta")

    @classmethod
    def plain(cls, msg: str):
        cls._init_logger()
        cls._console.print(msg)
        # If in debug mode, also record plain messages to the log file
        if cls._debug_mode and cls._file_handler:
            clean_msg = strip_ansi(msg).strip()
            if clean_msg:
                record = logging.LogRecord("Downloader", logging.INFO, "console", 0, clean_msg, None, None)
                cls._file_handler.emit(record)
