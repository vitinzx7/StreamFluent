# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Study controls

The study features (word marks and colours, special words, shortcuts, auto-pause, whole-line saving) were built from [the specification](docs/StreamFluent-especificacao-implementacao.md); [progress](docs/study-controls-progress.md) records each block, the tests run and what was and was not verified in a browser. Read both before changing these areas.

## What this is

StreamFluent is a Chrome Manifest V3 extension that overlays interactive subtitles on Netflix, Max and the explicitly supported Cinetaro HTML5 player. A left click on a subtitle word opens a card (translation, the free Dictionary API definition for English, marks, save); a right click marks it difficult at once. Words are coloured by status, lines can be repeated, saved or copied from the keyboard, and auto-pause stops at the end of each line. A library page lists saved phrases and difficult/learned words.

**Privacy constraint that shapes the design:** Netflix/Max read subtitles already rendered in the DOM; the explicit HTML5 mode also reads accessible TextTracks or a local SRT/VTT chosen by the user (no video download, no DRM circumvention, no telemetry/analytics). Outbound network calls go to exactly three hosts: `clients5.google.com` and `api.mymemory.translated.net` (translation) and `api.dictionaryapi.dev` (English definitions). What leaves the machine is the **subtitle line currently on screen** (one request per distinct line, for the translated line under the subtitle) and the clicked word — never the media title, the season/episode, the phrase library, the vocabulary, or anything identifying. The special-word list is bundled; its Linglify/Oxford links are provenance, never fetched. Keep this invariant when adding features — don't introduce new network calls or background scraping without it being an explicit, visible feature.

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

`build.mjs` bundles `src/content/content.ts`, `src/background/background.ts`, the controlled test page entry `src/content/player-test.ts`, and `src/content/netflix-main.ts`, which runs in Netflix's page world (see "Back one line" below). The content script is injected into Netflix/Max and the explicit Cinetaro host allowlist. The background worker performs bounded provider requests to avoid page CORS restrictions; it validates exact provider hosts and paths, omits credentials and rejects redirects. `popup.js` and `library.js` in `public/` are plain (unbundled, untyped) JS loaded directly by their HTML pages — they are **not** part of the TypeScript/esbuild pipeline and duplicate small bits of logic (settings values, the study protocol client in `study-client.js`, host detection) that live in `src/core` for the TS side. When changing the study protocol, schema or platform-detection logic, update both the TS core and these public/*.js duplicates.

### Streaming adapter pattern

Each platform (Netflix, Max) implements `StreamingAdapter` ([src/core/types.ts](src/core/types.ts)):

```typescript
interface StreamingAdapter {
  name: string;
  isSupportedPage(): boolean;
  observeSubtitles(onCue: (cue: SubtitleCue | null) => void): () => void;
  getMediaMetadata(): MediaMetadata | null;
  // Optional player control, used by the playback controller:
  getVideo?(): HTMLVideoElement | null;
  seekTo?(seconds: number): Promise<boolean>;
  play?(): Promise<boolean>;
  pause?(): Promise<boolean>;
  canPlayPause?(): boolean; // synchronous: Space is taken over only when true
}
```

`src/adapters/registry.ts` picks and caches an adapter based on `location.hostname`. `content.ts` is the only consumer: it gets an adapter, wires `observeSubtitles` into the on-screen overlay, and wires overlay word-clicks into translation + save.

To add a new platform: create `src/adapters/<platform>.ts` implementing `StreamingAdapter`, register it in `registry.ts`, and add its domain to `content_scripts.matches` in `public/manifest.json`.

Both existing adapters follow the same internal recipe (see [src/adapters/netflix.ts](src/adapters/netflix.ts) and [src/adapters/max.ts](src/adapters/max.ts)): a `MutationObserver` on the player container (falling back to `document.body` with a 1s-interval retry for up to 30s until the player element appears), debounced via `createDebouncedCallback` (100ms), filtering out mutations caused by the extension's own DOM (`mutationHasExtensionNode`) to avoid feedback loops between the injected overlay and the observer watching for subtitle changes.

### Extension-node marking (`src/core/dom-utils.ts`)

Every element the extension injects into the page (overlay, card, FAB button) is tagged with the `data-streamfluent` attribute via `markElement`/`EXTENSION_MARKER`. `isExtensionElement`/`mutationHasExtensionNode` use this to let adapters' MutationObservers ignore the extension's own DOM changes — without this, the overlay would trigger the observer that's watching for subtitle changes, causing loops. When adding new DOM injection points, mark them the same way.

