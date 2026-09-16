import sqlite3

from utils import paths
import os
import re
from pathlib import Path
from typing import Optional
from datetime import datetime
from utils.logger import Logger
from ui.interactive import InteractivePrompt

class HistoryService:
    """
    Manages SQLite database connection and records download history.
    """
    def __init__(self, db_path: Optional[str] = None):
        if not db_path:
            db_path = str(paths.db_dir() / "history.db")
            
        self.db_path = db_path
        self._init_db()
        
    def _get_connection(self):
        return sqlite3.connect(self.db_path)
        
    def _init_db(self):
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS download_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        url TEXT NOT NULL,
                        m3u8_url TEXT,
                        format_id TEXT,
                        status TEXT NOT NULL,
                        output_path TEXT,
                        playlist_name TEXT,
                        source TEXT DEFAULT 'unknown',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                # Try to add playlist_name column if migrating from older version
                try:
                    cursor.execute("ALTER TABLE download_history ADD COLUMN playlist_name TEXT")
                except sqlite3.OperationalError:
                    pass

                # Migrate CSDL cũ: thêm cột source nếu chưa có. Không backfill —
                # không có cách nào biết ngược nguồn của bản ghi đã tồn tại.
                for table in ("download_history", "download_tasks"):
                    try:
                        cursor.execute(
                            f"ALTER TABLE {table} ADD COLUMN source TEXT DEFAULT 'unknown'"
                        )
                    except sqlite3.OperationalError:
                        pass

                # In-flight API task tracking (task_id, status, progress). Separate
                # table from download_history: this tracks the lifecycle of a
                # single background task (pending/downloading/cancelling/cancelled/
                # completed/failed), not the permanent record of a finished download.
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS download_tasks (
                        task_id TEXT PRIMARY KEY,
                        url TEXT NOT NULL,
                        title TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        progress REAL DEFAULT 0.0,
                        output_path TEXT,
                        error_msg TEXT,
                        avg_speed TEXT,
                        source TEXT DEFAULT 'unknown',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                try:
                    cursor.execute("ALTER TABLE download_tasks ADD COLUMN avg_speed TEXT")
                except sqlite3.OperationalError:
                    pass

                # Migrate and clean up existing dirty records
                cursor.execute("SELECT id, title, format_id, output_path FROM download_history")
                rows = cursor.fetchall()
                for row_id, title, fmt, out_path in rows:
                    updates = {}
                    # 1. Clean format_id
                    clean_fmt = InteractivePrompt.to_clean_resolution(fmt)
                    if clean_fmt != fmt:
                        updates['format_id'] = clean_fmt
                        
                    # 2. Clean output_path if containing template strings
                    clean_out = out_path
                    if clean_out and "%(" in clean_out:
                        clean_out = None
                        updates['output_path'] = clean_out
                        
                    # 3. Clean title if containing template strings
                    clean_title = title
                    if clean_title == "%(title)s" or "%(" in clean_title:
                        if clean_out:
                            clean_title = os.path.splitext(os.path.basename(clean_out))[0]
                        else:
                            clean_title = "Unknown Video"
                        updates['title'] = clean_title
                        
                    if updates:
                        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
                        values = list(updates.values()) + [row_id]
                        cursor.execute(f"UPDATE download_history SET {set_clause} WHERE id = ?", values)
                    
                conn.commit()
        except sqlite3.Error as e:
            Logger.error(f"Failed to initialize history database: {e}")
            
    def save_record(self, title: str, url: str, m3u8_url: str, format_id: Optional[str],
                    status: str, output_path: Optional[str], playlist_name: Optional[str] = None,
                    source: str = "unknown"):
        """
        Saves a clean download record to the SQLite database.
        """
        # Ensure clean format representation (e.g. '1080p', '720p', 'best')
        clean_format = InteractivePrompt.to_clean_resolution(format_id)
        
        # Ensure clean title
        clean_title = title
        if (not clean_title or "%(" in clean_title) and output_path and "%(" not in output_path:
            clean_title = os.path.splitext(os.path.basename(output_path))[0]
            
        # Ensure output_path is not a template string
        clean_path = output_path
        if clean_path and "%(" in clean_path:
            clean_path = None
            
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO download_history
                    (title, url, m3u8_url, format_id, status, output_path, playlist_name, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (clean_title, url, m3u8_url, clean_format, status, clean_path, playlist_name, source, datetime.now()))
                conn.commit()
                Logger.get_logger().debug(f"Download history saved: {status}")
        except sqlite3.Error as e:
            Logger.error(f"Failed to save history record: {e}")

    def create_task(self, task_id: str, url: str, source: str = "unknown") -> None:
        """Registers a new API download task in 'pending' state."""
        try:
            with self._get_connection() as conn:
                conn.execute(
                    "INSERT INTO download_tasks (task_id, url, status, source) VALUES (?, ?, 'pending', ?)",
                    (task_id, url, source),
                )
                conn.commit()
        except sqlite3.Error as e:
            Logger.error(f"Failed to create task record: {e}")

    def update_task(self, task_id: str, status: Optional[str] = None, progress: Optional[float] = None,
                     title: Optional[str] = None, output_path: Optional[str] = None,
                     error_msg: Optional[str] = None, avg_speed: Optional[str] = None) -> None:
        """Updates whichever fields are provided for an existing task."""
        updates = {"updated_at": datetime.now()}
        if status is not None:
            updates["status"] = status
        if progress is not None:
            updates["progress"] = progress
        if title is not None:
            updates["title"] = title
        if output_path is not None:
            updates["output_path"] = output_path
        if error_msg is not None:
            updates["error_msg"] = error_msg
        if avg_speed is not None:
            updates["avg_speed"] = avg_speed

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        try:
            with self._get_connection() as conn:
                conn.execute(
                    f"UPDATE download_tasks SET {set_clause} WHERE task_id = ?",
                    list(updates.values()) + [task_id],
                )
                conn.commit()
        except sqlite3.Error as e:
            Logger.error(f"Failed to update task record: {e}")

    def get_task(self, task_id: str) -> Optional[dict]:
        """Returns the current state of a task, or None if it doesn't exist."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("SELECT * FROM download_tasks WHERE task_id = ?", (task_id,))
                row = cursor.fetchone()
                return dict(row) if row else None
        except sqlite3.Error as e:
            Logger.error(f"Failed to read task record: {e}")
            return None

    TERMINAL_STATUSES = {"completed", "failed", "cancelled"}

    def get_active_tasks(self) -> list:
        """
        Mọi task chưa kết thúc, mới nhất trước.

        Bao gồm cả 'paused': nó chưa xong, và người dùng cần thấy để bấm tiếp tục.
        Đây là nguồn sự thật cho câu hỏi "đang có gì chạy" — cả cửa sổ app lẫn
        extension đều dựng lại trạng thái từ đây thay vì tự nhớ.
        """
        placeholders = ",".join("?" for _ in self.TERMINAL_STATUSES)
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    f"SELECT * FROM download_tasks WHERE status NOT IN ({placeholders})"
                    " ORDER BY created_at DESC",
                    tuple(self.TERMINAL_STATUSES),
                )
                return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            Logger.error(f"Failed to read active tasks: {e}")
            return []

    def get_history(self, limit: int = 50, source: Optional[str] = None) -> list:
        """
        Bản ghi tải gần nhất. `source=None` trả mọi nguồn — cửa sổ app dùng thế
        (D6); extension truyền 'extension' để chỉ lấy của nó.
        """
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                if source:
                    cursor = conn.execute(
                        "SELECT * FROM download_history WHERE source = ?"
                        " ORDER BY created_at DESC LIMIT ?",
                        (source, limit),
                    )
                else:
                    cursor = conn.execute(
                        "SELECT * FROM download_history ORDER BY created_at DESC LIMIT ?",
                        (limit,),
                    )
                return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            Logger.error(f"Failed to read history: {e}")
            return []

    def delete_record(self, record_id: int) -> Optional[str]:
        """Deletes one history record and returns its output_path (if any)."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT output_path FROM download_history WHERE id = ?", (record_id,)
                ).fetchone()
                conn.execute("DELETE FROM download_history WHERE id = ?", (record_id,))
                conn.commit()
                return row["output_path"] if row else None
        except sqlite3.Error as e:
            Logger.error(f"Failed to delete history record {record_id}: {e}")
            return None

    def clear_history(self) -> None:
        """Deletes all history records (does not touch files on disk)."""
        try:
            with self._get_connection() as conn:
                conn.execute("DELETE FROM download_history")
                conn.commit()
        except sqlite3.Error as e:
            Logger.error(f"Failed to clear history: {e}")

    def get_last_format_for_playlist(self, playlist_name: str) -> Optional[str]:
        """
        Retrieves the last successful format_id used for a given playlist.
        Returns the yt-dlp format selector string.
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT format_id FROM download_history
                    WHERE playlist_name = ? AND status = 'SUCCESS'
                    ORDER BY created_at DESC LIMIT 1
                ''', (playlist_name,))
                result = cursor.fetchone()
                if result and result[0]:
                    return InteractivePrompt.to_ytdlp_format(result[0])
        except sqlite3.Error as e:
            Logger.error(f"Failed to query history: {e}")
        return None
