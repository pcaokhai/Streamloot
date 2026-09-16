# Architecture & Production-Readiness Review — 2026-08-22

Scope: full codebase review of the CLI/API/Desktop downloader app against the
claimed feature set (download, stop/resume, list/history, restart failed
downloads) and general production standards.x

## Bottom line

Not enterprise-grade, and it doesn't need to be — but a few things labeled
"done" in the feature list aren't actually implemented. The core
download/resume logic (disk-vs-archive sync, playlist resume) is well
thought out. The multi-app layer (API/Desktop) is where it falls apart.

## Critical gaps

1. **"Stop download" doesn't exist.** No `terminate`/`kill`/`cancel` anywhere
   except a Ctrl+C handler in the CLI (`apps/cli/main.py:134`).
   `YtDlpDownloader.download()` (`downloaders/ytdlp.py:103`) spawns `yt-dlp`
   via `Popen` and blocks until it exits — no registry of running processes,
   no way to send SIGTERM to a specific task, no API endpoint to cancel one.

2. **Two unrelated databases, one is dead.** `core/db.py` defines a
   SQLAlchemy `DownloadTask` table at `db/downloader.sqlite`, which is what
   `GET /api/v1/history` reads (`apps/api/main.py:120`). Actual downloads are
   recorded by `HistoryService` (`services/history_service.py`) into a
   *different* file, `db/history.db`, via raw `sqlite3`.
   `run_download_task` (`apps/api/main.py:75`) never writes to
   `DownloadTask` at all — the code even admits it in a comment ("we will
   just expose a basic SQLite endpoint placeholder"). Net effect: the API's
   "show history" / "list downloaded" endpoints return empty/wrong data.

3. **No per-task state → no resume for interrupted downloads via API.**
   No `GET /api/v1/downloads/{task_id}` status endpoint despite being in
   `docs/architecture_v2.md`. Progress lives only in an in-memory
   `dict[str, queue.Queue]` (`ProgressManager`, `apps/api/main.py:44`) —
   lost on restart, and broken with more than one uvicorn worker. A download
   interrupted by a server restart has no record it ever started.

4. **Security smell in the API.** Default API key hardcoded as
   `"dev_secret_token_123"` (`apps/api/main.py:22`) — auth silently passes
   with a well-known token if `API_KEY` is unset. Should fail startup
   instead. Also `allow_origins=["*"]` + `allow_credentials=True`
   (`apps/api/main.py:33`) is a known-bad CORS combo.

5. **No concurrency limit on the API.** Every `POST /downloads` spawns an
   uncapped background `yt-dlp` subprocess — nothing stops a client from
   spawning dozens concurrently.

6. **Thin test coverage on the risky parts.** Existing tests
   (`tests/test_extractor_factory.py`, `test_text_utils.py`,
   `test_plugin_resilience.py`) don't touch `DownloadService`, the
   archive-sync logic, or the API endpoints — exactly where "resume partial
   download" correctness lives.

## What's actually good

- `sync_archive_with_disk` / `is_video_on_disk`
  (`services/download_service.py`) correctly handles a user manually
  deleting a downloaded file — most download managers get this wrong.
- Plugin/extractor separation (`core/extractor.py` + `extractors/factory.py`)
  is clean; adding a new site is a contained change.
- `AGENT.md` documents real operational lessons (YouTube Mix URL
  infinite-loop guard, playlist-end cap, `KeyboardInterrupt` propagation)
  that most projects lose to tribal knowledge.

## Priority order to fix

1. Delete `core/db.py`'s `DownloadTask`/SQLAlchemy path, or migrate
   `HistoryService` onto it — pick one, wire the API to the real data.
2. Add a task registry (`dict[task_id, subprocess.Popen]`) and a
   `POST /downloads/{id}/cancel` that terminates the process and marks
   status `cancelled`.
3. Fail fast on missing `API_KEY` outside dev; restrict CORS origins.
4. Add the documented `GET /downloads/{id}` status endpoint.
5. Add an integration test: start a download, kill the process mid-flight,
   assert resume picks it back up — the feature the whole system is
   designed around currently has no end-to-end test.
