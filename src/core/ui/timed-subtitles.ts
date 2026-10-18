import { EXTENSION_MARKER, parseSeasonEpisode } from "../dom-utils.ts";
import { isCinetaroUrl, isEmbeddedPlayerUrl } from "../frame-messages.ts";
import type { PlayerSnapshot } from "../player-types.ts";
import type { SubtitleCue } from "../types.ts";
import { translateSentence } from "../translation.ts";
import {
  decodeSubtitleFile, MAX_SUBTITLE_BYTES, subtitlePlainText,
  TimedSubtitleController, type TimedSubtitleView, type SubtitleLanguage,
} from "../subtitles.ts";
import { DEFAULT_SETTINGS, SettingsRepository, getLangPair, type LanguageDirection, type Settings } from "../settings.ts";
import { PhraseRepository } from "../storage.ts";
import { createVocabularyStore } from "../vocabulary.ts";
import { resolveWordStatus } from "../word-status.ts";
import { createStudyContext, type StudySnapshot } from "../study-context.ts";
import { createHtml5Driver, createPlaybackController } from "../playback-controller.ts";
import { createLineNavigation } from "../line-navigation.ts";
import { createStudyActions } from "../study-actions.ts";
import { installShortcuts } from "../keyboard-shortcuts.ts";
import { createTimedAutoPause, overlapGroups, type CueGroup } from "../auto-pause.ts";
import { createWordActions } from "../word-actions.ts";
import { createWordRenderer, WORD_STYLES } from "./word-renderer.ts";
import { createWordCard, CARD_STYLES } from "./word-card.ts";
import { createIdleFade, isolatePointer, IDLE_CLASS } from "./idle-fade.ts";

let activeInstance: { destroy(): void } | null = null;

const FEEDBACK_MS = 3000;
const NO_WORDS: ReadonlySet<string> = new Set();

/** The source-language picker maps onto the extension's personal language keys. */
function directionFor(language: string): LanguageDirection {
  return language === "pt" ? "pt-en" : "en-pt";
}

/**
 * A separate opt-in interface keeps the established Netflix/Max flow
 * untouched, but offers the same study tools: clickable coloured words, the
 * word card, the shortcuts and auto-pause, all inside its own Shadow DOM.
 */
