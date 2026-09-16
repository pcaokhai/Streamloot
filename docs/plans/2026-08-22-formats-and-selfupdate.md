# Plan: Format-List Endpoint + yt-dlp Self-Update Check

**Status: implemented (2026-08-22).** New endpoints: `GET /api/v1/formats?url=...`,
`GET /api/v1/system/ytdlp-version`. Both verified against live yt-dlp/GitHub
calls, not just mocks — see "Implementation Notes" at the bottom.

Source: `docs/brainstorm/2026-08-22-redesign-and-features.md`, items 1 and 4
(the two lowest-effort, highest-leverage wins from the market comparison).

## Problem

1. There's no way for a client (browser extension, future desktop UI) to
   ask "what formats/resolutions exist for this URL" before starting a
   download. Format selection today is either a blocking CLI prompt
   (`InteractivePrompt.select_format()`) or a raw `format_id` string passed
   blind into the API request — no discovery step.
2. The app depends entirely on `yt-dlp` staying current with site changes.
   There's no update mechanism at all; a stale binary silently breaks
   extraction with no signal to the user about *why*.

## Scope

In scope: `apps/api/main.py`, `downloaders/ytdlp.py` (or a new
`services/format_service.py`), a small update-check utility, `tests/`.

Out of scope: auto-*applying* the yt-dlp update (scope is check + surface,
not silent self-modification of a system binary — see premise below),
queue UI, browser extension, subscription monitoring.

## Implementation Tasks

### 1. Format-list endpoint
- Call `ExtractorFactory.get_extractor(url).extract(url)` first (same as
  `DownloadService`) to get a resolved `VideoInfo` — the extraction step
  (browser-cookie harvesting for certain browser-gated sites) is what
  actually talks to the target site; `yt-dlp -J` alone cannot do this for
  those sites.
- Run `yt-dlp -J --no-download <video_info.m3u8_url>` against the
  **resolved stream URL**, not the original page URL, with the same
  `--user-agent`/`--referer`/`--add-header Cookie` arguments
  `YtDlpDownloader.download()` builds inline
  (`downloaders/ytdlp.py` lines ~62-81). That header-construction block is
  currently inline in `download()`, not a shared function — extract it into
  `YtDlpDownloader._build_headers(video_info) -> list[str]` and call it from
  both `download()` and the new format-list method, rather than duplicating
  the argument-building logic.
- **Known cost, not a free preview:** for anti-bot sites, `extract()` is the
  expensive/riskable part (real page fetch, cookie harvest) — listing
  formats costs nearly the same site-load/detection risk as an actual
  download, it just skips the file write. Document this in the endpoint's
  behavior, don't market it as a lightweight preview.
- Add `GET /api/v1/formats?url=...` (auth required, same `verify_api_key`
  dependency as other endpoints). Returns the resolved `VideoInfo.title`
  plus the format list, and flags a `recommended` format (yt-dlp's own
  best-quality pick) so a browser-extension consumer doesn't have to
  reimplement yt-dlp's format-selection heuristic. 400 on extraction
  failure, not a bare 500.
- Add a subprocess timeout (e.g. 30s) on the `yt-dlp -J` call — an
  unresponsive site otherwise blocks the request thread indefinitely.
  Catch `subprocess.TimeoutExpired` → 504.
- CLI: no change needed — `InteractivePrompt.select_format()` already
  covers this interactively; the API gap is what's being closed.

### 2. yt-dlp self-update check
- **Do not use `yt-dlp -U`.** It's not a dry-run/check flag — it triggers a
  real self-update (or refuses outright for pip/Homebrew-managed installs,
  telling the user to update via their package manager instead).
  `--simulate` is a download-simulation flag, unrelated to `-U`; the
  combination in the original draft of this plan doesn't do what was
  claimed. Confirmed against the actual local install: yt-dlp here is a
  Homebrew formula, not pip or the standalone binary — `-U` would be wrong
  for this install method too, not just pip.
- Add `check_ytdlp_update() -> dict`: run `yt-dlp --version` (local,
  no network) and compare it against the latest tag from
  `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest` (a plain
  read-only GET, works regardless of how yt-dlp itself was installed).
  Returns `{"current": ..., "latest": ..., "update_available": bool}`.
- Run this check once at API startup (non-blocking — log a warning, don't
  fail startup if the check itself fails, e.g. no network). Add a timeout
  (e.g. 5s) on the GitHub request.
- Add `GET /api/v1/system/ytdlp-version` (auth required) so a client can
  poll it on demand too, not just read a startup log line.
