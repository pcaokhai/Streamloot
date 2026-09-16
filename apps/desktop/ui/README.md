# Desktop UI

React + TypeScript + Vite + Tailwind CSS. No shadcn/ui — the design system
(`/DESIGN.md`) targets a native-macOS look (SF Pro only, native titlebar,
system accent color), which is the opposite of shadcn's default aesthetic;
Tailwind is used for layout, the token-driven CSS in `src/index.css` /
`src/design-tokens.css` still owns colors and component styling.

## Setup

```bash
npm install
npm run build   # required before running apps/desktop/main.py — see below
```

`apps/desktop/main.py` loads `ui/dist/index.html` (pywebview's own local
HTTP server, not a raw `file://` load — see the comment in `main.py` for
why). There's no dev-server wiring into pywebview; it always loads the
production build. Re-run `npm run build` after any UI change before
launching the desktop app.

## Scripts

- `npm run dev` — Vite dev server for iterating on the UI in a regular
  browser tab. `window.pywebview` won't exist there, so API calls that
  depend on it (`get_api_config`, `reveal_in_finder`) will fail — useful for
  layout/component work, not for testing real data flow.
- `npm run build` — typechecks (`tsc --noEmit`) then builds to `dist/`.
- `npm run typecheck` — typecheck only, no build.

## Structure

- `src/api.ts` — typed fetch client against the FastAPI backend
  (`apps/api/main.py`), authenticated via the key handed over through
  `window.pywebview.api.get_api_config()`.
- `src/hooks/` — `useTasks` (task state + SSE streams), `useFormatPicker`
  (debounced `/formats` lookup), `useContextMenu`, `useColumnResize`.
- `src/components/` — presentational pieces wired together in `App.tsx`.
- `src/pywebview.d.ts` — types for the `window.pywebview` bridge exposed by
  `apps/desktop/main.py`'s `JsApi` class.
