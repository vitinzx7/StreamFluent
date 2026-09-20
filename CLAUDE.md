# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StreamFluent is a Chrome Manifest V3 extension that overlays interactive subtitles on Netflix and Max, letting users click a subtitle word to look up its definition (via the free Dictionary API) and save the word+sentence as a "phrase" for later review in a library page.

**Privacy constraint that shapes the design:** Netflix/Max read subtitles already rendered in the DOM; the explicit HTML5 mode also reads accessible TextTracks or a local SRT/VTT chosen by the user (no video download, no DRM circumvention, no telemetry/analytics). Outbound network calls go to exactly three hosts: `clients5.google.com` and `api.mymemory.translated.net` (translation) and `api.dictionaryapi.dev` (English definitions). What leaves the machine is the **subtitle line currently on screen** (one request per distinct line, for the translated line under the subtitle) and the clicked word — never the media title, the season/episode, the phrase library, or anything identifying. Keep this invariant when adding features — don't introduce new network calls or background scraping without it being an explicit, visible feature.

## Commands

```bash
npm run build       # bundle src/content/content.ts -> dist/content.js via esbuild, copy public/ -> dist/
npm run watch        # same, in watch mode
npm run typecheck    # tsc --noEmit (strict mode, no emit)
npm test             # vitest run
npm run test:watch   # vitest in watch mode
```

Run a single test file: `npx vitest run src/__tests__/dedup.test.ts`

To load the built extension in Chrome: build first, then load `dist/` as an unpacked extension via `chrome://extensions`.

There is no lint script and no CI config in this repo — `typecheck` and `test` are the only automated gates.

## Architecture

