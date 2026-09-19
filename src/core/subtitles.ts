import type { SubtitleCue } from "./types.ts";

export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const MAX_CUES = 20_000;

export type SubtitleLanguage = "en" | "pt";
export type TranslationState = "idle" | "loading" | "ready" | "error";
export interface TimedSubtitleView {
  source: string;
  translation: string;
  state: TranslationState;
}

function timestamp(value: string): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) throw new Error(`Tempo inválido: ${value}`);
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) throw new Error(`Tempo inválido: ${value}`);
  const result = hours * 3600 + minutes * 60 + seconds + Number(match[4]) / 1000;
  if (!Number.isFinite(result)) throw new Error("Tempo da legenda fora do limite.");
  return result;
}

/** Strip only subtitle formatting. Other markup remains inert text, never HTML. */
export function subtitlePlainText(text: string): string {
  return text
    .replace(/<\/?(?:b|i|u|ruby|rt|c(?:\.[\w-]+)*|v|lang)(?:\s[^>]*)?>/gi, "")
    .replace(/<\d{2}(?::\d{2})?:\d{2}\.\d{3}>/g, "")
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, entity: string) => ({
      amp: "&", lt: "<", gt: ">", nbsp: " ", lrm: "\u200e", rlm: "\u200f",
    })[entity] || "")
    .trim();
}

/** All times are seconds; malformed cues reject the entire import, never disappear silently. */
export function parseSubtitles(input: string): SubtitleCue[] {
  if (input.length > MAX_SUBTITLE_BYTES) throw new Error("Arquivo muito grande (máximo 2 MB).");
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("O arquivo de legenda está vazio.");
  const blocks = text.split(/\n[ \t]*\n+/);
  const isVtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(blocks[0]);
  if (isVtt) blocks.shift();
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    if (isVtt && /^(?:NOTE(?:[ \t]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue;
    const lines = block.split("\n");
    let timing = 0;
    if (!lines[0].includes("-->")) timing = 1;
    const match = /^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[timing] || "");
    if (!match) throw new Error(`Bloco ${cues.length + 1}: falta um intervalo SRT/VTT válido.`);
    const start = timestamp(match[1]);
    const end = timestamp(match[2]);
    if (end <= start) throw new Error(`Bloco ${cues.length + 1}: o fim deve ser depois do início.`);
    const cueText = subtitlePlainText(lines.slice(timing + 1).join("\n"));
    if (!cueText) throw new Error(`Bloco ${cues.length + 1}: fala vazia.`);
    cues.push({ start, end, text: cueText });
    if (cues.length > MAX_CUES) throw new Error("Arquivo contém mais de 20.000 falas.");
  }
  if (!cues.length) throw new Error("Nenhuma fala encontrada no arquivo.");
  return cues.sort((a, b) => a.start - b.start);
}

export function decodeSubtitleFile(bytes: ArrayBuffer): SubtitleCue[] {
  if (bytes.byteLength > MAX_SUBTITLE_BYTES) throw new Error("Arquivo muito grande (máximo 2 MB).");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Salve o arquivo como UTF-8 para preservar os acentos.");
  }
  return parseSubtitles(text);
}

/** Positive offset delays subtitles: start + offset <= video time < end + offset. */
export function activeCues(cues: readonly SubtitleCue[], time: number, offset = 0): SubtitleCue[] {
  if (!Number.isFinite(time) || !Number.isFinite(offset)) return [];
  const sourceTime = time - offset;
  return cues.filter((cue) => cue.start <= sourceTime && sourceTime < cue.end);
}

/** Rendering is scoped to source/session and active cue, including repeated identical text. */
export class TimedSubtitleController {
  private generation = 0;
  private requestId = 0;
  private session = "";
  private cues: SubtitleCue[] = [];
  private time = 0;
  private offset = 0;
  private enabled = false;
  private translate = false;
  private language: SubtitleLanguage = "en";
  private cueKey = "";
  private view: TimedSubtitleView = { source: "", translation: "", state: "idle" };

  constructor(
    private readonly translator: (text: string) => Promise<string>,
    private readonly render: (view: TimedSubtitleView) => void,
  ) {}

  setSession(session: string): void {
    if (this.session === session) return;
    this.session = session;
    this.cues = [];
    this.offset = 0;
    this.invalidate();
  }

  setSource(cues: SubtitleCue[], language: SubtitleLanguage): void {
    this.cues = cues;
    this.language = language;
    this.offset = 0;
    this.invalidate();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.invalidate();
  }

  setTranslation(enabled: boolean): void {
    if (this.translate === enabled) return;
    this.translate = enabled;
    this.invalidate();
  }

  setOffset(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.offset = seconds;
    this.tick(this.time);
  }

  tick(time: number): void {
    this.time = time;
    const active = this.enabled ? activeCues(this.cues, time, this.offset) : [];
    const key = JSON.stringify(active);
    if (this.cueKey === key) return;
    this.cueKey = key;
    this.requestId++;
    const source = active.map((cue) => cue.text).join("\n");
    this.publish({ source, translation: "", state: "idle" });
    if (source && this.translate && this.language === "en") this.requestTranslation();
  }

  retry(): void {
    if (this.view.state === "error" && this.enabled) this.requestTranslation();
  }

  destroy(): void {
    this.enabled = false;
    this.cues = [];
    this.invalidate();
  }

  private invalidate(): void {
    this.generation++;
    this.requestId++;
    this.cueKey = "";
    this.tick(this.time);
  }

  private publish(view: TimedSubtitleView): void {
    this.view = view;
    this.render(view);
  }

  private requestTranslation(): void {
    const generation = this.generation;
    const requestId = ++this.requestId;
    const source = this.view.source;
    this.publish({ source, translation: "", state: "loading" });
    // Promise.resolve also catches a synchronously throwing injected provider.
    void Promise.resolve().then(() => {
      if (generation !== this.generation || requestId !== this.requestId) return "";
      return this.translator(source);
    }).then((translation) => {
      if (generation !== this.generation || requestId !== this.requestId) return;
      this.publish({ source, translation, state: translation ? "ready" : "error" });
    }).catch(() => {
      if (generation !== this.generation || requestId !== this.requestId) return;
      this.publish({ source, translation: "", state: "error" });
    });
  }
}
