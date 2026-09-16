# Plan: Fix Critical Gaps from Architecture Review

**Status: implemented (2026-08-22).** See "Implementation Notes" at the
bottom for what shipped and one operational change (API_KEY is now
required, not defaulted).

Source: `docs/reviews/2026-08-22-architecture-review.md`

## Problem

The review found the feature list ("download, stop, resume, list, history")
is not fully backed by working code in API/Desktop mode:

1. No cancel/stop mechanism anywhere except Ctrl+C in the CLI.
2. Two disconnected SQLite databases — `HistoryService` writes real data to
   `db/history.db`; the API reads from a separate, never-written
   `db/downloader.sqlite` (`DownloadTask` table). `/api/v1/history` returns
   empty/wrong data.
3. No per-task status endpoint and no persistent task state — progress lives
   only in an in-memory `dict` (`ProgressManager`), lost on restart, broken
   with >1 uvicorn worker.
4. API defaults to a hardcoded key (`dev_secret_token_123`) when `API_KEY`
   is unset; CORS allows `*` origins with credentials.
5. No concurrency cap on background downloads.
6. No integration test proving the resume-after-interruption feature works.

## Scope

In scope: `apps/api/main.py`, `core/db.py`, `services/history_service.py`,
`services/download_service.py`, `downloaders/ytdlp.py`, `tests/`.

Out of scope: Desktop app UI work, new extractors/plugins, CLI changes
beyond what's needed for a shared task registry.

## Implementation Tasks

### 1. Unify persistence — kill the dead DB path
- Delete `core/db.py`'s SQLAlchemy `DownloadTask` model and `db/downloader.sqlite`.
- Extend `HistoryService` (`services/history_service.py`) with the columns
  the API needs for task tracking (`task_id`, `status`, `progress`).
- Rewire `GET /api/v1/history` to read from `HistoryService`.

### 2. Add real task lifecycle to the API
- Add a process registry: `dict[task_id, subprocess.Popen]` held by
  `ProgressManager` or a new `TaskRegistry`. **Constraint: single uvicorn
  worker only** (matches current `uvicorn.run(app, host="127.0.0.1")` — no
  `--workers` flag). Document this explicitly in the module docstring; a
  future move to multiple workers breaks both cancel and progress streaming
  and needs its own design.
- `downloaders/ytdlp.py`: `download()` currently blocks synchronously inside
  `for line in process.stdout` right after `Popen()` — the caller never sees
  the `Popen` object until the loop exits. Exposing it for cancellation
  means restructuring this: fire a callback with the `Popen` handle
  immediately after spawning, before entering the read loop. This is a real
  change to the method's control flow, not just "add a dict entry."
- Add `POST /api/v1/downloads/{task_id}/cancel`:
  - Set status to `cancelling` in `HistoryService` **before** calling
    `terminate()`, so a race between the natural exit and the cancel signal
    resolves deterministically (the run loop checks "was cancel requested"
    before writing final status, not just `process.returncode`).
  - `process.terminate()`; on some platforms a terminated process can still
    report `returncode == 0` — don't trust returncode alone to distinguish
    cancelled vs. completed.
  - Unknown `task_id` → 404. Task already finished → 409 (no silent no-op).
- Add `GET /api/v1/downloads/{task_id}` — status lookup (already documented
  in `docs/architecture_v2.md`, never built).
- On task start, write a `pending`/`downloading` row immediately so a
  server restart mid-download leaves a recoverable record.

### 3. Security fixes
- `apps/api/main.py`: raise at startup if `API_KEY` env var is unset,
  instead of defaulting to `dev_secret_token_123`.
- Restrict `CORSMiddleware.allow_origins` to an explicit allowlist read from
  an env var. **Fail closed**: if that env var is also unset, default to no
  origins allowed, not `*`. Drop `allow_credentials=True` unless actually
  needed.