### Data flow for a word click

`content.ts` `boot()`: adapter emits cue text → a `StudySnapshot` is built for that occurrence ([src/core/study-context.ts](src/core/study-context.ts)) → `subtitle-overlay.ts` renders it through `ui/word-renderer.ts` as `.sf-word` spans → a click calls into [src/core/word-actions.ts](src/core/word-actions.ts), shared with the HTML5 layer:

- **Left click** (`lookup`): the card (`ui/word-card.ts`) opens at once with the marks and "save word + phrase" usable while `translateWord(word, direction)` runs; the result replaces it only if the lookup id and session still match.
- **Right click** (`markDifficult`): `set-mark difficult` straight to the worker — no lookup, no phrase, works offline. Feedback ("Adicionada às difíceis" / "Já está nas difíceis") comes from the worker's `changed` flag.

Everything is captured from the snapshot before any await: the line on screen may change meanwhile. Saving a word creates a `kind: "word"` phrase. Card actions only report success after the worker confirmed the write.

`translateWord()` runs the lookups in parallel, caches successes (never failures) per `(direction, word)`, and skips `dictionaryapi.dev` entirely for `pt-en` since that API is English-only.

### Translated subtitle line

Every cue is translated as a whole and rendered under the original (`.sf-line-source` / `.sf-line-target` inside the overlay) — the point of the extension is reading the line already translated, not assembling it word by word. `translateSentence()` has its own cache keyed by `(direction, line)`, which matters because repeated lines ("Yeah.", "Come on!") are common and this is now one request per *distinct* line rather than per click.

`overlay.setTranslation(sourceText, translation)` applies a translation only if `sourceText` still matches the line on screen, and `content.ts` first checks that the reply belongs to the occurrence still shown (identical lines of different sessions or moments must not swap translations) — responses routinely land after the subtitle has already changed. `update()` clears the translated line immediately for the same reason. A translation that arrived is attached to its snapshot, so R saves it with the line; R never waits for or triggers one.

### Translation providers

`fetchTranslation()` tries `clients5.google.com/translate_a/t?client=dict-chrome-ex` first and falls back to MyMemory. The Google endpoint is **undocumented**: there is no guaranteed quota, availability or response shape. MyMemory also imposes limits. Never describe either provider as unlimited. Requests time out after 10 seconds per provider; failures remain visible and may be retried.

### Settings

[src/core/settings.ts](src/core/settings.ts) stores `{ direction, showTranslation, subtitleBottom, highlightNewWords, highlightSpecialWords, autoPause }` under the `settings` key. New installs and migrated profiles get `highlightSpecialWords: false` and `autoPause: false`; `highlightNewWords` defaults on. `content.ts` reads them at boot and subscribes via `SettingsRepository.onChange`, so a change in the popup reaches an open player without a reload. Everything read back goes through `normalizeSettings()` — storage contents are untrusted. Writes are field **patches** (`patch-settings`) or the `toggle-auto-pause` operation in the worker's queue (see "Study persistence"), so one control never wipes another's field and two quick Q presses are two toggles. `public/popup.js` duplicates the valid values (see the note above about unbundled `public/*.js`).

### In-player settings panel and drag

The `Aa` button (`.sf-fab`, always visible on a supported page) toggles `.sf-panel`: the translated-line, new-word, special-word and auto-pause toggles, the direction select, "Copiar fala"/"Salvar fala" (the same handlers as Ctrl/⌘+C and R) and links to the library and its difficult-words view.

The overlay is dragged vertically by mousedown anywhere on it; `subtitleBottom` (percent from the viewport bottom, clamped to 2–88 so it cannot be dragged off screen) is saved on mouseup. Two details make the drag coexist with word clicks: movement under 4px is treated as a click rather than a drag, and a capture-phase click listener on the overlay swallows the click that ends a real drag — without it, releasing the mouse over a word would open the lookup card every time. Right clicks never start a drag. `mousemove`/`mouseup` are bound on `document` so a fast drag that outruns the cursor still tracks.

Settings changes flow one way: a panel control calls `onSettingsChange` → `SettingsRepository.save` → worker → `chrome.storage.onChanged` → `overlay.applySettings`. The panel never updates itself directly, so the popup and the panel cannot drift apart.

### Study context, shortcuts and playback