`build.mjs` bundles `src/content/content.ts`, `src/background/background.ts` and the controlled test page entry `src/content/player-test.ts`. The content script is injected into Netflix/Max and the explicit Cinetaro host allowlist. The background worker performs bounded provider requests to avoid page CORS restrictions; it validates exact provider hosts and paths, omits credentials and rejects redirects. `popup.js` and `library.js` in `public/` are plain (unbundled, untyped) JS loaded directly by their HTML pages — they are **not** part of the TypeScript/esbuild pipeline and duplicate small bits of logic (e.g. the storage key and CRUD, host detection) that live in `src/core` for the TS side. When changing storage schema or platform-detection logic, update both the TS core and these public/*.js duplicates.

### Streaming adapter pattern

Each platform (Netflix, Max) implements `StreamingAdapter` ([src/core/types.ts](src/core/types.ts)):

```typescript
interface StreamingAdapter {
  name: string;
  isSupportedPage(): boolean;
  observeSubtitles(onCue: (cue: SubtitleCue | null) => void): () => void;
  getMediaMetadata(): MediaMetadata | null;
}
```

`src/adapters/registry.ts` picks and caches an adapter based on `location.hostname`. `content.ts` is the only consumer: it gets an adapter, wires `observeSubtitles` into the on-screen overlay, and wires overlay word-clicks into translation + save.

To add a new platform: create `src/adapters/<platform>.ts` implementing `StreamingAdapter`, register it in `registry.ts`, and add its domain to `content_scripts.matches` in `public/manifest.json`.

Both existing adapters follow the same internal recipe (see [src/adapters/netflix.ts](src/adapters/netflix.ts) and [src/adapters/max.ts](src/adapters/max.ts)): a `MutationObserver` on the player container (falling back to `document.body` with a 1s-interval retry for up to 30s until the player element appears), debounced via `createDebouncedCallback` (100ms), filtering out mutations caused by the extension's own DOM (`mutationHasExtensionNode`) to avoid feedback loops between the injected overlay and the observer watching for subtitle changes.

### Extension-node marking (`src/core/dom-utils.ts`)

Every element the extension injects into the page (overlay, card, FAB button) is tagged with the `data-streamfluent` attribute via `markElement`/`EXTENSION_MARKER`. `isExtensionElement`/`mutationHasExtensionNode` use this to let adapters' MutationObservers ignore the extension's own DOM changes — without this, the overlay would trigger the observer that's watching for subtitle changes, causing loops. When adding new DOM injection points, mark them the same way.

### Data flow for a word click

`content.ts` `boot()`: adapter emits cue text → `subtitle-overlay.ts` renders clickable `.sf-word` spans → click calls back into `content.ts` with `(word, sentence)` → shows a loading card immediately → calls `translateWord(word, direction)` ([src/core/translation.ts](src/core/translation.ts)) → re-renders the card with the translation (plus the dictionary definition when the source language is English) → "Save Phrase" button calls `PhraseRepository.save()` ([src/core/storage.ts](src/core/storage.ts)), which dedupes on `(sentence, selectedWord, platform)` and persists to `chrome.storage.local`.

`translateWord()` runs the lookups in parallel, caches successes (never failures) per `(direction, word)`, and skips `dictionaryapi.dev` entirely for `pt-en` since that API is English-only. Lookups are tagged with an incrementing id in `content.ts` so a slow response can't overwrite a newer card.

### Translated subtitle line

Every cue is translated as a whole and rendered under the original (`.sf-line-source` / `.sf-line-target` inside the overlay) — the point of the extension is reading the line already translated, not assembling it word by word. `translateSentence()` has its own cache keyed by `(direction, line)`, which matters because repeated lines ("Yeah.", "Come on!") are common and this is now one request per *distinct* line rather than per click.

`overlay.setTranslation(sourceText, translation)` applies a translation only if `sourceText` still matches the line on screen — responses routinely land after the subtitle has already changed, and without that guard the wrong translation pairs with the wrong line. `update()` clears the translated line immediately for the same reason.

### Translation providers

`fetchTranslation()` tries `clients5.google.com/translate_a/t?client=dict-chrome-ex` first and falls back to MyMemory. The Google endpoint is **undocumented**: there is no guaranteed quota, availability or response shape. MyMemory also imposes limits. Never describe either provider as unlimited. Requests time out after 10 seconds per provider; failures remain visible and may be retried.

### Language direction setting

[src/core/settings.ts](src/core/settings.ts) stores `{ direction, showTranslation, subtitleBottom }` under the `settings` key in `chrome.storage.local`. `content.ts` reads it at boot and subscribes via `SettingsRepository.onChange`, so switching direction in the popup takes effect in an already-open player tab without a reload. Everything read back from storage goes through `normalizeSettings()` — storage contents are untrusted. `public/popup.js` duplicates the key and the valid values (see the note above about unbundled `public/*.js`).

### In-player settings panel and drag

The `Aa` button (`.sf-fab`, always visible on a supported page) toggles `.sf-panel`, which holds the translated-line toggle, the direction select, and a link to the library — the same settings the popup writes, so both write the whole `settings` object and `public/popup.js` must **merge** rather than replace (it has no control for `subtitleBottom`, and a replacing write would wipe the position the user dragged to).

The overlay is dragged vertically by mousedown anywhere on it; `subtitleBottom` (percent from the viewport bottom, clamped to 2–88 so it cannot be dragged off screen) is saved on mouseup. Two details make the drag coexist with word clicks: movement under 4px is treated as a click rather than a drag, and a capture-phase click listener on the overlay swallows the click that ends a real drag — without it, releasing the mouse over a word would open the lookup card every time. `mousemove`/`mouseup` are bound on `document` so a fast drag that outruns the cursor still tracks.

Settings changes flow one way: a panel control calls `onSettingsChange` → `SettingsRepository.save` → `chrome.storage.onChanged` → `overlay.applySettings`. The panel never updates itself directly, so the popup and the panel cannot drift apart.

### Hiding the player's own subtitles

The overlay replaces the native cues, so `hideNativeSubtitles()` ([src/core/dom-utils.ts](src/core/dom-utils.ts)) tags the cue container with `data-streamfluent-native-hidden` and injects one stylesheet rule for that attribute. Three details are load-bearing: it must be a **stylesheet rule with `!important`** (both players rewrite the inline `style` of their cue containers on every cue, so inline hiding gets wiped); it uses **`opacity: 0`, not `display: none`** (the players measure the container to position cues, and the extension reads its text); and adapters hide the element returned by `findSubtitleRoot()`, the outermost still-matching ancestor, because the inner per-cue container is destroyed and recreated on every line. Adapters only hide once `extractSubtitleText` actually returned text, so a stale selector degrades to "extension does nothing" rather than "no subtitles at all".

### Reading the cue text

`extractSubtitleText()` walks **text nodes** (a `TreeWalker`), not elements. Both players nest their cue markup — `<span><span>text</span></span>` — and an element's `textContent` already contains its descendants', so the previous per-element collection emitted every word once per level of nesting and the subtitle rendered doubled (in both languages, since the translation is made from that text). Adapters extract from the same root they hide (`findSubtitleRoot`), because a multi-line cue is split across sibling containers and `findElement` only ever returns the first.

### Season/episode parsing

`parseSeasonEpisode()` in `dom-utils.ts` is shared by both adapters: tries compact `SxxExx` first, then separate "Season N" / "Episode N" patterns. Adapters call it first against `document.title`, then fall back to querying platform-specific `EPISODE_SELECTORS` if nothing was found.

## Notable fragility

Subtitle/player/episode CSS selectors in `netflix.ts` and `max.ts` are guesses at third-party DOM structure (`[data-testid=...]`, `[class*=...]` substring matches) and are expected to break silently when Netflix/Max change their markup — this is a known, accepted limitation, not a bug to "fix" by hardening the selectors further without evidence they're wrong.


### Timed HTML5 subtitles

Cinetaro uses `observeHtml5Player` and `createTimedSubtitles`, independently of the Netflix/Max adapters. `PlayerSnapshot` times are seconds; its session key includes the episode URL, media source and video identity. The controller reads `currentTime`, never an elapsed wall clock. A positive offset delays cues; a negative offset advances them. Session changes discard imported cues, offsets and stale asynchronous results. Local files are UTF-8, limited to 2 MB, and rendered as text. Translation is opt-in and sends only the current cue, never an entire file. Native TextTrack modes are restored on disable/cleanup.

Accessible same-origin frames and the explicitly identified `https://cinextream.cc` player are supported. The latter has its own `all_frames` content-script entry; `cinetaro-session.ts` coordinates one UI owner through the background relay, which validates extension identity, sender tab/frame/document and exact HTTPS host. Only opaque session IDs cross this relay, never subtitle text or page URLs. Episode changes invalidate the embedded subtitle source; a short lease removes stale owners when a frame disappears. Unknown additional hosts must be identified before adding support; do not add wildcard site permissions. The Cinetaro URL and live Netflix playback were not browser-validated in this delivery. `player-test.html` is a controlled local fixture, not evidence of real-site compatibility.
