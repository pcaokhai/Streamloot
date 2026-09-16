# Redesign & Feature Opportunities

Comparison baseline: JDownloader2, 4K Video Downloader+, Motrix, XDM
(Xtreme Download Manager), MeTube (yt-dlp web UI). All are the actual
competitive set for "paste a URL, get a video" tools — not enterprise
media platforms.

## What the market leaders have that this app doesn't

1. **Browser extension → one-click capture.** JDownloader/XDM/4K all let
   you click a button in the browser instead of copy-pasting a URL into a
   separate app. `docs/architecture_v2.md` already plans a Chrome extension
   talking to the API — that's the right instinct, it's just not built.
   This is the single highest-leverage feature gap: it's the difference
   between "a tool I open in a terminal" and "a tool that's just there."

2. **Persistent job queue, not one-URL-at-a-time.** Every competitor lets
   you paste 10 URLs and walk away; queue processes them with configurable
   concurrency. This app's `DownloadService.process_url()` handles one URL
   per call — the API's `MAX_CONCURRENT_DOWNLOADS` semaphore (just added)
   caps concurrent *requests*, but there's no queue UI, no reordering, no
   "pause this one, prioritize that one."

3. **Channel/playlist subscription monitoring.** 4K Video Downloader's
   "Smart Mode" watches a channel and auto-downloads new uploads. This app
   already has the playlist-resume logic (`sync_archive_with_disk`) as a
   foundation — subscription monitoring is "run the same playlist check on
   a cron schedule" more than new architecture.

4. **Format/quality picker before committing.** Right now format selection
   is either `interactive` (CLI prompt) or a raw `format_id` string in the
   API request — no endpoint to ask "what formats/resolutions exist for
   this URL" before starting. Every competitor shows a picker.

5. **Desktop notifications.** `apps/desktop/main.py` is 40 lines — there's
   no real desktop app yet, just a stub. A native notification on
   download-complete/failed is table stakes for a desktop tool and currently
   doesn't exist in any mode.

6. **Auto-updating yt-dlp.** This is the single most common failure mode
   for any yt-dlp-based tool: sites change their player, yt-dlp ships a fix
   within days, and a stale binary silently breaks extraction. JDownloader
   self-updates; this app has no update mechanism for its core dependency
   at all.

## What's already good (don't rebuild this)

- Disk-vs-archive reconciliation (`sync_archive_with_disk`) is more
  correct than most competitors, which just trust their download-history
  file blindly.
- Plugin architecture (`extractors/factory.py`) makes adding a new site a
  contained change — JDownloader's plugin system is the gold standard here
  and this app already follows the same shape.
- The task-lifecycle work just shipped (cancel/status/history unification)
  is exactly the backend substrate the queue UI and browser extension need
  — this redesign builds on it, doesn't replace it.

## Recommended priority (highest leverage first)

1. **Format-list endpoint** (`GET /api/v1/formats?url=...`) — smallest
   effort, unlocks the quality-picker UX everywhere else. `yt-dlp -F` does
   the extraction work already; wrap it.
2. **Job queue UI** — the API's task model already exists post-refactor;
   this is a frontend/extension problem, not a backend rewrite.
3. **Browser extension** — was already the plan in `architecture_v2.md`.
   Biggest UX unlock, medium effort (the API surface mostly exists now).
4. **yt-dlp self-update check** — smallest effort of all: `yt-dlp -U` on a
   schedule or at API startup, surfaced as a warning if stale.
5. **Subscription monitoring** — reuses existing playlist logic, needs a
   scheduler (cron or APScheduler) and a "watched URLs" table.
6. **Desktop app + notifications** — largest effort (a real GUI doesn't
   exist yet); lowest urgency since API + CLI already cover the core loop.

## What NOT to build

- Multi-user auth/accounts — this is a personal tool, not a hosted
  service. Building real user management would be solving a problem this
  project doesn't have.
- A custom media player/library browser — that's Plex/Jellyfin's job, not
  a downloader's. Resist scope creep into media server territory.