**Snapshots.** Each presentation of a line is a `StudySnapshot` (session, source, cue and occurrence ids, text, translation once it arrived for that occurrence, direction, times, metadata, `freshKeys`). The study context keeps three: the **live** line from the source, a **held** one while auto-pause waits for the player, and the **retained** one after it paused. R, copy, S and the card study `retained ?? held ?? live`. A session on Netflix/Max is the URL path plus the `<video>` element; changing either drops snapshots, lookups and queued commands.

**Shortcuts** ([src/core/keyboard-shortcuts.ts](src/core/keyboard-shortcuts.ts)): one capture-phase `keydown` router per player window — A previous line, S repeat line, D +5 s, Space play/pause, Q auto-pause, R save line, Ctrl/⌘+C copy line. It ignores IME composition, editable targets anywhere in `composedPath()` (inputs, textareas, selects, contenteditable, shadow DOM), modified keys (only the exact Ctrl/⌘+C copies), and leaves Space/Enter to focused buttons, links, `role=button` words and `<video controls>`. A key is consumed (`preventDefault` + `stopImmediatePropagation`, plus its keyup/keypress) only when its command can run now; a held key acts once and its repeats are swallowed. Ctrl/⌘+C keeps the native copy whenever there is a selection, including inside our shadow root. On Netflix/Max the router is inactive until the session showed a subtitle, so previews and menus keep their keys. What each command does lives in [src/core/study-actions.ts](src/core/study-actions.ts), shared by keys and buttons: R saves the snapshot taken at keydown as `kind: "sentence"` without waiting for a translation; copy calls `navigator.clipboard.writeText` within the gesture and, if refused, shows the line in a read-only selected field.

**Playback** ([src/core/playback-controller.ts](src/core/playback-controller.ts)) serializes A/S/D/Space/pause per session. Times are seconds; only the Netflix bridge converts to milliseconds. Rapid presses continue from the pending target (two D presses at 120 s go to 125 then 130); seeks are clamped to the current seekable range or duration (never Infinity, never across a gap); every driver call has a deadline; a seek counts only once the video is near the target (`seeked`/position), so S plays only after it really landed; toggle and pause confirm `video.paused` before the next command; an external `seeking` resets the sequence.

**Back one line (A).** [src/core/line-timeline.ts](src/core/line-timeline.ts) **learns line times while watching** — the Netflix/Max adapters never see the subtitle file. `content.ts` forwards every cue (`navigation.cueChanged`), and the time each line appears and disappears is read from the `<video>`. [src/core/line-navigation.ts](src/core/line-navigation.ts) only answers `backTarget()`; it has no key listener. Rules worth knowing before changing it:

- During a line, A goes to the line before it; in the silence after a line — from the instant it disappears — A replays that line (someone pressing right after a line ended just missed it).
- It lands `PRE_ROLL` (0.25s) before the recorded start, since lines are recorded ~0.1s late, but never before the end of the line before (back-to-back lines would otherwise show the wrong one, very visible when paused). A recorded start only moves earlier: a line first met mid-way after a seek gets its real start once it is seen from before.
- It only goes back over video that was actually played (`played()` stretches from `timeupdate`; jumps don't count). After skipping ahead, the previous *known* line can be minutes back with unseen lines in between, so it restarts the line on screen instead.
- A changed `<video>` or URL path is a new episode: the timeline is cleared.

S uses the study line's start — real cue time + offset on the HTML5 path, the recorded time on Netflix/Max — with the same pre-roll; with no known start it says so instead of falling back to a fixed rewind.

**Netflix must not be seeked by writing `video.currentTime`** — its player errors out (M7375). `NetflixAdapter` goes through Netflix's own (undocumented) player API, `netflix.appContext.state.playerApp.getAPI().videoPlayer`, which exists only in the page's JavaScript world. [src/core/netflix-bridge.ts](src/core/netflix-bridge.ts) carries requests over DOM `CustomEvent`s with JSON-string details (only strings cross between the isolated and page worlds intact) to `netflix-main.js`, declared in the manifest with `"world": "MAIN"`. The actions are a closed set — `seek`, `play`, `pause` and `probe` (whether play/pause exist, without calling them); requests carry the episode path, are validated, and an answer for another path or no answer within 1s resolves `false`. It never falls back to writing `currentTime`. `NetflixAdapter.canPlayPause()` stays false until `probe` answered yes, so Space is left to Netflix until then. `MaxAdapter` writes `currentTime` and calls `video.play/pause` directly; that is unverified against the real Max player.

### Auto-pause

[src/core/auto-pause.ts](src/core/auto-pause.ts) pauses once at the end of each line and keeps that line on screen. One pause request at a time; the decision is recorded before awaiting the player, the line is **held** while the pause is in flight and **retained** only once confirmed; a refused pause shows a warning and returns to the live line. Resuming (`play`), any seek (`seeking`, or A/D/S) releases the retained line; words of a line hidden behind it are recorded only when it is shown. Turning Q off while paused does not resume.

- **DOM (Netflix/Max)** — cues carry `start/end` 0, which means *unknown*. The end is noticed when the line disappears or is replaced, after the adapter's debounce: **approximate** (≈0.1 s late in the local run), never compensated by seeking back. It pauses only a line shown since the last `seeking`, while the video plays normally (not paused, seeking, ended or buffering) and outside a 700 ms grace after a seek started or landed. `seeked` is not a second jump: it would disarm the line shown at the destination. Known limits: two identical consecutive lines with no DOM change are one line; a line that stays on screen across a seek does not pause at its end.
- **Timed (HTML5)** — crosses `end + offset` on the video clock between two readings (no wall-clock timers). Positively overlapping cues form one group that pauses once at its latest end, keeping the last composition shown; cues that only touch keep separate ends. A seek or offset change starts a new pass (S can pause again); a step bigger than 2.5 s is a jump, not playback; the same track loading more cues keeps a pause in flight.

### Study persistence (single writer)

The service worker is the **only writer** of `vocabulary`, `phrases`, `settings` and `studyRevision`. Content scripts, the popup and the library send `{ type: "sf:study:<action>", requestId, payload }` (`read`, `observe`, `set-mark`, `save-phrase`, `remove-phrase`, `clear-phrases`, `patch-settings`, `toggle-auto-pause`) through `requestStudy()` ([src/core/study-messages.ts](src/core/study-messages.ts)) or `public/study-client.js`. [src/core/study-storage.ts](src/core/study-storage.ts) validates sender and payload, then queues **read/migrate + apply + write** as one step, writes the changed keys with an incremented `studyRevision` in one `storage.local.set`, and answers `{ ok: true, requestId, revision, data }` only after it resolved. A failed step does not stop the queue. Data is normalized/migrated by [src/core/study-data.ts](src/core/study-data.ts); an unknown future schema is refused, never overwritten. Never write these keys with `chrome.storage.local.set` from anywhere else.

Phrases are a discriminated union: `kind: "word"` (with `selectedWord`) or `kind: "sentence"` (R). Deduplication covers kind, languages, platform, title, season, episode, whitespace-normalized text and, for words, the normalized word; a duplicate returns the existing record ("Já salvo"). Deleting phrases never touches marks, and removing a mark never touches phrases.

### Word colours (vocabulary)

[src/core/vocabulary.ts](src/core/vocabulary.ts) is a client of the worker for `vocabulary` (`VocabularyV2`: per source language, `seen`, `marks` and optional `details` with context). Personal marks are `difficult` (red `#FF8A80`) and `learned` (green `#81C784`), mutually exclusive; the old `marked` (yellow) migrates to `learned`. None of it leaves the machine. Words are keyed with `wordKey()` ([src/core/word-normalization.ts](src/core/word-normalization.ts)): NFC, lower case, typographic apostrophes folded, only outer punctuation stripped; `tokenizeWords()` keeps every space, line break and punctuation mark as text.

[src/core/word-status.ts](src/core/word-status.ts) resolves one status per word: personal mark > special (lilac `#C4A5FF`, English only, option on; [src/core/special-words.ts](src/core/special-words.ts) checks the bundled 100-word list in [src/data/special-words.en.json](src/data/special-words.en.json) by exact normalized form) > new (blue `#8ECBFF`, option on) > normal. Disabling special or new words only removes that colour.

"New" means **first appearance ever** in that language. When a line is shown, its unique keys go to `observe` with the occurrence id; the worker computes `freshKeys` against stored `seen` in its queue, so two tabs cannot both call a word new. The result belongs to that occurrence: a re-render, a translation or a settings change keeps the colours; seeing the line again later is a new occurrence with no blue. Until the stored words have loaded nothing is new, and a failed `observe` is retried with the next useful line. Marks are confirmed writes — no debounce. Both the Netflix/Max overlay and the HTML5 layer colour words; colour updates toggle classes on the existing spans instead of rebuilding the line.

### Hiding the player's own subtitles

The overlay replaces the native cues, so `hideNativeSubtitles()` ([src/core/dom-utils.ts](src/core/dom-utils.ts)) tags the cue container with `data-streamfluent-native-hidden` and injects one stylesheet rule for that attribute. Three details are load-bearing: it must be a **stylesheet rule with `!important`** (both players rewrite the inline `style` of their cue containers on every cue, so inline hiding gets wiped); it uses **`opacity: 0`, not `display: none`** (the players measure the container to position cues, and the extension reads its text); and adapters hide the element returned by `findSubtitleRoot()`, the outermost still-matching ancestor, because the inner per-cue container is destroyed and recreated on every line. Adapters only hide once `extractSubtitleText` actually returned text, so a stale selector degrades to "extension does nothing" rather than "no subtitles at all".

### Reading the cue text

`extractSubtitleText()` walks **text nodes** (a `TreeWalker`), not elements. Both players nest their cue markup — `<span><span>text</span></span>` — and an element's `textContent` already contains its descendants', so the previous per-element collection emitted every word once per level of nesting and the subtitle rendered doubled (in both languages, since the translation is made from that text). Adapters extract from the same root they hide (`findSubtitleRoot`), because a multi-line cue is split across sibling containers and `findElement` only ever returns the first.

### Season/episode parsing

`parseSeasonEpisode()` in `dom-utils.ts` is shared by both adapters: tries compact `SxxExx` first, then separate "Season N" / "Episode N" patterns. Adapters call it first against `document.title`, then fall back to querying platform-specific `EPISODE_SELECTORS` if nothing was found.

## Notable fragility

Netflix's player API used for seeking and play/pause is undocumented and can change without notice; when it does, A/S/D stop working (seeks resolve `false`) and Space goes back to Netflix's own handler, rather than breaking playback. Whether Netflix/Max handle the same keys in listeners registered before ours has not been checked on the real sites. Subtitle/player/episode CSS selectors in `netflix.ts` and `max.ts` are guesses at third-party DOM structure (`[data-testid=...]`, `[class*=...]` substring matches) and are expected to break silently when Netflix/Max change their markup — this is a known, accepted limitation, not a bug to "fix" by hardening the selectors further without evidence they're wrong.


### Timed HTML5 subtitles

Cinetaro uses `observeHtml5Player` and `createTimedSubtitles`, independently of the Netflix/Max adapters. `PlayerSnapshot` times are seconds; its session key includes the episode URL, media source and video identity, and it reports `seeking`. The controller reads `currentTime`, never an elapsed wall clock. A positive offset delays cues; a negative offset advances them. Session changes discard imported cues, offsets and stale asynchronous results. Local files are UTF-8, limited to 2 MB, and rendered as text. Line translation is opt-in and sends only the current cue, never an entire file; it is never switched on by the other path's setting. Native TextTrack modes are restored on disable/cleanup.

The layer offers the same study tools inside its Shadow DOM (own styles; only words, card and boxes take pointer events): the shared word renderer, card and colour resolver, `word-actions.ts`, the shortcut router (installed in the window of the video's document, only while the layer is on, removed on disable, native video fullscreen and `destroy`), `createHtml5Driver` for the playback controller and timed auto-pause. The language select maps English to `en` and Portuguese to `pt-BR` (no special words in Portuguese). A study session is the player session + the chosen source + its language; `TimedSubtitleView` carries an occurrence id and source times so a translation or more cues loading keep the line's identity. In native video fullscreen the layer cannot be shown: native captions come back, and auto-pause, R and copy are suspended.

Accessible same-origin frames and the explicitly identified `https://cinextream.cc` player are supported. The latter has its own `all_frames` content-script entry; `cinetaro-session.ts` coordinates one UI owner through the background relay, which validates extension identity, sender tab/frame/document and exact HTTPS host. Only opaque session IDs cross this relay, never subtitle text or page URLs. Episode changes invalidate the embedded subtitle source; a short lease removes stale owners when a frame disappears. Unknown additional hosts must be identified before adding support; do not add wildcard site permissions. The Cinetaro URL and live Netflix/Max playback were not browser-validated. `player-test.html` is a controlled local fixture, not evidence of real-site compatibility; see the progress notes for what a headless run of it did verify.
