# Runbook

## Prerequisites

- [Bun](https://bun.sh) (tested with 1.3.x)
- No node/npm required

## Dev Server

```bash
bun dev
```

Starts on `http://localhost:3000`. TypeScript is bundled on-the-fly by Bun on each request to `/app.js`. Editing any file in `src/` or `index.html` triggers a browser reload via WebSocket.

## Build (single-file release)

```bash
mkdir -p dist
bun run build.ts
```

Produces `dist/flexisender.html` — a single self-contained HTML file with all JS inlined and minified. The dev-reload snippet is stripped. Three.js is still loaded from CDN.

## Project Structure

```
index.html      — markup + CSS, loads /app.js in dev, inlined in release
serve.ts        — Bun dev server (port 3000, live reload)
build.ts        — produces dist/flexisender.html
package.json    — scripts: dev, build
src/            — TypeScript source modules
```

## Adding a New Module

1. Create `src/yourmodule.ts`
2. Import and wire it in `src/main.ts`
3. If it has functions called from HTML `onclick` handlers, expose them on `window` in `main.ts`

## Notes

- Three.js is loaded from CDN (`<script>` in `index.html`), accessed via `declare const THREE: any` in TS files
- All mutable shared state lives in `src/state.ts`
- HTML `onclick` handlers call global functions — these are assigned to `window` in `main.ts`
- The build step inlines the bundled JS back into the HTML to preserve the single-file distribution model
