# StreamFluent

A browser extension that helps you learn English while watching Netflix and Max.
Click on any subtitle word to see its definition, then save it for later review.

> **Privacy first:** the extension only reads subtitles the browser already
> displays to you. It never downloads video, breaks DRM, or sends data to
> external servers except for dictionary lookups.

## Features

- **Interactive subtitles** — click any word in the subtitle to see its definition
- **Save phrases** — store words with their full sentence context
- **Auto-translation** — definitions fetched from the free Dictionary API
- **Media metadata** — automatically captures show title, season, and episode
- **Phrase library** — browse, search, and filter all your saved phrases
- **Multi-platform** — works on Netflix and Max (HBO Max)
- **Keyboard shortcuts** — `Ctrl+Shift+L` opens the phrase library
- **Non-intrusive** — minimal UI that doesn't interfere with the player

## Architecture

```
Extension
   |
   +-- Core
   |     +-- Subtitle Overlay (interactive word selection)
   |     +-- Storage (chrome.storage.local)
   |     +-- Translation (Dictionary API)
   |     +-- Types & Utilities
   |
   +-- Streaming Adapters
         +-- NetflixAdapter
         +-- MaxAdapter
```

Each streaming platform implements the `StreamingAdapter` interface:

```typescript
interface StreamingAdapter {
  name: string;
  isSupportedPage(): boolean;
  observeSubtitles(onCue: (cue: SubtitleCue | null) => void): () => void;
  getMediaMetadata(): MediaMetadata | null;
}
```

This makes it straightforward to add support for new platforms.

## Technologies

- TypeScript
- HTML / CSS
- Chrome Extension Manifest V3
- esbuild (bundler)
- Vitest (tests)
- Dictionary API (free, no key required)

## Project Structure

```
public/
  manifest.json      # Extension manifest (Manifest V3)
  popup.html         # Extension popup
  popup.js           # Popup script
  library.html       # Saved phrases page
  library.js         # Library script
src/
  content/
    content.ts       # Entry point (injected into streaming pages)
  core/
    types.ts         # Shared TypeScript types
    utils.ts         # Utility functions
    storage.ts       # chrome.storage wrapper
    translation.ts   # Dictionary API client
    dom-utils.ts     # Shared DOM utilities
    ui/
      subtitle-overlay.ts  # Interactive subtitle UI
  adapters/
    registry.ts      # Adapter detection and caching
    netflix.ts       # Netflix adapter
    max.ts           # Max adapter
  __tests__/         # Unit tests
build.mjs            # esbuild configuration
```

## Requirements

- Node.js 18+
- Chrome or Edge browser

## Setup

```bash
npm install
npm run build
```

## Scripts

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run build`     | Build the extension into `dist/`         |
| `npm run watch`     | Rebuild automatically on file changes    |
| `npm run typecheck` | Run TypeScript type checking             |
| `npm run test`      | Run unit tests                           |
| `npm run test:watch`| Run tests in watch mode                  |

## Install in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Open Netflix or Max and start watching

## Install in Edge

1. Go to `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Open Netflix or Max and start watching

## Usage

1. Open Netflix or Max in your browser
2. Start playing a video with English subtitles
3. Our subtitle overlay appears over the video
4. Click any word to see its definition
5. Click **Save Phrase** to store it
6. Press `Ctrl+Shift+L` or click the floating button to open your phrase library

## Limitations

- Subtitle detection depends on the streaming site's DOM structure, which may
  change without notice
- Definitions come from the free Dictionary API and may not cover all words
- Season/episode detection is best-effort and may not work for all content
- The extension requires English subtitles to be enabled on the streaming site

## Adding a New Streaming Adapter

1. Create `src/adapters/yourplatform.ts`
2. Implement the `StreamingAdapter` interface
3. Register it in `src/adapters/registry.ts`
4. Add the domain to `manifest.json` content_scripts matches

```typescript
export class YourPlatformAdapter implements StreamingAdapter {
  name = "YourPlatform";

  isSupportedPage(): boolean {
    return location.hostname.includes("yourplatform.com");
  }

  observeSubtitles(onCue: (cue: SubtitleCue | null) => void): () => void {
    // Use MutationObserver to watch for subtitle changes
    // Return a cleanup function
  }

  getMediaMetadata(): MediaMetadata | null {
    // Extract title, season, episode from the page
  }
}
```

## Privacy

- **No data leaves your browser** except dictionary API lookups
- **No video download** or DRM circumvention
- **No tracking** or analytics
- **No accounts** or authentication required
- All saved phrases are stored locally in your browser
- The dictionary API is free and requires no API key

## Future Plans

The architecture supports adding:

- Disney+, Prime Video, YouTube, Crunchyroll
- Spaced repetition review
- Flashcards
- Word statistics
- Export/import
- Cross-device sync
