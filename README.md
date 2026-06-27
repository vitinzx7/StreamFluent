# StreamFluent

A browser extension (Manifest V3) that draws a custom subtitle layer on top of
the video to study English. The streaming audio and video are never touched —
only an interface on top.

> Legal boundary: the extension only **reads** the subtitle the browser already
> receives (as an authorized subscriber) and draws its own layer. It does not
> break DRM, download, or redistribute content.

## Requirements

- Node.js 18+ (tested with v22)

## Setup

```bash
npm install      # downloads typescript, esbuild and @types/chrome
npm run build    # generates the dist/ folder
```

## Load in the browser (developer mode)

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right corner).
3. Click **Load unpacked** and point it at the **`dist/`** folder.
4. Open Netflix. Every time you run `npm run build`, click **Reload** on the
   extension.

Tip: `npm run watch` rebuilds automatically whenever you save a file.

## Scripts

| Command             | What it does                                          |
| ------------------- | ---------------------------------------------------- |
| `npm run build`     | Generates `dist/` (content script bundle + manifest). |
| `npm run watch`     | Same as build, but rebuilds on save.                 |
| `npm run typecheck` | Runs TypeScript only to check types (emits no JS).   |

## Structure

```
public/
  manifest.json     # declares the extension and where it runs (Netflix)
src/
  content/
    content.ts      # entry point — runs inside the page
  core/
    subtitles.ts    # capture/read the subtitle
    overlay.ts      # draw the subtitle on screen
    vocabulary.ts   # save word + Anki export
build.mjs           # bundle with esbuild  ->  dist/
dist/               # build output (not committed)
```

## Security notes

- **Least privilege:** `manifest.json` requests only what is needed. Add
  permissions (e.g. `storage`) only when the code that uses them exists.
- **No secrets in the client:** the bundle ships to the user's browser and is
  readable. Never embed API keys here — they belong behind a back-end.
- **External content:** subtitle text is third-party data. Treat it as
  untrusted (avoid `innerHTML`) to prevent XSS.
```
