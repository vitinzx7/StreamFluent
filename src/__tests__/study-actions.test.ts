import { describe, expect, it, vi } from "vitest";
import { createStudyActions, type StudyActionsOptions } from "../core/study-actions.ts";
import type { PlaybackController } from "../core/playback-controller.ts";
import type { StudySnapshot } from "../core/study-context.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import type { SavedPhrase } from "../core/types.ts";

function line(text: string, overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    sessionId: "s1",
    sourceId: "dom",
    cueId: "c",
    occurrenceId: `o-${text}`,
    text,
    direction: "en-pt",
    start: 30,
    platform: "Netflix",
    mediaTitle: "Show",
    season: 1,
    episode: 3,
    freshKeys: new Set(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(overrides: Partial<StudyActionsOptions> = {}) {
  let study: StudySnapshot | null = line("Line one\nline two");
  let session = "s1";
  const controller = {
    canPrevious: vi.fn(() => true),
    canForward: vi.fn(() => true),
    canRepeat: vi.fn(() => true),
    canToggle: vi.fn(() => true),
    previous: vi.fn(async () => ({ ok: true })),
    forward: vi.fn(async () => ({ ok: true })),
    repeat: vi.fn(async () => ({ ok: true })),
    toggle: vi.fn(async () => ({ ok: true })),
    pause: vi.fn(async () => ({ ok: true })),
    invalidate: vi.fn(),
    stop: vi.fn(),
  } satisfies PlaybackController;
  const writeText = vi.fn(async (_text: string) => {});
  const savePhrase = vi.fn<StudyActionsOptions["savePhrase"]>(async () => ({ phrase: {} as SavedPhrase, duplicate: false }));
  if (overrides.savePhrase) savePhrase.mockImplementation(overrides.savePhrase);
  const options = {
    controller,
    study: () => study,
    sessionId: () => session,
    toggleAutoPause: vi.fn(async () => ({ ...DEFAULT_SETTINGS, autoPause: true })),
    feedback: vi.fn(),
    showCopyFallback: vi.fn(),
    clipboard: () => ({ writeText }),
    ...overrides,
    savePhrase,
  };
  const actions = createStudyActions(options);
  return {
    actions,
    options,
    controller,
    writeText,
    setStudy: (value: StudySnapshot | null) => { study = value; },
    setSession: (value: string) => { session = value; },
  };
}

describe("R: save the whole line", () => {
  it("saves the original with its line breaks as a sentence, without waiting for a translation", async () => {
    const { actions, options } = setup();

    actions.run("save-line");

    expect(options.savePhrase).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "sentence",
      sentence: "Line one\nline two",
      sourceLanguage: "en",
      targetLanguage: "pt-BR",
      timeSeconds: 30,
    }));
    const phrase = options.savePhrase.mock.calls[0][0];
    expect(phrase).not.toHaveProperty("selectedWord");
    expect(phrase).not.toHaveProperty("sentenceTranslation");
    expect(options.feedback).toHaveBeenLastCalledWith("Salvando fala…");
    await flush();
    expect(options.feedback).toHaveBeenLastCalledWith("Fala salva");
  });

  it("includes a translation only when it already belongs to that line", () => {
    const { actions, options, setStudy } = setup();
    setStudy(line("Hello", { translation: "Olá" }));

    actions.run("save-line");

    expect(options.savePhrase.mock.calls[0][0]).toMatchObject({ sentence: "Hello", sentenceTranslation: "Olá" });
  });

  it("says when the line was already saved", async () => {
    const { actions, options } = setup({ savePhrase: vi.fn(async () => ({ phrase: {} as SavedPhrase, duplicate: true })) });

    actions.run("save-line");
    await flush();

    expect(options.feedback).toHaveBeenLastCalledWith("Fala já salva");
  });

  it("never shows success when storage failed", async () => {
    const { actions, options } = setup({ savePhrase: vi.fn(async () => { throw new Error("QUOTA_BYTES"); }) });

    actions.run("save-line");
    await flush();

    expect(options.feedback).toHaveBeenLastCalledWith("Não foi possível salvar. Tente novamente.");
    expect(options.feedback).not.toHaveBeenCalledWith("Fala salva");
  });

  it("K06: saves the line captured at the key press even if the subtitle changes meanwhile", async () => {
    const save = deferred<{ phrase: SavedPhrase; duplicate: boolean }>();
    const { actions, options, setStudy } = setup({ savePhrase: vi.fn(() => save.promise) });

    actions.run("save-line");
    setStudy(line("The next line"));
    save.resolve({ phrase: {} as SavedPhrase, duplicate: false });
    await flush();

    expect(options.savePhrase.mock.calls[0][0]).toMatchObject({ sentence: "Line one\nline two" });
    expect(options.feedback).toHaveBeenLastCalledWith("Fala salva");
  });

  it("drops the result message of an older episode but keeps the save", async () => {
    const save = deferred<{ phrase: SavedPhrase; duplicate: boolean }>();
    const { actions, options, setSession } = setup({ savePhrase: vi.fn(() => save.promise) });

    actions.run("save-line");
    setSession("s2");
    save.resolve({ phrase: {} as SavedPhrase, duplicate: false });
    await flush();

    expect(options.savePhrase).toHaveBeenCalledOnce();
    expect(options.feedback).not.toHaveBeenCalledWith("Fala salva");
  });

  it("does not create an empty record when there is no line", () => {
    const { actions, options, setStudy } = setup();
    setStudy(null);

    expect(actions.canRun("save-line")).toBe(false);
    actions.trigger("save-line");

    expect(options.savePhrase).not.toHaveBeenCalled();
    expect(options.feedback).toHaveBeenCalledWith("Nenhuma fala para salvar.");
  });
});

