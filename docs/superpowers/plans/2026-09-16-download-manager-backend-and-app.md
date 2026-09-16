# Nền tảng download manager: backend + app macOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend ghi nhận nguồn của mỗi download và phơi ra danh sách task đang chạy; cửa sổ app và menu bar hiển thị mọi download bất kể nguồn nào khởi động.

**Architecture:** Thêm cột `source` vào hai bảng SQLite theo đúng pattern migration đã dùng (`ALTER TABLE ... ADD COLUMN` bọc trong `try`). Thêm `GET /api/v1/downloads/active` làm nguồn sự thật duy nhất cho "đang có gì chạy" — cả cửa sổ app lẫn extension (plan 2) đều dựa vào nó. Cửa sổ app bỏ `localStorage` và đọc thẳng từ endpoint này. Menu bar chuyển từ menu tĩnh sang menu dựng lại mỗi lần mở qua `NSMenuDelegate`.

**Tech Stack:** Python 3.12, FastAPI, SQLite (`sqlite3` thuần), pyobjc/AppKit, React 18 + TypeScript 5.7, unittest.

**Spec:** [`docs/superpowers/specs/2026-09-16-extension-download-manager-design.md`](../specs/2026-09-16-extension-download-manager-design.md)

## Global Constraints

- Chạy test: `uv run python -m unittest discover -s tests -p "test_*.py"`. Toàn bộ suite phải xanh sau mỗi task.
- Test API gọi **thẳng hàm endpoint**, không dùng `TestClient` (repo chưa có `httpx2`). Theo pattern ở `tests/test_api_cancel.py`.
- `os.environ.setdefault("API_KEY", "test-key")` phải đặt **trước** khi import `apps.api.main` — module đọc biến này lúc import.
- `core/`, `downloaders/`, `services/`, `utils/` **không được import thư viện UI** (`CLAUDE.md` §3.2).
- Không dùng `print()` trong `core/` và `services/` — dùng `Logger` từ `utils.logger`.
- Không đưa tên miền của bất kỳ site nào vào file được track. Kiểm trước mỗi commit:
  `git ls-files | xargs grep -lif .privacy-patterns` phải trống. File `.privacy-patterns`
  được gitignore và sinh từ chính `SUPPORTED_DOMAINS` của các plugin riêng tư — nên
  bản thân lệnh kiểm không chứa thứ nó đi tìm.
- TypeScript của cửa sổ app: `cd apps/desktop/ui && npx tsc --noEmit` phải exit 0.
- Giá trị hợp lệ của `source`: `cli`, `desktop`, `extension`, `unknown`.
- Trạng thái kết thúc: `HistoryService.TERMINAL_STATUSES = {"completed", "failed", "cancelled"}`.

---

## File Structure

| File | Trách nhiệm | Thay đổi |
|---|---|---|
| `services/history_service.py` | Truy cập SQLite | Thêm cột `source` + migration; `save_record`/`create_task` nhận `source`; thêm `get_active_tasks()`; `get_history()` nhận `source` lọc |
| `services/download_service.py` | Điều phối tải | Truyền `source` xuống `save_record` |
| `apps/api/main.py` | REST + SSE | Thêm `GET /downloads/active`; `source` vào request schema; `?source=` cho `/history` |
| `apps/desktop/statusbar.py` | Icon menu bar | Tách phần dựng menu ra; thêm `NSMenuDelegate` |
| `apps/desktop/statusbar_menu.py` | **Mới** — dựng nội dung menu | Đọc `HistoryService`, dựng item theo trạng thái |
| `apps/desktop/ui/src/api.ts` | Client HTTP | Thêm `getActiveTasks()`; `getHistory()` nhận `source` |
| `apps/desktop/ui/src/hooks/useTasks.ts` | Trạng thái task ở UI | Bỏ `localStorage`; khôi phục từ `/downloads/active` |
| `apps/desktop/ui/src/components/HistoryTable.tsx` | Bảng lịch sử | Thêm cột nguồn |
| `tests/test_history_source.py` | **Mới** | Migration, `source`, lọc |
| `tests/test_api_active.py` | **Mới** | `/downloads/active` |
| `tests/test_statusbar_menu.py` | **Mới** | Logic dựng menu (thuần, không đụng AppKit) |

---

## Task 1: Cột `source` trong SQLite

**Files:**
- Modify: `services/history_service.py:26-105` (schema + migration), `:106-135` (`save_record`), `:136-147` (`create_task`)
- Test: `tests/test_history_source.py` (tạo mới)

**Interfaces:**
- Consumes: không có
- Produces:
  - `HistoryService.save_record(..., source: str = "unknown")`
  - `HistoryService.create_task(task_id: str, url: str, source: str = "unknown")`
  - Cột `source TEXT DEFAULT 'unknown'` trên `download_history` và `download_tasks`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/test_history_source.py`:

```python
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.history_service import HistoryService