export function createTimedSubtitles(): { updatePlayer(state: PlayerSnapshot): void; destroy(): void } {
  activeInstance?.destroy();
  const host = document.createElement("div");
  host.setAttribute(EXTENSION_MARKER, "");
  host.setAttribute("data-streamfluent-timed", "");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  // Only this constant template uses HTML; cue text, names and errors use textContent.
  shadow.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      * { box-sizing: border-box; }
      button,select,input,textarea { font: inherit; }
      button,select { color:#f5f7fa; background:#24334a; border:1px solid #536078; border-radius:6px; padding:7px; }
      button { cursor:pointer; } button:hover { background:#344b69; }
      [hidden] { display:none !important; }
      /* Mid-height on the right edge: clear of the player's own bottom controls. */
      .fab,.panel { position:fixed; right:16px; top:50%; transform:translateY(-50%); font:14px/1.5 system-ui,sans-serif; pointer-events:auto; }
      .fab { background:#142d32; color:#8bf2d9; transition:opacity .2s; }
      .fab.${IDLE_CLASS} { opacity:0; pointer-events:none; }
      .panel { right:64px; padding:16px; width:350px; max-width:calc(100vw - 24px); max-height:calc(100vh - 90px); overflow:auto; color:#f5f7fa; background:#111a29; border:1px solid #536078; border-radius:10px; box-shadow:0 4px 20px #0009; }
      label { display:block; margin:10px 0; } select,input[type=file] { display:block; width:100%; margin-top:5px; }
      input[type=checkbox] { margin-right:6px; }
      .small { font-size:12px; color:#bac8d9; } .status { color:#8bf2d9; }
      .offset,.actions { display:flex; gap:5px; flex-wrap:wrap; } .offset button { font-size:12px; }
      .captions { position:fixed; transform:translateX(-50%); text-align:center; white-space:pre-line; color:white; font:600 22px/1.4 system-ui,sans-serif; text-shadow:0 1px 3px #000; }
      .source,.target { background:#000b; padding:2px 8px; border-radius:4px; overflow-wrap:anywhere; }
      .target { color:#8bf2d9; margin-top:3px; } .source:empty,.target:empty { display:none; }
      .translation-state { font-size:13px; background:#111d; }
      /* The host lets clicks through to the player; only words and our boxes take them. */
      .sf-word { pointer-events:auto; }
      .sf-card { position:fixed; z-index:2; }
      .copy { position:fixed; left:50%; top:30%; transform:translateX(-50%); width:min(480px, calc(100vw - 32px)); padding:14px; border-radius:10px; background:#111a29; border:1px solid #536078; color:#f5f7fa; font:13px/1.4 system-ui,sans-serif; pointer-events:auto; user-select:text; }
      .copy textarea { display:block; width:100%; margin:8px 0; padding:6px; color:#fff; background:#16213e; border:1px solid #536078; border-radius:5px; resize:vertical; }
      .feedback { position:fixed; left:50%; top:10%; transform:translateX(-50%); padding:6px 10px; border-radius:6px; background:#111a29; color:#fff; font:14px/1.4 system-ui,sans-serif; pointer-events:none; }
      .feedback:empty { display:none; }
      ${WORD_STYLES}
      ${CARD_STYLES}
    </style>
    <button class="fab" type="button" aria-expanded="false">SF · Legendas</button>
    <section class="panel" aria-label="StreamFluent: legendas do player" hidden>
      <strong>StreamFluent · Player HTML5</strong>
      <p class="status" data-control="status" role="status"></p>
      <label><input type="checkbox" data-control="enabled">Ativar camada de legendas</label>
      <label>Faixa ou arquivo<select data-control="source"><option value="">Escolha uma fonte</option></select></label>
      <label>Importar SRT/VTT local (UTF-8, até 2 MB)<input type="file" accept=".srt,.vtt" data-control="file"></label>
      <label>Idioma da fonte<select data-control="language"><option value="en">Inglês</option><option value="pt">Já está em português</option></select></label>
      <label><input type="checkbox" data-control="translate">Traduzir inglês → português brasileiro</label>
      <p class="small">Ao ativar a tradução, somente a fala atual é enviada a clients5.google.com e, se necessário, api.mymemory.translated.net. O arquivo inteiro não é enviado. Serviços externos podem falhar ou limitar o uso.</p>
      <label><input type="checkbox" data-control="auto-pause">Pausa automática no fim de cada fala</label>
      <div class="actions"><button type="button" data-control="copy-line">Copiar fala</button><button type="button" data-control="save-line">Salvar fala</button></div>
      <p class="small">A: fala anterior · S: repetir fala · D: avançar 5 s · Espaço: reproduzir/pausar · Q: pausa automática · R: salvar fala · Ctrl/⌘+C: copiar fala. Os atalhos valem com o foco neste player. Clique numa palavra para consultar; o botão direito a marca como difícil.</p>
      <div class="offset"><button type="button" data-control="earlier">Adiantar 0,5 s</button><button type="button" data-control="later">Atrasar 0,5 s</button><button type="button" data-control="reset">Restaurar</button></div>
      <p data-control="offset">Ajuste: 0,0 s</p>
      <p class="small">Ajuste positivo atrasa. Um ajuste fixo não corrige outra edição ou descompasso crescente. Falas ausentes não são transcritas.</p>
      <p class="small" data-control="file-status" role="status"></p>
      <p class="small">Se o vídeo entrar sozinho em tela cheia nativa, a camada não pode aparecer. Use a tela cheia do contêiner do player.</p>
      <button type="button" data-control="retry" hidden>Tentar traduzir a fala atual novamente</button>
    </section>
    <div class="captions" hidden><div class="source"></div><div class="target"></div><div class="translation-state" role="status"></div></div>
    <div class="sf-card sf-hidden"></div>
    <div class="copy" role="dialog" aria-label="Copiar fala" hidden>
      <div>Não foi possível copiar automaticamente. Pressione Ctrl+C (⌘C no Mac) para copiar a fala.</div>
      <textarea data-control="copy-text" readonly rows="3"></textarea>
      <button type="button" data-control="copy-close">Fechar</button>
    </div>
    <div class="feedback" role="status" aria-live="polite"></div>
  `;
  const get = <T extends HTMLElement>(selector: string): T => shadow.querySelector<T>(selector)!;
  const enabled = get<HTMLInputElement>('[data-control="enabled"]');
  const translate = get<HTMLInputElement>('[data-control="translate"]');
  const autoPauseInput = get<HTMLInputElement>('[data-control="auto-pause"]');
  const sources = get<HTMLSelectElement>('[data-control="source"]');
  const fileInput = get<HTMLInputElement>('[data-control="file"]');
  const language = get<HTMLSelectElement>('[data-control="language"]');
  const offsetLabel = get<HTMLElement>('[data-control="offset"]');
  const status = get<HTMLElement>('[data-control="status"]');
  const fileStatus = get<HTMLElement>('[data-control="file-status"]');
  const captions = get<HTMLElement>(".captions");
  const sourceLine = get<HTMLElement>(".source");
  const targetLine = get<HTMLElement>(".target");
  const translationState = get<HTMLElement>(".translation-state");
  const retry = get<HTMLButtonElement>('[data-control="retry"]');
  const panel = get<HTMLElement>(".panel");
  const fab = get<HTMLButtonElement>(".fab");
  const cardElement = get<HTMLElement>(".sf-card");
  const copyBox = get<HTMLElement>(".copy");
  const copyText = get<HTMLTextAreaElement>('[data-control="copy-text"]');
  const feedbackElement = get<HTMLElement>(".feedback");
  let currentDocument = document;
  let snapshot: PlayerSnapshot | null = null;
  let tracks: TextTrack[] = [];
  let selectedTrack: TextTrack | null = null;
  let imported: SubtitleCue[] | null = null;
  let importedName = "";
  let cueSignature = "";
  let usable = false;
  let offset = 0;
  let destroyed = false;
  let fileGeneration = 0;
  let displayed: TimedSubtitleView = { source: "", translation: "", state: "idle" };
  const nativeModes = new Map<TextTrack, TextTrackMode>();

  // ---- study state: one session per episode + chosen source + language ----
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let sourceVersion = 0;
  let groups: CueGroup[] = [];
  let shownOccurrence = "";
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const studySession = (): string => `${snapshot?.sessionKey ?? ""}|${sourceVersion}|${language.value}`;
  const alive = (): boolean => !destroyed;
  const context = createStudyContext();
  const vocabulary = createVocabularyStore();

  const showFeedback = (message: string): void => {
    feedbackElement.textContent = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedbackElement.textContent = ""; }, FEEDBACK_MS);
  };

  const wordStatus = (word: string) => {
    const shown = context.study;
    if (!shown) return null;
    const key = getLangPair(shown.direction).source;
    const status = resolveWordStatus(word, key, vocabulary.getMark(word, key), shown.freshKeys, settings);
    return status === "normal" ? null : status;
  };

  const words = createWordActions({
    vocabulary,
    study: () => context.study,
    sessionId: studySession,
    isAlive: alive,
    showCard: (content, onSave, onMark) => {
      positionCard();
      card.show(content, onSave, onMark);
    },
    refresh: () => renderer.refresh(),
    feedback: showFeedback,
  });
  const renderer = createWordRenderer(sourceLine, {
    status: wordStatus,
    select: (word) => void words.lookup(word),
    difficult: (word) => words.markDifficult(word),
  });
  const card = createWordCard(cardElement, () => words.cancel());

  function positionCard(): void {
    const rect = sourceLine.querySelector(".sf-selected")?.getBoundingClientRect();
    const view = currentDocument.defaultView;
    const width = view?.innerWidth ?? 800;
    cardElement.style.left = rect ? `${Math.max(8, Math.min(rect.left, width - 370 - 64))}px` : "50%";
    cardElement.style.top = rect ? `${Math.max(8, rect.top - 220)}px` : "20%";
    cardElement.style.transform = rect ? "" : "translateX(-50%)";
  }

  const video = (): HTMLVideoElement | null => snapshot?.video ?? null;
  const driver = createHtml5Driver(video, studySession);
  // A goes back over lines learned as they are shown, the same rules as Netflix/Max.
  const navigation = createLineNavigation({ getVideo: video, seekTo: driver.seekTo });
  const releaseRetained = (): void => {
    if (!context.retained && !context.held) return;
    context.release();
    present();
  };
  const onJump = (): void => {
    autoPause.jumped();
    releaseRetained();
  };
  const controller = createPlaybackController(driver, {
    backTarget: (from) => navigation.backTarget(from),
    onNavigate: onJump,
  });
  const autoPause = createTimedAutoPause({
    enabled: () => settings.autoPause && enabled.checked && !isVideoFullscreen(),
    pause: () => controller.pause(),
    hold: (line) => {
      context.hold(line);
      present();
    },
    retain: (line) => {
      context.retain(line);
      present();
    },
    failed: () => {
      context.release();
      present();
      showFeedback("A pausa automática não conseguiu pausar o vídeo.");
    },
  });
  const actions = createStudyActions({
    controller,
    study: () => context.study,
    sessionId: studySession,
    toggleAutoPause: () => SettingsRepository.toggleAutoPause(),
    savePhrase: (phrase) => PhraseRepository.saveResult(phrase),
    feedback: showFeedback,
    showCopyFallback: (text) => {
      copyText.value = text;
      copyBox.hidden = false;
      // The user asked to copy: focusing the field is what makes Ctrl+C work.
      copyText.focus();
      copyText.select();
    },
    clipboard: () => currentDocument.defaultView?.navigator.clipboard,
  });

  const engine = new TimedSubtitleController((text) => translateSentence(text, "en-pt"), render);

  function isVideoFullscreen(): boolean {
    return !!snapshot?.video && currentDocument.fullscreenElement === snapshot.video;
  }

  /** Where the line before `sourceStart` ended, in video time, for S's pre-roll. */
  function previousEnd(sourceStart: number): number | undefined {
    let end: number | undefined;
    for (const group of groups) {
      if (group.end > sourceStart) break;
      end = group.end;
    }
    return end === undefined ? undefined : end + engine.offsetSeconds;
  }

  function timedSnapshot(view: TimedSubtitleView, occurrenceId: string): StudySnapshot {
    const title = document.title.trim();
    const { season, episode } = parseSeasonEpisode(title);
    const shift = engine.offsetSeconds;
    const before = view.start === undefined ? undefined : previousEnd(view.start);
    return {
      sessionId: studySession(),
      sourceId: String(sourceVersion),
      cueId: view.cueIds ?? "",
      occurrenceId,
      text: view.source,
      ...(view.translation ? { translation: view.translation } : {}),
      direction: directionFor(language.value),
      // Real cue times, moved by the offset to where they play on the video.
      ...(view.start !== undefined ? { start: view.start + shift } : {}),
      ...(view.end !== undefined ? { end: view.end + shift } : {}),
      ...(before !== undefined ? { previousEnd: before } : {}),
      platform: isCinetaroUrl(location.href) || isEmbeddedPlayerUrl(location.href) ? "Cinetaro" : "HTML5",
      mediaTitle: title,
      season,
      episode,
      freshKeys: NO_WORDS,
    };
  }

  /** The engine's view is the live line; a translation alone keeps its occurrence. */
  function updateLive(view: TimedSubtitleView): void {
    if (!view.source || view.occurrence === undefined) {
      if (context.live) {
        navigation.cueChanged(null);
        context.setLive(null);
      }
      return;
    }
    const occurrenceId = `${studySession()}#${view.occurrence}`;
    if (context.live?.occurrenceId === occurrenceId) {
      if (view.translation) context.translate(occurrenceId, view.translation);
      return;
    }
    navigation.cueChanged(view.source);
    const next = timedSnapshot(view, occurrenceId);
    autoPause.shown(next, view.start);
    context.setLive(next);
  }

  /** Words count as seen only once their line is actually on screen. */
  function observeWords(shown: StudySnapshot): void {
    void vocabulary
      .observeLine(shown.text, getLangPair(shown.direction).source, shown.occurrenceId)
      .then((fresh) => {
        if (destroyed) return;
        context.setFresh(shown.occurrenceId, fresh);
        renderer.refresh();
      })
      .catch(() => showFeedback("Não foi possível registrar o histórico desta fala."));
  }

  /** Shows the study line: retained by auto-pause, else the live one. */
  function present(): void {
    const shown = context.study;
    const occurrence = shown?.occurrenceId ?? "";
    if (occurrence !== shownOccurrence) {
      shownOccurrence = occurrence;
      renderer.update(shown?.text ?? "");
      if (shown) observeWords(shown);
    } else {
      renderer.refresh();
    }
    // The live line follows the engine's translation; a retained one keeps its own.
    const live = !!shown && shown.occurrenceId === context.live?.occurrenceId && !context.retained && !context.held;
    targetLine.textContent = live ? displayed.translation : shown?.translation ?? "";
    translationState.textContent = !live ? ""
      : displayed.state === "loading" ? "Traduzindo a fala atual…"
      : displayed.state === "error" ? "Tradução indisponível; original mantido. Tente novamente no painel SF." : "";
    retry.hidden = !live || displayed.state !== "error";
    captions.hidden = !enabled.checked || !shown || isVideoFullscreen() || !snapshot?.video;
  }

  function render(view: TimedSubtitleView): void {
    displayed = view;
    updateLive(view);
    present();
  }

  /** Another episode, source or language: nothing pending may reach the new one. */
  function newStudySource(): void {
    sourceVersion++;
    words.cancel();
    card.hide();
    autoPause.reset();
    navigation.reset();
    controller.invalidate();
    context.clear();
    present();
  }

  /** The layer stopped showing lines (disabled, native fullscreen): let go of what it held. */
  function suspendStudy(): void {
    autoPause.reset();
    words.cancel();
    card.hide();
    releaseRetained();
  }

  function restoreTracks(): void {
    for (const [track, mode] of nativeModes) {
      // Do not overwrite a preference the user/player changed while we held it.
      if (track.mode === "hidden") track.mode = mode;
    }
    nativeModes.clear();
  }

  function hideTrack(track: TextTrack): void {
    if (track.mode === "hidden") return;
    if (!nativeModes.has(track)) nativeModes.set(track, track.mode);
    track.mode = "hidden";
  }

  function updateModes(): void {
    if (!enabled.checked || isVideoFullscreen() || !snapshot?.video) {
      restoreTracks();
      return;
    }
    // Disabled tracks need activation to load cues; showing unreadable tracks stay visible.
    if (selectedTrack?.mode === "disabled") hideTrack(selectedTrack);
    if (!usable) {
      for (const [track, mode] of nativeModes) {
        if (mode !== "showing") continue;
        if (track.mode === "hidden") track.mode = mode;
        nativeModes.delete(track);
      }
    }
    if (usable) for (const track of tracks) if (track.mode === "showing") hideTrack(track);
  }

  function rebuildSources(): void {
    const selectedValue = sources.value;
    sources.replaceChildren();
    const option = (value: string, label: string) => {
      const item = currentDocument.createElement("option");
      item.value = value;
      item.textContent = label;
      sources.appendChild(item);
    };
    option("", "Escolha uma fonte");
    tracks.forEach((track, index) => option(String(index), `${track.label || `Faixa ${index + 1}`} (${track.language || "idioma desconhecido"})`));
    if (imported) option("file", `Arquivo: ${importedName}`);
    sources.value = selectedTrack ? String(tracks.indexOf(selectedTrack)) : imported && selectedValue === "file" ? "file" : "";
  }

  function resetOffset(): void {
    offset = 0;
    offsetLabel.textContent = "Ajuste: 0,0 s";
    engine.setOffset(0);
  }

  function applySource(cues: SubtitleCue[]): void {
    usable = cues.length > 0;
    groups = overlapGroups(cues);
    autoPause.setCues(cues);
    engine.setSource(cues, language.value as SubtitleLanguage, String(sourceVersion));
    engine.setOffset(offset);
  }

  function readTrack(): void {
    if (!selectedTrack) return;
    try {
      const list = selectedTrack.cues;
      const cues: SubtitleCue[] = [];
      if (list) for (const cue of Array.from(list)) {
        if (!("text" in cue) || typeof cue.text !== "string") continue;
        if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime) || cue.endTime <= cue.startTime) continue;
        const text = subtitlePlainText(cue.text);
        if (text) cues.push({ start: cue.startTime, end: cue.endTime, text });
      }
      const signature = JSON.stringify(cues);
      if (signature !== cueSignature) {
        cueSignature = signature;
        applySource(cues);
      }
    } catch {
      usable = false;
      if (cueSignature !== "unreadable") {
        cueSignature = "unreadable";
        applySource([]);
      }
    }
  }

  // ---- listeners that follow the player's document and video ----
  let boundVideo: HTMLVideoElement | null = null;
  function bindVideo(next: HTMLVideoElement | null): void {
    if (next === boundVideo) return;
    boundVideo?.removeEventListener("play", releaseRetained);
    boundVideo?.removeEventListener("seeking", onJump);
    boundVideo = next;
    next?.addEventListener("play", releaseRetained);
    next?.addEventListener("seeking", onJump);
  }

  let stopShortcuts: (() => void) | null = null;
  let shortcutsView: Window | null = null;
  /** One router, in the document that has the player's focus, only while the layer is on. */
  function updateShortcuts(): void {
    const view = !destroyed && enabled.checked && snapshot?.video ? currentDocument.defaultView : null;
    if (view === shortcutsView) return;
    stopShortcuts?.();
    stopShortcuts = null;
    shortcutsView = view;
    if (!view) return;
    stopShortcuts = installShortcuts(view, {
      isActive: () => !destroyed && enabled.checked && !!snapshot?.video && !isVideoFullscreen(),
      canRun: actions.canRun,
      run: actions.run,
      explain: actions.explain,
    }, { selectionRoots: () => [shadow] });
  }

  let wasSuspended = true;
  function refresh(): void {
    if (destroyed) return;
    const video = snapshot?.video;
    sources.disabled = !video || (!tracks.length && !imported);
    fileInput.disabled = !video;
    const placeholder = sources.options[0];
    if (placeholder) placeholder.textContent = !video ? "Aguardando acesso ao player"
      : !tracks.length && !imported ? "Nenhuma faixa de legenda acessível" : "Escolha uma fonte";
    const targetDocument = video?.ownerDocument || document;
    if (currentDocument !== targetDocument) {
      documentListeners(currentDocument, false);
      currentDocument = targetDocument;
      documentListeners(currentDocument, true);
    }
    const fullscreen = currentDocument.fullscreenElement;
    const mount = fullscreen && fullscreen !== video ? fullscreen : currentDocument.body || currentDocument.documentElement;
    if (host.parentNode !== mount) mount.appendChild(host);
    fabFade.attach(currentDocument);
    bindVideo(video ?? null);
    updateShortcuts();
    updateModes();
    readTrack();
    updateModes();
    const active = enabled.checked && !!video && !isVideoFullscreen();
    // Invisible captions cannot be studied: no auto-pause, R or copy on them.
    if (!active && !wasSuspended) suspendStudy();
    wasSuspended = !active;
    engine.setEnabled(active);
    if (snapshot) {
      // Read the clock before the display moves on, so the line that ends is still known.
      if (active) autoPause.observe({ time: snapshot.currentTime, offset: engine.offsetSeconds, playing: !snapshot.paused && !snapshot.seeking });
      engine.tick(snapshot.currentTime);
    }
    const rect = video?.getBoundingClientRect();
    if (rect) {
      captions.style.left = `${rect.left + rect.width / 2}px`;
      captions.style.top = `${rect.top + rect.height * 0.76}px`;
      captions.style.width = `${Math.max(0, rect.width * 0.9)}px`;
    }
    present();
    status.textContent = isVideoFullscreen() ? "Tela cheia nativa do vídeo: camada suspensa e legendas originais restauradas."
      : !video ? snapshot?.status || "Procurando vídeo HTML5 acessível…"
      : !enabled.checked ? "Camada desativada. Escolha uma fonte e ative para usar."
      : !selectedTrack && sources.value !== "file" ? tracks.length ? "Escolha uma faixa ou importe um SRT/VTT." : "Nenhuma faixa acessível. Importe um arquivo SRT/VTT."
      : !usable ? "Faixa sem falas acessíveis no momento. Aguarde o carregamento ou importe SRT/VTT."
      : !displayed.source ? "Sem fala neste instante. Confira a fonte e o ajuste; tradução não cria falas ausentes."
      : translate.checked && language.value === "pt" ? "Fonte já em português: sem envio para tradução."
      : "Legenda sincronizada pelo relógio do vídeo.";
  }

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    fab.setAttribute("aria-expanded", String(!panel.hidden));
  });
  const fabFade = createIdleFade(fab, () => !panel.hidden);
  // Clicks on our controls must not also play/pause or fullscreen the player.
  isolatePointer(shadow);
  enabled.addEventListener("change", refresh);
  translate.addEventListener("change", () => { engine.setTranslation(translate.checked); refresh(); });
  autoPauseInput.addEventListener("change", () => {
    // The worker owns the preference; the checkbox follows it back through onChange.
    void SettingsRepository.save({ autoPause: autoPauseInput.checked }).catch(() => {
      autoPauseInput.checked = settings.autoPause;
      showFeedback("Não foi possível salvar a preferência. Tente novamente.");
    });
  });
  get<HTMLButtonElement>('[data-control="copy-line"]').addEventListener("click", () => actions.trigger("copy-line"));
  get<HTMLButtonElement>('[data-control="save-line"]').addEventListener("click", () => actions.trigger("save-line"));
  get<HTMLButtonElement>('[data-control="copy-close"]').addEventListener("click", () => { copyBox.hidden = true; });
  sources.addEventListener("change", () => {
    fileGeneration++;
    restoreTracks();
    selectedTrack = sources.value !== "file" && sources.value !== "" ? tracks[Number(sources.value)] || null : null;
    if (selectedTrack) language.value = selectedTrack.language.toLowerCase().startsWith("pt") ? "pt" : "en";
    cueSignature = "";
    newStudySource();
    resetOffset();
    applySource(sources.value === "file" && imported ? imported : []);
    refresh();
  });
  language.addEventListener("change", () => {
    cueSignature = "";
    newStudySource();
    applySource(sources.value === "file" && imported ? imported : []);
    refresh();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const generation = ++fileGeneration;
    const session = snapshot?.sessionKey;
    fileInput.value = "";
    if (!/\.(srt|vtt)$/i.test(file.name) || file.size > MAX_SUBTITLE_BYTES) {
      fileStatus.textContent = "Escolha um arquivo .srt ou .vtt de até 2 MB. A fonte anterior foi mantida.";
      return;
    }
    fileStatus.textContent = "Lendo arquivo local…";
    void file.arrayBuffer().then((bytes) => {
      if (destroyed || generation !== fileGeneration || session !== snapshot?.sessionKey) return;
      const cues = decodeSubtitleFile(bytes);
      restoreTracks();
      imported = cues;
      importedName = file.name;
      selectedTrack = null;
      cueSignature = "";
      rebuildSources();
      sources.value = "file";
      newStudySource();
      resetOffset();
      applySource(cues);
      fileStatus.textContent = `${file.name}: ${cues.length} falas carregadas. Confira o idioma da fonte.`;
      refresh();
    }).catch((error: unknown) => {
      if (destroyed || generation !== fileGeneration || session !== snapshot?.sessionKey) return;
      fileStatus.textContent = `${error instanceof Error ? error.message : "Não foi possível ler o arquivo."} A fonte anterior foi mantida.`;
    });
  });
  const shift = (delta: number) => {
    offset = Math.round((offset + delta) * 10) / 10;
    // Times moved: learned lines and a pending end no longer match the video.
    navigation.reset();
    onJump();
    engine.setOffset(offset);
    offsetLabel.textContent = `Ajuste: ${offset > 0 ? "+" : ""}${offset.toFixed(1).replace(".", ",")} s`;
    refresh();
  };
  get<HTMLElement>('[data-control="earlier"]').addEventListener("click", () => shift(-0.5));
  get<HTMLElement>('[data-control="later"]').addEventListener("click", () => shift(0.5));
  get<HTMLElement>('[data-control="reset"]').addEventListener("click", () => {
    navigation.reset();
    onJump();
    resetOffset();
    refresh();
  });
  retry.addEventListener("click", () => engine.retry());

  const onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    card.hide();
    copyBox.hidden = true;
  };
  /** A click anywhere but the card or a word closes the card. */
  const onDocumentClick = (event: MouseEvent): void => {
    if (event.composedPath().includes(cardElement)) return;
    card.hide();
    sourceLine.querySelectorAll(".sf-selected").forEach((word) => word.classList.remove("sf-selected"));
  };
  function documentListeners(doc: Document, add: boolean): void {
    if (add) {
      doc.addEventListener("fullscreenchange", refresh);
      doc.addEventListener("scroll", refresh, true);
      doc.addEventListener("keydown", onDocumentKeydown);
      doc.addEventListener("click", onDocumentClick);
      doc.defaultView?.addEventListener("resize", refresh);
    } else {
      doc.removeEventListener("fullscreenchange", refresh);
      doc.removeEventListener("scroll", refresh, true);
      doc.removeEventListener("keydown", onDocumentKeydown);
      doc.removeEventListener("click", onDocumentClick);
      doc.defaultView?.removeEventListener("resize", refresh);
    }
  }
  documentListeners(currentDocument, true);

  // Colours and auto-pause follow the shared preferences; the translated line
  // here stays its own opt-in, never switched on by another path's setting.
  const applySettings = (next: Settings): void => {
    settings = next;
    autoPauseInput.checked = next.autoPause;
    renderer.refresh();
  };
  const stopSettings = SettingsRepository.onChange(applySettings);
  void SettingsRepository.get().then((loaded) => {
    if (!destroyed) applySettings(loaded);
  }).catch(() => {});
  const stopVocabulary = vocabulary.onChange(() => renderer.refresh());

  const instance = {
    updatePlayer(state: PlayerSnapshot): void {
      if (destroyed) return;
      const changedSession = snapshot?.sessionKey !== state.sessionKey;
      if (changedSession) {
        restoreTracks();
        fileGeneration++;
        imported = null;
        importedName = "";
        selectedTrack = null;
        cueSignature = "";
        usable = false;
        sources.value = "";
        fileStatus.textContent = "";
        resetOffset();
        engine.setSession(state.sessionKey);
      }
      snapshot = state;
      if (changedSession) newStudySource();
      const captionTracks = state.tracks.filter((track) => track.kind === "subtitles" || track.kind === "captions");
      const changedTracks = tracks.length !== captionTracks.length || tracks.some((track, i) => track !== captionTracks[i]);
      if (changedTracks || changedSession) {
        tracks = captionTracks;
        if (selectedTrack && !tracks.includes(selectedTrack)) {
          restoreTracks();
          selectedTrack = null;
          newStudySource();
          applySource([]);
          resetOffset();
        }
        rebuildSources();
      }
      refresh();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      fileGeneration++;
      clearTimeout(feedbackTimer);
      fabFade.destroy();
      documentListeners(currentDocument, false);
      stopShortcuts?.();
      stopShortcuts = null;
      bindVideo(null);
      words.cancel();
      autoPause.reset();
      controller.stop();
      navigation.stop();
      stopSettings();
      stopVocabulary();
      vocabulary.dispose();
      renderer.destroy();
      restoreTracks();
      engine.destroy();
      host.remove();
      if (activeInstance === instance) activeInstance = null;
    },
  };
  activeInstance = instance;
  refresh();
  return instance;
}