describe("Ctrl/⌘+C: copy the line", () => {
  it("writes only the original text and confirms after the clipboard accepted it", async () => {
    const { actions, options, writeText, setStudy } = setup();
    setStudy(line("Hello there", { translation: "Olá" }));

    actions.run("copy-line");

    // Started within the key press, before any await.
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Hello there");
    expect(options.feedback).not.toHaveBeenCalledWith("Copiado");
    await flush();
    expect(options.feedback).toHaveBeenCalledWith("Copiado");
  });

  it("falls back to a selectable field when the clipboard refuses", async () => {
    const { actions, options } = setup({
      clipboard: () => ({ writeText: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) }),
    });

    actions.run("copy-line");
    await flush();

    expect(options.showCopyFallback).toHaveBeenCalledWith("Line one\nline two");
    expect(options.feedback).not.toHaveBeenCalledWith("Copiado");
  });

  it("falls back immediately when no clipboard API is available", () => {
    const { actions, options } = setup({ clipboard: () => undefined });

    actions.run("copy-line");

    expect(options.showCopyFallback).toHaveBeenCalledWith("Line one\nline two");
  });

  it("never overwrites the clipboard with nothing", () => {
    const { actions, writeText, setStudy } = setup();
    setStudy(null);

    expect(actions.canRun("copy-line")).toBe(false);
    actions.trigger("copy-line");

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("player commands and Q", () => {
  it("passes the study line to S and reports a failure", async () => {
    const { actions, controller, options } = setup();
    controller.repeat.mockResolvedValueOnce({ ok: false, error: "O player recusou o salto." } as never);

    actions.run("repeat");
    await flush();

    expect(controller.repeat).toHaveBeenCalledWith(expect.objectContaining({ text: "Line one\nline two" }));
    expect(options.feedback).toHaveBeenCalledWith("O player recusou o salto.");
  });

  it("explains S without a line instead of picking an older one", () => {
    const { actions, options, setStudy } = setup();
    setStudy(null);

    actions.explain("repeat");

    expect(options.feedback).toHaveBeenCalledWith("Nenhuma fala para repetir.");
  });

  it("toggles auto-pause through the worker and says what it is now", async () => {
    const { actions, options } = setup();

    actions.run("auto-pause");
    await flush();

    expect(options.toggleAutoPause).toHaveBeenCalledOnce();
    expect(options.feedback).toHaveBeenCalledWith("Pausa automática ligada");
  });
});
