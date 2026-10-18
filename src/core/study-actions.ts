import type { StudyCommand } from "./keyboard-shortcuts.ts";
import type { PlaybackController, PlaybackResult } from "./playback-controller.ts";
import type { Settings } from "./settings.ts";
import { sentencePhrase, type StudySnapshot } from "./study-context.ts";
import type { PhraseSaveResult } from "./storage.ts";
import type { SavedPhraseInput } from "./types.ts";

/**
 * What each study command does, shared by the keyboard router and the panel
 * buttons of both subtitle paths: a button and its key run the same code.
 */
export interface StudyActionsOptions {
  controller: PlaybackController;
  /** The line being studied: retained by auto-pause, else the one on screen. */
  study(): StudySnapshot | null;
  /** The current session; feedback for an older one is dropped. */
  sessionId(): string;
  toggleAutoPause(): Promise<Settings>;
  savePhrase(phrase: SavedPhraseInput): Promise<PhraseSaveResult>;
  feedback(message: string): void;
  /** The clipboard could not be written: show the line selectable, for a normal copy. */
  showCopyFallback(text: string): void;
  clipboard(): Pick<Clipboard, "writeText"> | undefined;
}

export interface StudyActions {
  canRun(command: StudyCommand): boolean;
  run(command: StudyCommand): void;
  explain(command: StudyCommand): void;
  /** A button press: runs, or explains why it cannot. */
  trigger(command: StudyCommand): void;
}

const hasText = (snapshot: StudySnapshot | null): snapshot is StudySnapshot => !!snapshot?.text.trim();

export function createStudyActions(options: StudyActionsOptions): StudyActions {
  const { controller } = options;

  /** Feedback only while the session it was about is still the current one. */
  const report = (session: string, message: string): void => {
    if (options.sessionId() === session) options.feedback(message);
  };

  const playback = (action: () => Promise<PlaybackResult>, done?: string): void => {
    const session = options.sessionId();
    void action().then((result) => {
      if (!result.ok) report(session, result.error ?? "Não foi possível controlar o player.");
      else if (done) report(session, done);
    });
  };

  /** R: the whole original line captured now, saved without waiting for any translation. */
  const saveLine = (snapshot: StudySnapshot): void => {
    const session = snapshot.sessionId;
    options.feedback("Salvando fala…");
    void options.savePhrase(sentencePhrase(snapshot)).then(
      (result) => report(session, result.duplicate ? "Fala já salva" : "Fala salva"),
      () => report(session, "Não foi possível salvar. Tente novamente.")
    );
  };

  /** Ctrl/⌘+C: the original only. The clipboard call starts within the user's gesture. */
  const copyLine = (snapshot: StudySnapshot): void => {
    const text = snapshot.text;
    const session = snapshot.sessionId;
    const clipboard = options.clipboard();
    if (!clipboard?.writeText) {
      options.showCopyFallback(text);
      return;
    }
    let pending: Promise<void>;
    try {
      pending = clipboard.writeText(text);
    } catch {
      options.showCopyFallback(text);
      return;
    }
    void pending.then(
      () => report(session, "Copiado"),
      () => {
        if (options.sessionId() === session) options.showCopyFallback(text);
      }
    );
  };

  const canRun = (command: StudyCommand): boolean => {
    switch (command) {
      case "previous":
        return controller.canPrevious();
      case "forward":
        return controller.canForward();
      case "repeat":
        return controller.canRepeat(options.study());
      case "toggle":
        return controller.canToggle();
      case "auto-pause":
        return true;
      case "save-line":
      case "copy-line":
        return hasText(options.study());
    }
  };

  const run = (command: StudyCommand): void => {
    switch (command) {
      case "previous":
        playback(() => controller.previous());
        return;
      case "forward":
        playback(() => controller.forward(), "+5 s");
        return;
      case "repeat":
        playback(() => controller.repeat(options.study()));
        return;
      case "toggle":
        playback(() => controller.toggle());
        return;
      case "auto-pause": {
        const session = options.sessionId();
        void options.toggleAutoPause().then(
          (settings) => report(session, settings.autoPause ? "Pausa automática ligada" : "Pausa automática desligada"),
          () => report(session, "Não foi possível salvar a preferência. Tente novamente.")
        );
        return;
      }
      case "save-line":
      case "copy-line": {
        // Captured synchronously: the line may change before anything resolves.
        const snapshot = options.study();
        if (!hasText(snapshot)) {
          explain(command);
          return;
        }
        if (command === "save-line") saveLine(snapshot);
        else copyLine(snapshot);
        return;
      }
    }
  };

  const explain = (command: StudyCommand): void => {
    switch (command) {
      case "repeat":
        options.feedback(options.study() ? "O início desta fala é desconhecido." : "Nenhuma fala para repetir.");
        return;
      case "save-line":
        options.feedback("Nenhuma fala para salvar.");
        return;
      case "copy-line":
      case "previous":
      case "forward":
      case "toggle":
      case "auto-pause":
        // Left to the page: Ctrl+C copies natively, the player keeps its own keys.
        return;
    }
  };

  return {
    canRun,
    run,
    explain,
    trigger(command) {
      if (canRun(command)) {
        run(command);
        return;
      }
      if (command === "copy-line") options.feedback("Nenhuma fala para copiar.");
      else explain(command);
    },
  };
}
