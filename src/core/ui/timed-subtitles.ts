import { EXTENSION_MARKER } from "../dom-utils.ts";
import type { PlayerSnapshot } from "../player-types.ts";
import type { SubtitleCue } from "../types.ts";
import { translateSentence } from "../translation.ts";
import {
  decodeSubtitleFile, MAX_SUBTITLE_BYTES, subtitlePlainText,
  TimedSubtitleController, type TimedSubtitleView, type SubtitleLanguage,
} from "../subtitles.ts";

let activeInstance: { destroy(): void } | null = null;

/** A separate opt-in interface keeps the established Netflix/Max flow untouched. */
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
      button,select,input { font: inherit; }
      button,select { color:#f5f7fa; background:#24334a; border:1px solid #536078; border-radius:6px; padding:7px; }
      button { cursor:pointer; } button:hover { background:#344b69; }
      [hidden] { display:none !important; }
      .fab,.panel { position:fixed; right:16px; font:14px/1.5 system-ui,sans-serif; pointer-events:auto; }
      .fab { bottom:16px; background:#142d32; color:#8bf2d9; }
      .panel { bottom:66px; padding:16px; width:350px; max-width:calc(100vw - 24px); max-height:calc(100vh - 90px); overflow:auto; color:#f5f7fa; background:#111a29; border:1px solid #536078; border-radius:10px; box-shadow:0 4px 20px #0009; }
      label { display:block; margin:10px 0; } select,input[type=file] { display:block; width:100%; margin-top:5px; }
      input[type=checkbox] { margin-right:6px; }
      .small { font-size:12px; color:#bac8d9; } .status { color:#8bf2d9; }
      .offset { display:flex; gap:5px; flex-wrap:wrap; } .offset button { font-size:12px; }
      .captions { position:fixed; transform:translateX(-50%); text-align:center; white-space:pre-line; color:white; font:600 22px/1.4 system-ui,sans-serif; text-shadow:0 1px 3px #000; }
      .source,.target { background:#000b; padding:2px 8px; border-radius:4px; overflow-wrap:anywhere; }
      .target { color:#8bf2d9; margin-top:3px; } .source:empty,.target:empty { display:none; }
      .translation-state { font-size:13px; background:#111d; }
    </style>
    <button class="fab" type="button" aria-expanded="false">SF · Legendas</button>
    <section class="panel" aria-label="StreamFluent: legendas do player" hidden>
      <strong>StreamFluent · Player HTML5</strong>
      <label><input type="checkbox" data-control="enabled">Ativar camada de legendas</label>
      <label>Faixa ou arquivo<select data-control="source"><option value="">Escolha uma fonte</option></select></label>
      <label>Importar SRT/VTT local (UTF-8, até 2 MB)<input type="file" accept=".srt,.vtt" data-control="file"></label>
      <label>Idioma da fonte<select data-control="language"><option value="en">Inglês</option><option value="pt">Já está em português</option></select></label>
      <label><input type="checkbox" data-control="translate">Traduzir inglês → português brasileiro</label>
      <p class="small">Ao ativar a tradução, somente a fala atual é enviada a clients5.google.com e, se necessário, api.mymemory.translated.net. O arquivo inteiro não é enviado. Serviços externos podem falhar ou limitar o uso.</p>
      <div class="offset"><button type="button" data-control="earlier">Adiantar 0,5 s</button><button type="button" data-control="later">Atrasar 0,5 s</button><button type="button" data-control="reset">Restaurar</button></div>
      <p data-control="offset">Ajuste: 0,0 s</p>
      <p class="small">Ajuste positivo atrasa. Um ajuste fixo não corrige outra edição ou descompasso crescente. Falas ausentes não são transcritas.</p>
      <p class="status" data-control="status" role="status"></p>
      <p class="small" data-control="file-status" role="status"></p>
      <p class="small">Se o vídeo entrar sozinho em tela cheia nativa, a camada não pode aparecer. Use a tela cheia do contêiner do player.</p>
      <button type="button" data-control="retry" hidden>Tentar traduzir a fala atual novamente</button>
    </section>
    <div class="captions" hidden><div class="source"></div><div class="target"></div><div class="translation-state" role="status"></div></div>
  `;
  const get = <T extends HTMLElement>(selector: string): T => shadow.querySelector<T>(selector)!;
  const enabled = get<HTMLInputElement>('[data-control="enabled"]');
  const translate = get<HTMLInputElement>('[data-control="translate"]');
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
  const engine = new TimedSubtitleController((text) => translateSentence(text, "en-pt"), render);

  function isVideoFullscreen(): boolean {
    return !!snapshot?.video && currentDocument.fullscreenElement === snapshot.video;
  }

  function render(view: TimedSubtitleView): void {
    displayed = view;
    sourceLine.textContent = view.source;
    targetLine.textContent = view.translation;
    translationState.textContent = view.state === "loading" ? "Traduzindo a fala atual…"
      : view.state === "error" ? "Tradução indisponível; original mantido. Tente novamente no painel SF." : "";
    retry.hidden = view.state !== "error";
    captions.hidden = !enabled.checked || !view.source || isVideoFullscreen() || !snapshot?.video;
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
    engine.setSource(cues, language.value as SubtitleLanguage);
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

  function refresh(): void {
    if (destroyed) return;
    const video = snapshot?.video;
    const targetDocument = video?.ownerDocument || document;
    if (currentDocument !== targetDocument) {
      documentListeners(currentDocument, false);
      currentDocument = targetDocument;
      documentListeners(currentDocument, true);
    }
    const fullscreen = currentDocument.fullscreenElement;
    const mount = fullscreen && fullscreen !== video ? fullscreen : currentDocument.body || currentDocument.documentElement;
    if (host.parentNode !== mount) mount.appendChild(host);
    updateModes();
    readTrack();
    updateModes();
    engine.setEnabled(enabled.checked && !!video && !isVideoFullscreen());
    if (snapshot) engine.tick(snapshot.currentTime);
    const rect = video?.getBoundingClientRect();
    if (rect) {
      captions.style.left = `${rect.left + rect.width / 2}px`;
      captions.style.top = `${rect.top + rect.height * 0.76}px`;
      captions.style.width = `${Math.max(0, rect.width * 0.9)}px`;
    }
    render(displayed);
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
  enabled.addEventListener("change", refresh);
  translate.addEventListener("change", () => { engine.setTranslation(translate.checked); refresh(); });
  sources.addEventListener("change", () => {
    fileGeneration++;
    restoreTracks();
    selectedTrack = sources.value !== "file" && sources.value !== "" ? tracks[Number(sources.value)] || null : null;
    if (selectedTrack) language.value = selectedTrack.language.toLowerCase().startsWith("pt") ? "pt" : "en";
    cueSignature = "";
    resetOffset();
    applySource(sources.value === "file" && imported ? imported : []);
    refresh();
  });
  language.addEventListener("change", () => {
    cueSignature = "";
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
    engine.setOffset(offset);
    offsetLabel.textContent = `Ajuste: ${offset > 0 ? "+" : ""}${offset.toFixed(1).replace(".", ",")} s`;
    refresh();
  };
  get<HTMLElement>('[data-control="earlier"]').addEventListener("click", () => shift(-0.5));
  get<HTMLElement>('[data-control="later"]').addEventListener("click", () => shift(0.5));
  get<HTMLElement>('[data-control="reset"]').addEventListener("click", () => { resetOffset(); refresh(); });
  retry.addEventListener("click", () => engine.retry());
  function documentListeners(doc: Document, add: boolean): void {
    if (add) {
      doc.addEventListener("fullscreenchange", refresh);
      doc.addEventListener("scroll", refresh, true);
      doc.defaultView?.addEventListener("resize", refresh);
    } else {
      doc.removeEventListener("fullscreenchange", refresh);
      doc.removeEventListener("scroll", refresh, true);
      doc.defaultView?.removeEventListener("resize", refresh);
    }
  }
  documentListeners(currentDocument, true);

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
      const captionTracks = state.tracks.filter((track) => track.kind === "subtitles" || track.kind === "captions");
      const changedTracks = tracks.length !== captionTracks.length || tracks.some((track, i) => track !== captionTracks[i]);
      if (changedTracks || changedSession) {
        tracks = captionTracks;
        if (selectedTrack && !tracks.includes(selectedTrack)) {
          restoreTracks();
          selectedTrack = null;
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
      documentListeners(currentDocument, false);
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
