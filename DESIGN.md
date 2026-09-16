# Design System — Downloader Desktop App

Product: a personal (possibly later open-sourced) macOS download manager,
a yt-dlp frontend. `apps/desktop` — pywebview shell around the FastAPI
backend (`apps/api`), rendering HTML/CSS/JS.

**Memorable thing:** looks and feels like it shipped with macOS (native
chrome, system fonts/colors, nothing decorative calling attention to
itself) — but the content inside is dense and built for someone who
downloads a lot, not a pretty toy. Native shell, power-user data.

**Closest real comparable:** [Downie](https://software.charliemonroe.net/downie/)
— "a clean, native Mac app that stays out of your way." Same category,
same posture. SF Pro is the system font and the only typeface — using
anything else immediately reads as non-native, which directly fights the
memorable-thing goal.

## Aesthetic

**Direction:** Industrial/Utilitarian, fully native. Function-first,
data-dense, no marketing chrome — this is a utility, not a landing page.

**Decoration:** Minimal. No gradients, no drop shadows for decoration's
sake, no blobs. Native materials (vibrancy/translucency on the sidebar)
and hairline separators do all the visual organizing.

**Layout:** Grid-disciplined. Sidebar (Library / History / Settings) +
toolbar (URL field, Download button, transport controls, filter) + table
(Name / Progress / Speed / Status). Matches the mockup exactly, and
matches Finder/Mail/Transmission conventions — zero learning curve for a
Mac user.

## Typography

SF Pro (system font) everywhere. No secondary display font — this
product has no marketing surface that needs one.

- **Row title** (video name): SF Pro Text, Regular, 13px
- **Row subtitle** (source URL): SF Pro Text, Regular, 11px, secondary
  label color (`labelColor` at reduced opacity, i.e. macOS's own
  secondary-text convention — not a custom gray)
- **Column headers**: SF Pro Text, Regular, 11px, tertiary label color
- **Numeric columns** (progress %, file sizes, speeds): tabular figures
  (`font-variant-numeric: tabular-nums` in CSS) so digits align in a
  monospaced grid without switching to a monospace typeface — this is
  what makes a data table read as "considered," not just "a table."
- **Sidebar items**: SF Pro Text, Regular, 13px

## Color

Restrained. Two color systems, kept separate:

**Chrome/accent** — inherit the user's actual System Settings accent
color, not a hardcoded hex. In CSS: prefer `AccentColor`/`Highlight`
system colors where the webview engine supports them; where it doesn't,
bridge `NSColor.controlAccentColor` from the Python/pywebview side into a
CSS custom property at launch. Do not hardcode `#0A84FF` — that's just
today's default system blue, and a user with a different accent-color
preference should see their own accent, matching every other native app
on their machine.

**Status (semantic, fixed — do not tie to accent)**:
| State | Color | Meaning |
|---|---|---|
| Completed | System green | Terminal, succeeded |
| Downloading | System blue (or accent, if accent ≠ blue — see note) | Active, progressing |
| Paused | System gray | User-initiated hold |
| Interrupted | System orange | Transient failure, auto-retrying |
| Failed | System red | Terminal, needs user action |

Note: if the user's accent color happens to be blue, "Downloading" and
the chrome accent will coincide — that's fine and expected (it's how
Finder's own selection-blue works). If the accent is a different color
(e.g. orange), keep "Downloading" as system blue anyway — status colors
are semantic and must stay legible/distinguishable regardless of the
user's accent choice; only chrome (selected sidebar row, toolbar buttons)
follows the accent.

**Failed vs. Interrupted are visually distinct beyond color** (this was a
gap in the original mockup): Failed shows a static solid dot. Interrupted
shows a slow pulsing/breathing dot (2s ease-in-out opacity cycle) —
signaling "still trying" at a glance, without needing to read the text.

## Spacing

8pt base grid (Apple HIG standard).
- Row height: 44px (Finder list-view density — dense enough for a
  power-user queue, still comfortable to click).
- Toolbar height: 38px (matches macOS unified-toolbar convention).
- Sidebar item height: 28px, 8px horizontal inset.
- Table column padding: 12px horizontal.

## Motion

Minimal-functional only. Progress bars animate their fill continuously;
status transitions cross-fade (150ms). Nothing celebratory, nothing
bouncy, nothing that calls attention to itself — matches the CLI's
existing philosophy (`AGENT.md` §3: transient Rich progress bars that
disappear on success, no decorative flourish).

Exception: the Interrupted-state pulsing dot above — the one deliberate
piece of ambient motion, and it's functional (communicates "auto-retry in
progress"), not decorative.

## Implementation notes (native chrome)

**Fix required before building from the mockup as-is:** `apps/desktop/main.py`
uses `webview.create_window(...)`, which gives a real native titlebar
with real traffic-light buttons on macOS. The mockup draws its own
red/yellow/green dots in the HTML. Do not implement the drawn dots —
either:
- Keep the native titlebar (recommended, simplest) and delete the drawn
  traffic-light markup from the HTML entirely, or
- Go frameless (`frameless=True`) and draw custom chrome with
  `-webkit-app-region: drag` wired up on the toolbar — only worth it if a
  fully custom titlebar is wanted later; not needed to match the mockup's
  intent.

## Safe choices (category baseline)

- Native titlebar/traffic lights, not drawn — every serious native Mac
  utility relies on this; skipping it breaks the native-feel goal outright.
- SF Pro as the only typeface.
- Sidebar + toolbar + table layout (Finder/Mail/Transmission convention).

## Deliberate risks (where this gets its own identity)

1. **Real system accent color, not hardcoded blue.** Most download
   managers (including Electron-based competitors) hardcode a brand
   color. Reading the user's actual System Settings preference is rare
   and reads as "shipped by Apple," not "ported app." Costs a small
   amount of extra plumbing (CSS system-color support, or a
   pywebview↔NSColor bridge) versus a hardcoded hex.
2. **Interrupted vs. Failed get genuinely different treatment**, not just
   different colors — the pulsing dot above. Small implementation cost
   (one CSS keyframe), resolves a real ambiguity a plain color-only
   scheme has.

## Out of scope for this pass

- AI-generated mockup variants — skipped deliberately. The user already
  has a concrete, coherent mockup (the source of this system); generating
  divergent new visuals would work against formalizing what's already
  right, not add value.
- Icon set / iconography spec — not yet decided (SF Symbols is the
  default assumption for a native macOS app, but not confirmed).
- Windows/Linux equivalents — this app is macOS-only per `apps/desktop`;
  no cross-platform design debt to track yet.
