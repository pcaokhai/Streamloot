<div align="center">

# Streamloot

**A modular, multi-mode video downloader built on `yt-dlp`, with a dynamic
plugin system for site-specific extraction.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-blue.svg)](pyproject.toml)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#macos-app)
[![Tests](https://img.shields.io/badge/tests-56%20passing-brightgreen.svg)](tests)

[Features](#features) •
[Architecture](#architecture) •
[Quick Start](#quick-start) •
[macOS App](#macos-app) •
[Plugins](#plugins) •
[Contributing](#contributing)

</div>

---

## Overview

Streamloot wraps [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) with a clean,
UI-agnostic core and exposes it through three independent entry points — a
CLI, a local REST API, and a native macOS desktop app — all sharing the same
download engine, plugin system, and history store.

The core idea: **extraction logic is pluggable and disposable.** A dynamic
factory scans a `plugins/` directory at runtime and falls back to a generic
`yt-dlp`-based extractor for anything it doesn't recognize. Delete the entire
`plugins/` directory and the application keeps working — it just loses its
site-specific optimizations.

## Features

- **Three interchangeable front ends** over one core: CLI, HTTP API (with
  Server-Sent Events for live progress), and a native macOS desktop app.
- **Plugin-based extraction** — each site's scraping logic lives in its own
  isolated file; a broken or missing plugin never crashes the app.
- **Resilient by design** — every plugin import is wrapped individually, so
  one bad plugin degrades gracefully instead of taking down the factory.
- **Download history** persisted to SQLite, with pause/resume/cancel support.
- **Browser-backed extraction** for sites that require a real browser session
  (via [DrissionPage](https://github.com/g1879/DrissionPage)), isolated
  behind a dedicated extractor base class.
- **Zero-UI core** — `core/` and `downloaders/` never import a UI framework;
  progress is reported through a single typed callback, consumed differently
  by each front end.

## Architecture

```
streamloot/
├── apps/
│   ├── cli/          # Command-line entry point (rich progress bars)
│   ├── api/          # FastAPI backend — REST + SSE, for the desktop app
│   │                 # and any external client (e.g. a browser extension)
│   └── desktop/       # Native macOS app: pywebview shell + bundled React UI
├── core/              # Framework-agnostic contracts: VideoInfo, BaseExtractor,
│                       # BaseDownloader — no UI, no I/O side effects
├── downloaders/       # Downloader implementations (yt-dlp subprocess wrapper)
├── extractors/        # ExtractorFactory (dynamic plugin discovery) + the
│                       # default yt-dlp-based extractor used as a fallback
├── plugins/           # Site-specific extractors, loaded dynamically at
│                       # runtime — safe to add, remove, or break individually
├── services/          # Orchestration: DownloadService, HistoryService
├── utils/             # Logging, text helpers, and frozen-app path resolution
├── tests/             # unittest suite (56 tests)
└── docs/              # Architecture decisions, plans, and design docs
```

**Design principles enforced across the codebase:**

1. **The core has zero UI dependencies.** Progress crosses the UI boundary
   through one callback shape — the CLI renders it with `rich`, the API
   streams it over SSE, and the desktop app bridges it into a webview.
2. **Plugins are private and disposable.** No plugin's domain, URL pattern,
   or business logic ever leaks into `core/`, `extractors/`, `services/`, or
   `utils/`. See [Plugins](#plugins) below.
3. **The API binds to localhost only** and requires a bearer token
   (`Authorization: Bearer <API_KEY>`) on every state-changing endpoint.

## Quick Start

### Prerequisites

- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/) for dependency management
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) available on `PATH` (installed
  automatically inside the packaged macOS app — see [below](#macos-app))
- `ffmpeg` (optional, needed to merge separate video/audio streams)

### Install

```bash
git clone https://github.com/<your-username>/streamloot.git
cd streamloot
uv sync
```

### Run

```bash
# CLI
uv run apps/cli/main.py -u "<VIDEO_URL>"
uv run apps/cli/main.py -u "<VIDEO_URL>" -c 4 --no-interactive

# API backend (http://127.0.0.1:8000)
uv run apps/api/main.py

# Desktop app (builds the React UI on first run)
./run_desktop.sh
```

### Test

```bash
uv run python -m unittest discover -s tests -p "test_*.py"
```

## macOS App

Build a self-contained, double-clickable `.app` — no Python, `uv`, or Node
installation required on the machine that runs it:

```bash
./build_app.sh
```

This builds the React UI, vendors official standalone `yt-dlp` and `ffmpeg`
binaries into the bundle, packages everything with PyInstaller, and verifies
the result before finishing. The output lands at `dist/Streamloot.app`.

```bash
./build_app.sh --sign "Developer ID Application: Your Name (TEAMID)"  # notarizable
./build_app.sh --no-ffmpeg                                            # smaller bundle
./build_app.sh --clean                                                # rebuild from scratch
```

Without `--sign`, the build strips the local quarantine attribute so it runs
on your machine, but macOS Gatekeeper will block it on any other Mac until
the user right-clicks → **Open**.

## Plugins

Site-specific extraction logic lives entirely in `plugins/` and is loaded
dynamically by `ExtractorFactory` at runtime:

- Each plugin is imported in its own `try`/`except` block — a syntax error or
  a broken dependency in one plugin never affects another, or the app as a
  whole.
- If `plugins/` is empty or missing entirely, every URL falls back to
  `YtDlpDefaultExtractor`, which covers any site `yt-dlp` natively supports
  (YouTube included).
- This repository's own `plugins/` directory is intentionally minimal.
  Private, site-specific, or content-sensitive extractors are excluded via
  `.gitignore` and are never part of the public codebase — see
  [`CLAUDE.md`](CLAUDE.md) §3.1 for the architectural rule this enforces.

To add a new plugin, implement `core.extractor.BaseExtractor` (or
`extractors.base_browser.BaseBrowserExtractor` for sites that require a real
browser session) and drop the file into `plugins/`. No registration step is
needed.

## Development

This project follows a layered architecture with strict separation between
UI, orchestration, and core logic. See:

- [`CLAUDE.md`](CLAUDE.md) — architectural rules and conventions
- [`AGENT.md`](AGENT.md) — detailed layering and extension guidelines
- [`DESIGN.md`](DESIGN.md) — desktop app visual design system
- [`docs/`](docs/) — ADRs, implementation plans, and design docs

```bash
uv run python -m unittest discover -s tests -p "test_*.py"   # run tests
uv sync --extra build                                         # dev + packaging deps
```

## Contributing

Issues and pull requests are welcome. Before submitting a change:

1. Ensure the full test suite passes.
2. Keep the core (`core/`, `downloaders/`, `services/`, `utils/`) free of UI
   imports and site-specific logic.
3. New site support belongs in `plugins/`, implementing the existing
   extractor interfaces — not in the shared codebase.

## License

Distributed under the [MIT License](LICENSE).