class TestSourceColumn(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def _columns(self, table):
        with sqlite3.connect(self.tmp.name) as conn:
            return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}

    def test_both_tables_have_source_column(self):
        self.assertIn("source", self._columns("download_history"))
        self.assertIn("source", self._columns("download_tasks"))

    def test_save_record_stores_source(self):
        self.svc.save_record(
            title="T", url="u", m3u8_url="m", format_id="best",
            status="SUCCESS", output_path="/tmp/f.mp4", source="extension",
        )
        self.assertEqual(self.svc.get_history()[0]["source"], "extension")

    def test_save_record_defaults_to_unknown(self):
        self.svc.save_record(
            title="T", url="u", m3u8_url="m", format_id="best",
            status="SUCCESS", output_path="/tmp/f.mp4",
        )
        self.assertEqual(self.svc.get_history()[0]["source"], "unknown")

    def test_create_task_stores_source(self):
        self.svc.create_task("t1", "https://x.test/v", source="desktop")
        self.assertEqual(self.svc.get_task("t1")["source"], "desktop")


class TestMigrationOnExistingDb(unittest.TestCase):
    def test_adds_column_to_db_created_without_it(self):
        """CSDL đã có dữ liệu từ bản cũ phải migrate được, không mất bản ghi."""
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        # Dựng bảng theo schema CŨ, không có cột source.
        with sqlite3.connect(tmp.name) as conn:
            conn.execute("""
                CREATE TABLE download_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL, url TEXT NOT NULL, m3u8_url TEXT,
                    format_id TEXT, status TEXT NOT NULL, output_path TEXT,
                    playlist_name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "INSERT INTO download_history (title, url, status) VALUES ('cũ', 'u', 'SUCCESS')"
            )
            conn.commit()

        svc = HistoryService(db_path=tmp.name)
        rows = svc.get_history()
        self.assertEqual(len(rows), 1, "bản ghi cũ không được mất")
        self.assertEqual(rows[0]["title"], "cũ")
        # Không backfill: không có cách nào biết ngược nguồn của bản ghi cũ.
        self.assertIn(rows[0]["source"], (None, "unknown"))
        os.unlink(tmp.name)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_history_source -v`
Expected: FAIL — `'source'` không có trong `PRAGMA table_info`, và `save_record()` không nhận tham số `source`.

- [ ] **Step 3: Thêm cột vào schema và migration**

Trong `services/history_service.py`, thêm `source` vào câu `CREATE TABLE download_history`:

```python
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
```

Ngay sau khối migration `playlist_name` đã có, thêm migration cho `source` theo đúng pattern:

```python
                # Migrate CSDL cũ: thêm cột source nếu chưa có. Không backfill —
                # không có cách nào biết ngược nguồn của bản ghi đã tồn tại.
                for table in ("download_history", "download_tasks"):
                    try:
                        cursor.execute(
                            f"ALTER TABLE {table} ADD COLUMN source TEXT DEFAULT 'unknown'"
                        )
                    except sqlite3.OperationalError:
                        pass
```

Và thêm `source` vào `CREATE TABLE download_tasks`:

```python
                        avg_speed TEXT,
                        source TEXT DEFAULT 'unknown',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
```

- [ ] **Step 4: Cho `save_record` và `create_task` nhận `source`**

Đổi chữ ký `save_record` (dòng ~106):

```python
    def save_record(self, title: str, url: str, m3u8_url: str, format_id: Optional[str],
                    status: str, output_path: Optional[str], playlist_name: Optional[str] = None,
                    source: str = "unknown"):
```

Đổi câu INSERT trong nó:

```python
                cursor.execute('''
                    INSERT INTO download_history 
                    (title, url, m3u8_url, format_id, status, output_path, playlist_name, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (clean_title, url, m3u8_url, clean_format, status, clean_path,
                      playlist_name, source, datetime.now()))
```

Đổi `create_task` (dòng ~136):

```python
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
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `uv run python -m unittest tests.test_history_source -v`
Expected: PASS, 5 test.

- [ ] **Step 6: Chạy toàn bộ suite**

Run: `uv run python -m unittest discover -s tests -p "test_*.py"`
Expected: OK. Test cũ không được hỏng — `source` có giá trị mặc định nên mọi lời gọi hiện có vẫn chạy.

- [ ] **Step 7: Commit**

```bash
git add services/history_service.py tests/test_history_source.py
git commit -m "feat(db): thêm cột source cho download_history và download_tasks

Không backfill bản ghi cũ: không có cách nào biết ngược nguồn của chúng.
Migration theo đúng pattern ALTER TABLE ADD COLUMN bọc trong try đã dùng cho
playlist_name."
```

---

## Task 2: `get_active_tasks()` và lọc lịch sử theo nguồn

**Files:**
- Modify: `services/history_service.py` (thêm `get_active_tasks`, sửa `get_history`)
- Test: `tests/test_history_source.py` (thêm class)

**Interfaces:**
- Consumes: cột `source` từ Task 1
- Produces:
  - `HistoryService.get_active_tasks() -> list[dict]` — mọi task **không** ở `TERMINAL_STATUSES`, mới nhất trước
  - `HistoryService.get_history(limit: int = 50, source: Optional[str] = None) -> list[dict]`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/test_history_source.py`, trước `if __name__`:

```python
class TestActiveAndFilter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_active_excludes_terminal_statuses(self):
        self.svc.create_task("running", "u1")
        self.svc.create_task("done", "u2")
        self.svc.update_task("running", status="downloading")
        self.svc.update_task("done", status="completed")

        ids = {t["task_id"] for t in self.svc.get_active_tasks()}
        self.assertIn("running", ids)
        self.assertNotIn("done", ids)

    def test_active_includes_paused(self):
        """Task tạm dừng chưa kết thúc — người dùng cần thấy để bấm tiếp tục."""
        self.svc.create_task("held", "u")
        self.svc.update_task("held", status="paused")
        self.assertIn("held", {t["task_id"] for t in self.svc.get_active_tasks()})

    def test_active_includes_pending(self):
        self.svc.create_task("waiting", "u")
        self.assertIn("waiting", {t["task_id"] for t in self.svc.get_active_tasks()})

    def test_active_carries_source(self):
        self.svc.create_task("x", "u", source="extension")
        self.svc.update_task("x", status="downloading")
        self.assertEqual(self.svc.get_active_tasks()[0]["source"], "extension")

    def test_history_filters_by_source(self):
        for src in ("extension", "desktop", "cli"):
            self.svc.save_record(title=src, url="u", m3u8_url="m", format_id="best",
                                 status="SUCCESS", output_path="/tmp/f", source=src)

        only_ext = self.svc.get_history(source="extension")
        self.assertEqual(len(only_ext), 1)
        self.assertEqual(only_ext[0]["source"], "extension")

    def test_history_without_filter_returns_all_sources(self):
        """Cửa sổ app hiện mọi nguồn (D6)."""
        for src in ("extension", "desktop", "cli"):
            self.svc.save_record(title=src, url="u", m3u8_url="m", format_id="best",
                                 status="SUCCESS", output_path="/tmp/f", source=src)
        self.assertEqual(len(self.svc.get_history()), 3)
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_history_source -v`
Expected: FAIL — `AttributeError: 'HistoryService' object has no attribute 'get_active_tasks'`.

- [ ] **Step 3: Cài đặt**

Thêm vào `services/history_service.py`, ngay sau `get_task`:

```python
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
```

Sửa `get_history`:

```python
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
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `uv run python -m unittest tests.test_history_source -v`
Expected: PASS, 11 test.

- [ ] **Step 5: Chạy toàn bộ suite**

Run: `uv run python -m unittest discover -s tests -p "test_*.py"`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add services/history_service.py tests/test_history_source.py
git commit -m "feat(db): get_active_tasks() và lọc lịch sử theo nguồn

get_active_tasks trả cả task paused: nó chưa kết thúc và người dùng cần thấy để
bấm tiếp tục. Đây là nguồn sự thật cho 'đang có gì chạy' — client dựng lại trạng
thái từ đây thay vì tự nhớ."
```

---

## Task 3: Ghi `source` xuyên suốt luồng tải

**Files:**
- Modify: `services/download_service.py:196`, `:276` (hai lời gọi `save_record`), chữ ký `process_url` và `process_video_infos`
- Test: `tests/test_api_stage2.py` (thêm test)

**Interfaces:**
- Consumes: `save_record(..., source=)` từ Task 1
- Produces: `DownloadService.process_url(..., source: str = "unknown")` và `process_video_infos(..., source: str = "unknown")`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/test_api_stage2.py`, trong `class TestPreparedDownload`:

```python
    def test_source_flows_through_to_history(self):
        """Nguồn phải đi hết đường từ lời gọi tới bản ghi lịch sử."""
        from services.download_service import DownloadService

        svc = DownloadService()
        vi = api_main.VideoInfoPayload(**PAYLOAD).to_video_info()
        with patch.object(svc.downloader, "download", return_value="/tmp/out.mp4"), \
             patch("services.download_service.sync_archive_with_disk"), \
             patch("services.download_service.is_video_on_disk", return_value=False), \
             patch.object(svc.history, "save_record") as save:
            svc.process_video_infos([vi], interactive=False, source="extension")

        self.assertEqual(save.call_args.kwargs["source"], "extension")
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_api_stage2 -v -k test_source_flows`
Expected: FAIL — `process_video_infos() got an unexpected keyword argument 'source'`.

- [ ] **Step 3: Thêm tham số vào cả hai hàm**

Trong `services/download_service.py`, thêm `source: str = "unknown"` vào chữ ký `process_url` và `process_video_infos`. Trong `process_url`, truyền tiếp xuống:

```python
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
```

- [ ] **Step 4: Truyền `source` vào cả hai lời gọi `save_record`**

Tại `:196` (nhánh một video) và `:276` (nhánh playlist), thêm đối số cuối:

```python
                playlist_name=None,
                source=source,
            )
```

và tương ứng ở nhánh playlist:

```python
                playlist_name=video_info.playlist_name,
                source=source,
            )
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `uv run python -m unittest tests.test_api_stage2 -v`
Expected: PASS.

- [ ] **Step 6: Chạy toàn bộ suite**

Run: `uv run python -m unittest discover -s tests -p "test_*.py"`
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add services/download_service.py tests/test_api_stage2.py
git commit -m "feat(services): truyền source xuyên suốt tới bản ghi lịch sử"
```

---

## Task 4: `GET /api/v1/downloads/active` và `?source=` cho `/history`

**Files:**
- Modify: `apps/api/main.py` (endpoint `/downloads/active`, `get_history`, `DownloadRequest`, hai hàm `run_*_task`, hai endpoint tạo download)
- Test: `tests/test_api_active.py` (tạo mới)

**Interfaces:**
- Consumes: `HistoryService.get_active_tasks()`, `get_history(source=)` từ Task 2; `DownloadService.process_*(source=)` từ Task 3
- Produces:
  - `GET /api/v1/downloads/active` → `{"tasks": [ ... ]}`
  - `GET /api/v1/history?source=extension`
  - `DownloadRequest.source: Optional[str]`
  - `/downloads/prepared` luôn ghi `source="extension"`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/test_api_active.py`:

```python
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.api import main as api_main


class TestActiveEndpoint(unittest.TestCase):
    def test_returns_active_tasks(self):
        rows = [{"task_id": "a", "status": "downloading", "source": "extension"}]
        with patch.object(api_main.history, "get_active_tasks", return_value=rows):
            out = api_main.get_active_downloads()
        self.assertEqual(out["tasks"], rows)

    def test_returns_empty_list_when_nothing_runs(self):
        with patch.object(api_main.history, "get_active_tasks", return_value=[]):
            self.assertEqual(api_main.get_active_downloads()["tasks"], [])


class TestHistoryFilter(unittest.TestCase):
    def test_passes_source_through(self):
        with patch.object(api_main.history, "get_history", return_value=[]) as gh:
            api_main.get_history(source="extension")
        self.assertEqual(gh.call_args.kwargs["source"], "extension")

    def test_no_source_means_all(self):
        with patch.object(api_main.history, "get_history", return_value=[]) as gh:
            api_main.get_history()
        self.assertIsNone(gh.call_args.kwargs["source"])


class TestSourceOnCreate(unittest.TestCase):
    def test_prepared_endpoint_marks_extension(self):
        import asyncio

        req = api_main.PreparedDownloadRequest(
            video_info=api_main.VideoInfoPayload(
                title="t", m3u8_url="https://c.test/m.m3u8", page_url="https://p.test/v"
            )
        )
        with patch.object(api_main.history, "create_task") as create:
            asyncio.run(api_main.start_prepared_download(req, MagicMock()))
        self.assertEqual(create.call_args.kwargs["source"], "extension")

    def test_url_endpoint_defaults_to_unknown(self):
        import asyncio

        req = api_main.DownloadRequest(url="https://p.test/v")
        with patch.object(api_main.history, "create_task") as create:
            asyncio.run(api_main.start_download(req, MagicMock()))
        self.assertEqual(create.call_args.kwargs["source"], "unknown")

    def test_url_endpoint_accepts_explicit_source(self):
        import asyncio

        req = api_main.DownloadRequest(url="https://p.test/v", source="desktop")
        with patch.object(api_main.history, "create_task") as create:
            asyncio.run(api_main.start_download(req, MagicMock()))
        self.assertEqual(create.call_args.kwargs["source"], "desktop")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_api_active -v`
Expected: FAIL — `module 'apps.api.main' has no attribute 'get_active_downloads'`.

- [ ] **Step 3: Thêm endpoint `/downloads/active`**

Trong `apps/api/main.py`, đặt **trước** `@app.get("/api/v1/downloads/{task_id}")` — nếu đặt sau, `active` sẽ bị khớp vào `{task_id}`:

```python
@app.get("/api/v1/downloads/active", dependencies=[Depends(verify_client)])
def get_active_downloads():
    """
    Mọi task chưa kết thúc, gồm cả `paused`.

    Nguồn sự thật cho "đang có gì chạy". Client dựng lại trạng thái từ đây sau
    khi khởi động lại thay vì tự nhớ — xem spec D1 và D6.
    """
    return {"tasks": history.get_active_tasks()}
```

- [ ] **Step 4: Thêm `?source=` cho `/history`**

```python
@app.get("/api/v1/history", dependencies=[Depends(verify_client)])
def get_history(source: Optional[str] = None):
    # source=None trả mọi nguồn — cửa sổ app dùng thế (D6).
    return history.get_history(limit=50, source=source)
```

- [ ] **Step 5: Ghi `source` khi tạo task**

Thêm trường vào `DownloadRequest`:

```python
class DownloadRequest(BaseModel):
    url: str
    concurrency: int = 4
    output_dir: Optional[str] = None
    format_id: Optional[str] = None
    source: Optional[str] = None
```

Trong `start_download`, đổi lời gọi `create_task`:

```python
    history.create_task(task_id, req.url, source=req.source or "unknown")
```

Trong `start_prepared_download`:

```python
    history.create_task(task_id, req.video_info.page_url, source="extension")
```

Trong `run_download_task`, truyền `source` xuống service:

```python
            service.process_url(
                url=req.url,
                concurrency=req.concurrency,
                output_dir=req.output_dir,
                interactive=False,
                format_id=req.format_id,
                progress_callback=progress_callback,
                task_id=task_id,
                process_callback=process_callback,
                source=req.source or "unknown",
            )
```

Trong `run_prepared_task`:

```python
                process_callback=process_callback,
                source="extension",
            )
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `uv run python -m unittest tests.test_api_active -v`
Expected: PASS, 7 test.

- [ ] **Step 7: Kiểm tra thứ tự route**

Run:
```bash
API_KEY=x uv run python -c "
from apps.api.main import app
print([r.path for r in app.routes if 'downloads' in getattr(r,'path','')])
"
```
Expected: `/api/v1/downloads/active` xuất hiện **trước** `/api/v1/downloads/{task_id}`.

- [ ] **Step 8: Chạy toàn bộ suite**

Run: `uv run python -m unittest discover -s tests -p "test_*.py"`
Expected: OK.

- [ ] **Step 9: Commit**

```bash
git add apps/api/main.py tests/test_api_active.py
git commit -m "feat(api): GET /downloads/active và lọc lịch sử theo nguồn

/downloads/active phải khai TRƯỚC /downloads/{task_id}, nếu không FastAPI khớp
'active' thành một task_id."
```

---

## Task 5: Menu bar dựng lại mỗi lần mở

**Files:**
- Create: `apps/desktop/statusbar_menu.py`
- Modify: `apps/desktop/statusbar.py`
- Test: `tests/test_statusbar_menu.py` (tạo mới)

**Interfaces:**
- Consumes: `HistoryService.get_active_tasks()` từ Task 2
- Produces: `build_menu_model(active_tasks: list[dict]) -> dict` — mô tả thuần Python nội dung menu, không đụng AppKit

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/test_statusbar_menu.py`:

```python
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.desktop.statusbar_menu import build_menu_model


class TestMenuModel(unittest.TestCase):
    """
    Tách phần quyết định NỘI DUNG menu khỏi phần dựng NSMenu, để test được mà
    không cần AppKit và không cần chạy vòng lặp giao diện.
    """

    def test_no_downloads_hides_the_progress_block(self):
        model = build_menu_model([])
        self.assertIsNone(model["download"])

    def test_shows_most_recent_task(self):
        """get_active_tasks trả mới nhất trước, nên lấy phần tử đầu."""
        model = build_menu_model([
            {"task_id": "new", "title": "Mới", "status": "downloading", "progress": 10.0},
            {"task_id": "old", "title": "Cũ", "status": "downloading", "progress": 90.0},
        ])
        self.assertEqual(model["download"]["task_id"], "new")

    def test_downloading_offers_pause(self):
        model = build_menu_model(
            [{"task_id": "a", "title": "T", "status": "downloading", "progress": 42.0}]
        )
        self.assertEqual(model["download"]["action"], "pause")
        self.assertIn("42%", model["download"]["label"])

    def test_paused_offers_resume(self):
        model = build_menu_model(
            [{"task_id": "a", "title": "T", "status": "paused", "progress": 42.0}]
        )
        self.assertEqual(model["download"]["action"], "resume")
        self.assertIn("Tạm dừng", model["download"]["label"])

    def test_long_title_is_truncated(self):
        model = build_menu_model(
            [{"task_id": "a", "title": "x" * 200, "status": "downloading", "progress": 1.0}]
        )
        self.assertLessEqual(len(model["download"]["label"]), 60)

    def test_missing_title_does_not_crash(self):
        """Task vừa tạo chưa có title — không được ném."""
        model = build_menu_model(
            [{"task_id": "a", "title": None, "status": "pending", "progress": None}]
        )
        self.assertIsNotNone(model["download"]["label"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_statusbar_menu -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.desktop.statusbar_menu'`.

- [ ] **Step 3: Tạo `apps/desktop/statusbar_menu.py`**

```python
"""
Quyết định NỘI DUNG menu bar, tách khỏi phần dựng NSMenu.

Tách ra để test được mà không cần AppKit và không cần chạy vòng lặp giao diện —
`statusbar.py` lo phần Objective-C, file này lo phần logic.
"""
from typing import Optional

MAX_LABEL = 44


def build_menu_model(active_tasks: list) -> dict:
    """
    Dựng mô tả menu từ danh sách task đang chạy.

    Chỉ hiện MỘT task — task khởi động gần nhất, tức phần tử đầu của
    `get_active_tasks()` (đã sắp xếp mới nhất trước). Menu bar để liếc, danh sách
    đầy đủ nằm ở cửa sổ app.

    Returns:
        {"download": None} khi không có gì chạy, hoặc
        {"download": {"task_id", "label", "action"}} với action là 'pause'|'resume'.
    """
    if not active_tasks:
        return {"download": None}

    task = active_tasks[0]
    title = (task.get("title") or "Đang chuẩn bị…").strip()
    if len(title) > MAX_LABEL:
        title = title[: MAX_LABEL - 1] + "…"

    if task.get("status") == "paused":
        label = f"{title} — Tạm dừng"
        action = "resume"
    else:
        progress = task.get("progress")
        pct = f"{int(progress)}%" if isinstance(progress, (int, float)) else "…"
        label = f"{title} — {pct}"
        action = "pause"

    return {"download": {"task_id": task["task_id"], "label": label, "action": action}}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `uv run python -m unittest tests.test_statusbar_menu -v`
Expected: PASS, 6 test.

- [ ] **Step 5: Nối vào `statusbar.py` bằng `NSMenuDelegate`**

Trong `apps/desktop/statusbar.py`, thay phần dựng menu tĩnh. Thêm lớp delegate:

```python
class _MenuDelegate(AppKit.NSObject):
    """
    macOS gọi menuNeedsUpdate_ NGAY TRƯỚC khi hiện menu, nên menu bar lấy dữ
    liệu tươi mà không cần poll gì cả — khác hẳn panel và popup của extension.

    Menu cũ được dựng một lần lúc cài nên nội dung đóng băng vĩnh viễn.
    """

    def initWithBuilder_(self, builder):
        self = objc.super(_MenuDelegate, self).init()
        if self is None:
            return None
        self._builder = builder
        return self

    def menuNeedsUpdate_(self, menu):
        self._builder(menu)
```

Đổi `_build` để nhận callbacks tải và gắn delegate:

```python
def _build(on_show, on_quit, port, title, task_actions):
    try:
        bar = AppKit.NSStatusBar.systemStatusBar()
        item = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)

        button = item.button()
        if button is not None:
            button.setTitle_(title)
            button.setToolTip_("Streamloot — backend đang chạy")

        target = _Target.alloc().initWithHandlers_({
            'show': on_show,
            'quit': on_quit,
            'task': task_actions,
        })
        menu = AppKit.NSMenu.alloc().init()

        def rebuild(m):
            m.removeAllItems()
            _populate(m, target, port, task_actions['list']())

        delegate = _MenuDelegate.alloc().initWithBuilder_(rebuild)
        menu.setDelegate_(delegate)
        rebuild(menu)

        item.setMenu_(menu)
        _keepalive.extend([item, target, menu, delegate])
        Logger.get_logger().debug("Menu bar item installed")
    except Exception as e:
        Logger.error(f"Không dựng được menu bar item: {e}", exc_info=True)
```

Thêm hàm `_populate` dùng model từ Task 5:

```python
def _populate(menu, target, port, active_tasks):
    from apps.desktop.statusbar_menu import build_menu_model

    model = build_menu_model(active_tasks)
    dl = model["download"]

    if dl is not None:
        info = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            dl["label"], "", ""
        )
        info.setEnabled_(False)
        menu.addItem_(info)

        label = "Tiếp tục" if dl["action"] == "resume" else "Tạm dừng"
        toggle = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            label, "onToggle:", ""
        )
        toggle.setTarget_(target)
        toggle.setRepresentedObject_(dl["task_id"])
        menu.addItem_(toggle)

        cancel = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Huỷ", "onCancel:", ""
        )
        cancel.setTarget_(target)
        cancel.setRepresentedObject_(dl["task_id"])
        menu.addItem_(cancel)

        menu.addItem_(AppKit.NSMenuItem.separatorItem())

    show = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        "Mở cửa sổ Streamloot", "onShow:", ""
    )
    show.setTarget_(target)
    menu.addItem_(show)
    menu.addItem_(AppKit.NSMenuItem.separatorItem())

    status = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        f"Backend: 127.0.0.1:{port}", "", ""
    )
    status.setEnabled_(False)
    menu.addItem_(status)
    menu.addItem_(AppKit.NSMenuItem.separatorItem())

    quit_item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
        "Thoát Streamloot", "onQuit:", "q"
    )
    quit_item.setTarget_(target)
    menu.addItem_(quit_item)
```

Thêm hai selector vào `_Target`:

```python
    def onToggle_(self, sender):
        self._handlers['task']['toggle'](sender.representedObject())

    def onCancel_(self, sender):
        self._handlers['task']['cancel'](sender.representedObject())
```

- [ ] **Step 6: Nối callbacks trong `apps/desktop/main.py`**

Trong `on_loop_started`, truyền các hàm gọi **thẳng service**, không qua HTTP — app đang ở cùng tiến trình:

```python
    def on_loop_started():
        from services.history_service import HistoryService

        hist = HistoryService()

        def toggle(task_id):
            task = hist.get_task(task_id)
            if not task:
                return
            # Gọi thẳng endpoint dưới dạng hàm: cùng tiến trình, đi vòng qua HTTP
            # của chính mình là thừa.
            from apps.api.main import pause_download, resume_download
            (resume_download if task["status"] == "paused" else pause_download)(task_id)

        def cancel(task_id):
            from apps.api.main import cancel_download
            cancel_download(task_id)

        statusbar.install(
            on_show=show_window,
            on_quit=quit_app,
            port=DESKTOP_PORT,
            task_actions={"list": hist.get_active_tasks, "toggle": toggle, "cancel": cancel},
        )
```

Cập nhật chữ ký `statusbar.install` để nhận `task_actions` và chuyển tiếp xuống `_build`.

- [ ] **Step 7: Chạy toàn bộ suite**

Run: `uv run python -m unittest discover -s tests -p "test_*.py"`
Expected: OK.

- [ ] **Step 8: Kiểm tra bằng tay trên app đã đóng gói**

```bash
./build_app.sh && pkill -f "Streamloot.app/Contents/MacOS/Streamloot"; open dist/Streamloot.app
```

Bắt đầu một download, mở menu bar: phải thấy tên video kèm phần trăm, bấm **Tạm dừng** phải đổi thành **Tiếp tục**. Tải xong, mở lại: khối download phải biến mất hoàn toàn.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/statusbar.py apps/desktop/statusbar_menu.py apps/desktop/main.py tests/test_statusbar_menu.py
git commit -m "feat(desktop): menu bar hiện tiến trình và điều khiển được

Menu cũ dựng một lần lúc cài nên nội dung đóng băng vĩnh viễn. Thêm NSMenuDelegate
với menuNeedsUpdate_: macOS gọi nó ngay trước khi hiện menu, nên menu bar lấy dữ
liệu tươi mà KHÔNG cần poll gì cả.

Tách build_menu_model ra statusbar_menu.py để test được mà không cần AppKit."
```

---

## Task 6: Cửa sổ app thấy mọi download, bỏ `localStorage`

**Files:**
- Modify: `apps/desktop/ui/src/api.ts`, `apps/desktop/ui/src/hooks/useTasks.ts:1-20` (bỏ storage helpers), `:62-100` (khôi phục)
- Test: kiểm tra bằng `tsc` + thủ công (repo chưa có hạ tầng test cho UI React)

**Interfaces:**
- Consumes: `GET /api/v1/downloads/active` từ Task 4
- Produces: `api.getActiveTasks(): Promise<{tasks: TaskRecord[]} | null>`

- [ ] **Step 1: Thêm hàm API**

Trong `apps/desktop/ui/src/api.ts`:

```typescript
/**
 * Mọi task chưa kết thúc, bất kể nguồn nào khởi động — cửa sổ app, extension
 * hay CLI. Thay hoàn toàn cho việc tự nhớ danh sách task id trong localStorage:
 * backend đã biết, client chỉ phản chiếu.
 */
export function getActiveTasks(): Promise<{ tasks: TaskRecord[] } | null> {
  return request<{ tasks: TaskRecord[] }>("/downloads/active");
}
```

- [ ] **Step 2: Bỏ phần lưu `localStorage`**

Trong `apps/desktop/ui/src/hooks/useTasks.ts`, xoá `STORAGE_KEY`, `loadStoredTaskIds`, `saveStoredTaskIds`, và cả `useEffect` gọi `saveStoredTaskIds`.

- [ ] **Step 3: Khôi phục từ `/downloads/active`**

Thay effect khôi phục bằng:

```typescript
  const hydrate = useCallback(async () => {
    const res = await api.getActiveTasks();
    if (!res) return;
    for (const t of res.tasks) {
      setTasks((prev) => ({
        ...prev,
        [t.task_id]: {
          url: t.url,
          title: t.title,
          status: t.status,
          completed: t.progress,
          speed: t.avg_speed ?? "--",
          formatId: null,
          outputPath: t.output_path,
        },
      }));
      // Task này có thể do extension hoặc CLI khởi động, nên ta không có token.
      // Xin một cái mới — cơ chế đã có sẵn cho đường khôi phục sau khi mở lại app.
      const tok = await api.refreshStreamToken(t.task_id);
      if (tok?.stream_token) attachStream(t.task_id, tok.stream_token);
    }
  }, [attachStream]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);
```

- [ ] **Step 4: Làm mới khi cửa sổ hiện lại**

Trong `apps/desktop/main.py`, hàm `show_window`, bắn một sự kiện xuống trang sau khi hiện:

```python
    def show_window():
        window.show()
        statusbar.set_dock_icon(True)
        statusbar.activate()
        # B2 cho phép ẩn cửa sổ mà app vẫn chạy, nên ẩn xong mở lại có thể đã
        # khác rất nhiều — bảo trang dựng lại danh sách.
        window.evaluate_js("window.dispatchEvent(new Event('streamloot:refresh'))")
```

Và lắng nghe trong `useTasks.ts`:

```typescript
  useEffect(() => {
    const onRefresh = () => void hydrate();
    window.addEventListener("streamloot:refresh", onRefresh);
    return () => window.removeEventListener("streamloot:refresh", onRefresh);
  }, [hydrate]);
```

- [ ] **Step 5: Thêm cột nguồn vào bảng lịch sử**

Trong `apps/desktop/ui/src/components/HistoryTable.tsx`, thêm một cột hiển thị `record.source`. Bản ghi cũ không có nguồn thì hiện `—`:

```tsx
<td>{record.source && record.source !== "unknown" ? record.source : "—"}</td>
```

Thêm `source?: string` vào type của bản ghi lịch sử trong `apps/desktop/ui/src/types.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/desktop/ui && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Kiểm tra bằng tay**

```bash
cd apps/desktop/ui && npm run build && cd ../../.. && ./build_app.sh
pkill -f "Streamloot.app/Contents/MacOS/Streamloot"; open dist/Streamloot.app
```

Bắt đầu một download **từ CLI** (`uv run apps/cli/main.py -u "<url>" --no-interactive`), rồi mở cửa sổ app: nó phải xuất hiện trong danh sách kèm tiến trình đang chạy. Ẩn cửa sổ, đợi tải xong, mở lại: lịch sử phải có nó kèm nhãn nguồn `cli`.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/ui/src apps/desktop/main.py
git commit -m "feat(desktop): cửa sổ app thấy mọi download và mọi nguồn

useTasks.ts trước đây lưu danh sách task id vào localStorage nên chỉ biết task do
chính nó khởi động — task từ extension hay CLI hoàn toàn vô hình.

Cách sửa lại XOÁ được code: /downloads/active đã là nguồn sự thật cho 'đang có gì
chạy' nên localStorage kia thành thừa. Backend sở hữu, client phản chiếu."
```

---

## Task 7: Cắt bỏ đường xác thực qua `Origin`

**Files:**
- Modify: `apps/api/main.py` (`verify_client`, `stream_progress`)
- Test: `tests/test_api_stage2.py` (bỏ test của nhánh `Origin`)

**Interfaces:**
- Consumes: không có
- Produces: `verify_client` chỉ còn hai đường — Bearer và `X-Streamloot-Extension-Id`

- [ ] **Step 1: Bỏ test của nhánh `Origin`**

Trong `tests/test_api_stage2.py`, xoá `test_official_extension_origin_is_accepted` và `test_stream_accepts_official_origin`. Thêm một test khẳng định nhánh đó đã đóng:

```python
    def test_origin_alone_is_no_longer_accepted(self):
        """
        Extension có host_permissions nên Chrome KHÔNG gửi Origin (đo được:
        backend nhận Origin None). Giữ nhánh này chỉ gây hiểu nhầm là nó có
        tác dụng.
        """
        with self.assertRaises(HTTPException) as ctx:
            api_main.verify_client(
                credentials=None, origin=self.OFFICIAL, x_streamloot_extension_id=None
            )
        self.assertEqual(ctx.exception.status_code, 401)
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_api_stage2 -v -k origin`
Expected: FAIL — nhánh `Origin` vẫn đang chấp nhận, nên không ném 401.

- [ ] **Step 3: Bỏ nhánh khỏi `verify_client`**

Xoá hai dòng này khỏi `verify_client`:

```python
    if origin and origin in _extension_origins:
        return "extension"
```

Giữ tham số `origin` để còn ghi vào log khi từ chối — nó là manh mối chẩn đoán.

- [ ] **Step 4: Bỏ nhánh khỏi `stream_progress`**

Xoá:

```python
    elif origin and origin in _extension_origins:
        pass
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `uv run python -m unittest tests.test_api_stage2 -v`
Expected: PASS.

- [ ] **Step 6: Chạy toàn bộ suite**

Run: `uv run python -m unittest discover -s tests -p "test_*.py"`
Expected: OK.

- [ ] **Step 7: Kiểm tra đường extension vẫn sống**

```bash
./build_app.sh >/dev/null && pkill -f "Streamloot.app/Contents/MacOS/Streamloot"
open dist/Streamloot.app && sleep 8
ID=$(cat packaging/extension-key/extension-id.txt)
curl -s -o /dev/null -w "header đúng: %{http_code}\n" -H "X-Streamloot-Extension-Id: $ID" http://127.0.0.1:8001/api/v1/downloads/active
curl -s -o /dev/null -w "chỉ Origin:  %{http_code}\n" -H "Origin: chrome-extension://$ID" http://127.0.0.1:8001/api/v1/downloads/active
```
Expected: `header đúng: 200`, `chỉ Origin: 401`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/main.py tests/test_api_stage2.py
git commit -m "refactor(api): bỏ đường xác thực qua Origin

Extension có host_permissions nên Chrome không gửi Origin — đo được backend nhận
Origin None. Nhánh này không bao giờ khớp cho client thật, giữ lại chỉ gây hiểu
nhầm là nó đang có tác dụng.

Giữ tham số origin để còn ghi vào log khi từ chối: đó là manh mối chẩn đoán."
```

---

## Self-Review

**Spec coverage:**

| Mục spec | Task |
|---|---|
| §6.1 cột `source` + migration | Task 1 |
| §6.2 `/downloads/active`, `?source=`, ghi `source` | Task 2, 4 |
| §5.4 menu bar tiến trình + điều khiển (D5) | Task 5 |
| §5.5 cửa sổ app mọi nguồn, bỏ `localStorage` (D6) | Task 6 |
| §8 bỏ đường `Origin` | Task 7 |
| §5.1–5.3 panel, popup, icon (extension) | **Plan 2** — không thuộc plan này |
| §4.2 nhịp poll của extension | **Plan 2** |
| §8 bỏ `streamProgress` của extension | **Plan 2** |

**Placeholder scan:** không có "TBD"/"TODO"/"tương tự Task N". Mọi bước code đều có khối mã thật.

**Type consistency:**
- `save_record(..., source=)` định nghĩa Task 1 → dùng Task 3 ✓
- `create_task(..., source=)` định nghĩa Task 1 → dùng Task 4 ✓
- `get_active_tasks()` định nghĩa Task 2 → dùng Task 4 (API) và Task 5 (menu bar) ✓
- `get_history(limit, source)` định nghĩa Task 2 → dùng Task 4 ✓
- `getActiveTasks()` định nghĩa Task 6 → dùng trong cùng task ✓
- `build_menu_model(active_tasks)` định nghĩa Task 5 → dùng trong cùng task ✓
- `refreshStreamToken` đã tồn tại từ Giai đoạn 2, Task 6 dùng lại ✓

**Rủi ro đã ghi trong plan:**
- Thứ tự khai route `/downloads/active` trước `/downloads/{task_id}` — Task 4 Step 7 kiểm tra riêng
- `HistoryService.TERMINAL_STATUSES` đã xác minh là **class attribute**, nên `self.TERMINAL_STATUSES` ở Task 2 dùng được
