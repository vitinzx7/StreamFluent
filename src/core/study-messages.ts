export const STUDY_PREFIX = "sf:study:";
export type StudyAction =
  | "read" | "observe" | "set-mark" | "save-phrase" | "remove-phrase" | "clear-phrases"
  | "patch-settings" | "toggle-auto-pause" | "export" | "import" | "reset-seen" | "reset-all";
export interface StudyRequest { type: `${typeof STUDY_PREFIX}${StudyAction}`; requestId: string; payload?: unknown }
export interface StudySuccess<T> { ok: true; requestId: string; revision: number; data: T }
export interface StudyFailure { ok: false; requestId: string; error: string }
export type StudyReply<T> = StudySuccess<T> | StudyFailure;

/** Success means the worker has committed the operation to local storage. */
export async function requestStudy<T>(action: StudyAction, payload?: unknown): Promise<StudySuccess<T>> {
  const requestId = crypto.randomUUID();
  const reply: unknown = await chrome.runtime.sendMessage({ type: `${STUDY_PREFIX}${action}`, requestId, payload });
  if (!reply || typeof reply !== "object") throw new Error("Sem resposta do armazenamento de estudo.");
  const result = reply as Partial<StudySuccess<T>> & { error?: unknown };
  if (result.requestId !== requestId) throw new Error("Resposta de armazenamento inválida.");
  if (result.ok !== true) throw new Error(typeof result.error === "string" ? result.error : "Não foi possível salvar. Tente novamente.");
  if (!Number.isSafeInteger(result.revision) || (result.revision ?? -1) < 0 || !("data" in result)) {
    throw new Error("Revisão de armazenamento inválida.");
  }
  return result as StudySuccess<T>;
}