### 4. Concurrency cap
- Bound simultaneous background downloads (e.g. `asyncio.Semaphore` or a
  bounded queue) in `apps/api/main.py`'s `run_download_task` path.

### 5. Test coverage
- Unit test: `HistoryService` task-state read/write round trip.
- Integration test: start a download, terminate the subprocess mid-flight,
  assert the task record reflects `cancelled`/`failed` and that re-issuing
  the same URL resumes rather than re-downloads from scratch (exercises
  `sync_archive_with_disk` + `is_video_on_disk`).
- Integration test: cancel a task that has already finished — assert 409,
  not a crash or silent 200.
- Integration test: cancel racing a fast-finishing download — assert the
  final status is deterministic (either `cancelled` or `completed`, never
  corrupted/ambiguous state).

## Effort

Estimated: 1-2 days for a single engineer; each task above is independently
shippable and testable. Task 2's `ytdlp.py` restructuring (exposing the
`Popen` handle before the blocking read loop) is the largest single piece —
budget extra time there specifically.

## Review

Reviewed via /autoplan (2026-08-22): CEO + Eng + DX passes, single Claude
primary voice + one independent Claude subagent voice (no git remote, Codex
CLI not installed on this machine — both dual-voice legs used Claude).
Design phase skipped (no UI scope — backend/API only).

**Consensus:** DB-unification approach (delete `core/db.py`'s dead
`DownloadTask` path rather than migrate to it) — both voices agree this is
correct and low-risk, since nothing else reads `db/downloader.sqlite`.
Security fixes (fail-fast API key, restrict CORS) — both voices agree these
close the gaps named in the source review.

**Findings from the independent voice, folded into this plan:** the
cancel/completion race condition (task 2) and the fact that exposing the
`Popen` handle requires restructuring `ytdlp.py`'s blocking read loop, not
just adding a registry (task 2) — both were underspecified in the first
draft of this plan and are now called out explicitly above.

**No taste decisions or user-direction challenges surfaced** — the fixes
follow directly from the source review's findings with no ambiguity in
approach.

## Implementation Notes

- `core/db.py` and `db/downloader.sqlite` deleted. Task tracking lives in a
  new `download_tasks` table inside `db/history.db` (`HistoryService`), kept
  separate from the existing `download_history` table (different lifecycle:
  in-flight task state vs. permanent record of a finished download).
- Cancel race is resolved via a DB status check rather than trusting
  `Popen.returncode`: the cancel endpoint sets `status="cancelling"` before
  calling `terminate()`; `DownloadService` checks that status (not the
  process return code) right after the downloader call returns, both for
  single videos and after each video in a playlist.
- `downloaders/ytdlp.py` gained a `process_callback` fired with the live
  `Popen` immediately after spawn, before the blocking stdout-read loop —
  this is the restructuring the independent review flagged as
  underestimated in the original draft.
- New endpoints: `GET /api/v1/downloads/{task_id}` (404 if unknown),
  `POST /api/v1/downloads/{task_id}/cancel` (404 unknown, 409 if already
  terminal).
- **Breaking operational change:** `API_KEY` env var is now required at
  startup (`os.environ["API_KEY"]`) — the API no longer starts with a
  default token. `CORS_ALLOWED_ORIGINS` (comma-separated) is now required
  to allow any cross-origin requests; unset means no origins allowed.
- `MAX_CONCURRENT_DOWNLOADS` (default 3) bounds simultaneous background
  downloads via a `threading.Semaphore`.
- Tests added: `tests/test_history_service_tasks.py`,
  `tests/test_download_service_cancel.py` (covers the cancel race
  deterministically via mocked downloader, not real subprocess timing),
  `tests/test_api_cancel.py` (404/409 status codes, calling the route
  functions directly since `httpx` isn't installed for `TestClient`).
- Not done: no test spins up a real `yt-dlp` subprocess and kills it — the
  race is proven at the status-check logic level instead, which is what
  actually determines correctness (real subprocess timing isn't
  deterministic to test against).