- Explicitly NOT auto-running any update mechanism — surfacing the check is
  the safe default; auto-applying an update to a system-managed binary
  without the user's say-so is a bigger blast radius than this plan's
  scope, and the correct update command differs by install method anyway
  (`brew upgrade yt-dlp`, `pip install -U yt-dlp`, or replacing the
  standalone binary) — the response should name the check result, not
  attempt to run any of those itself.

## Tests
- Unit test: format-list parsing logic against a fixture `yt-dlp -J`
  JSON blob (no live network call).
- Unit test: `_build_headers(video_info)` extraction — same output before
  and after the refactor, called from both `download()` and the new
  format-list path.
- Unit test: update-check version comparison against a fixture GitHub
  releases API response, both update-available and up-to-date cases
  (mocked HTTP call, no live network).
- Unit test: subprocess timeout on the `yt-dlp -J` call raises/handled
  correctly (mock `subprocess.run` to raise `TimeoutExpired`).
- API test (same pattern as `tests/test_api_cancel.py` — call the route
  function directly, no `TestClient`): `/api/v1/formats` 400 on bad
  URL, 504 on timeout, `/api/v1/system/ytdlp-version` returns the expected
  shape.

## Effort

Estimated: 0.5-1 day. Both endpoints are read-only wrappers around
existing `yt-dlp` CLI capabilities — no new persistence, no changes to the
download/cancel flow shipped in the previous plan. The header-building
refactor in task 1 is the only piece touching existing download code; it's
a pure extraction (same behavior, callable from two places), not a
behavior change.

## Review

Reviewed via /autoplan (2026-08-22): CEO + Eng + DX passes, single Claude
primary voice + one independent Claude subagent voice (no git remote,
Codex CLI not installed). Design phase skipped (no UI scope).

**Consensus:** endpoint scope and auth pattern (reusing `verify_api_key`)
are correct and consistent with the existing API. The "cheap win" framing
holds for task 1 once the header-building refactor is accounted for
explicitly rather than assumed away.

**Critical finding from the independent voice, folded in:** the original
draft's `yt-dlp -U --simulate` update-check mechanism doesn't work as
described — `-U` is a real self-update trigger (and fails outright for
pip/Homebrew installs), not a dry-run check, and `--simulate` is unrelated
to it. Replaced with a `yt-dlp --version` vs. GitHub releases API
comparison, verified against this machine's actual yt-dlp install
(Homebrew, confirming the pip-specific failure mode generalizes to
Homebrew too).

**Also folded in:** shared header-building refactor (was implicitly
assumed reusable, isn't without extraction), subprocess timeouts on both
new endpoints, and documenting that format-listing carries the same
site-load/anti-bot cost as a real download rather than presenting it as a
free preview.

**No taste decisions or user-direction challenges surfaced.**

## Implementation Notes

- `downloaders/ytdlp.py`: extracted `_build_headers(video_info)` (static
  method) out of `download()`'s inline block; both `download()` and the new
  `list_formats()` call it. `list_formats()` runs `yt-dlp -J --no-warnings`
  against `video_info.m3u8_url` with a 30s timeout, raises `ValueError` on
  missing stream URL and `RuntimeError` on a non-zero yt-dlp exit.
- Format `recommended` flagging: yt-dlp's top-level `format_id` for a
  merged pick looks like `"137+140"` (video+audio), not a single format's
  id — matching had to split on `+` and check component membership. Caught
  by the unit test against a fixture with a merged pick, not assumed.
  Verified against a real YouTube URL: correctly flagged the audio-only
  track (251) and the 4K video track (401) as the merged recommended pair
  out of 49 returned formats.
- `utils/ytdlp_version.py`: `check_ytdlp_update()` compares
  `yt-dlp --version` (local, 5s timeout) against
  `api.github.com/repos/yt-dlp/yt-dlp/releases/latest` (5s timeout, plain
  `urllib`, no new dependency). Never invokes `yt-dlp -U`. Verified live —
  correctly reported this machine's Homebrew-installed yt-dlp as
  up-to-date against the real GitHub API.
- `apps/api/main.py`: added `@app.on_event("startup")` hook logging a
  warning if an update is available (non-fatal on check failure — e.g. no
  network); `GET /api/v1/formats` (400 on extraction failure, 504 on
  timeout) and `GET /api/v1/system/ytdlp-version`, both behind the
  existing `verify_api_key` dependency.
- Tests added: `tests/test_ytdlp_formats.py`, `tests/test_ytdlp_version.py`,
  `tests/test_api_formats.py` — 15 new test cases, full suite now 36/36
  passing. All mocked at the unit level per the plan (no live network in
  the test suite itself); live end-to-end calls were run manually during
  implementation to confirm the mocks reflect real yt-dlp/GitHub response
  shapes.
