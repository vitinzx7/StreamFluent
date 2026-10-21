import type { StudyStorageService } from "./study-storage.ts";
import type { AccountRemote } from "./account-remote.ts";
import { isRecord } from "./study-data.ts";
import { emptyDocument, importDocument, localVocabulary, makeBackup, mergeDocuments, parseBackup, stable, studyDocument, validateDocument, type Choices, type Conflict, type StudyDocument } from "./study-document.ts";

export const ACCOUNT_KEY = "sfAccount";
type Storage = Pick<chrome.storage.LocalStorageArea, "get" | "set">;
interface Metadata {
  version: 1; owner: string | null; email: string; enabled: boolean; signedIn: boolean;
  base: StudyDocument | null; revision: number; lastSyncedAt: string | null; error: string | null;
  conflict: { token: string; signature: string; count: number } | null;
}
function metadata(raw: unknown): Metadata {
  if (raw === undefined) return { version: 1, owner: null, email: "", enabled: false, signedIn: false, base: null, revision: 0, lastSyncedAt: null, error: null, conflict: null };
  if (!isRecord(raw) || raw.version !== 1 || (raw.owner !== null && typeof raw.owner !== "string") || typeof raw.email !== "string"
    || typeof raw.enabled !== "boolean" || typeof raw.signedIn !== "boolean" || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) throw new Error("Estado de conta incompatível. Dados preservados.");
  if (raw.base !== null) validateDocument(raw.base);
  return raw as unknown as Metadata;
}
function isAccountSender(sender: chrome.runtime.MessageSender): boolean {
  return typeof chrome.runtime.id === "string" && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("account.html")
    && (sender.frameId === undefined || sender.frameId === 0);
}
async function signature(values: unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(stable(values));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function createAccountService(study: StudyStorageService, remote: AccountRemote, storage: Storage = chrome.storage.local) {
  let active: Promise<unknown> | null = null;
  let syncFlight: Promise<unknown> | null = null;
  let authChanging = false;
  let lastConflicts: Conflict[] = [];
  async function snapshot() {
    const raw = await storage.get(["vocabulary", "phrases", "settings", "studyRevision", ACCOUNT_KEY]);
    const meta = metadata(raw[ACCOUNT_KEY]);
    return { raw, meta, document: studyDocument(raw) };
  }
  async function persist(raw: Record<string, unknown>, document: StudyDocument, meta: Metadata) {
    const vocabulary = localVocabulary(raw.vocabulary, document);
    const changes: Record<string, unknown> = { [ACCOUNT_KEY]: meta };
    const values = { vocabulary, phrases: document.phrases, settings: document.settings };
    for (const [key, value] of Object.entries(values)) if (stable(raw[key]) !== stable(value)) changes[key] = value;
    if (Object.keys(changes).length > 1) {
      const previous = raw.studyRevision;
      if (previous !== undefined && (!Number.isSafeInteger(previous) || (previous as number) < 0 || previous === Number.MAX_SAFE_INTEGER)) throw new Error("Revisão local inválida.");
      changes.studyRevision = (typeof previous === "number" ? previous : 0) + 1;
    }
    await storage.set(changes);
  }
  async function status() {
    return study.exclusive(async () => {
      const { meta, document } = await snapshot();
      return {
        email: meta.email, signedIn: meta.signedIn, enabled: meta.enabled, bound: !!meta.owner,
        local: true, synchronized: meta.enabled && meta.signedIn && !meta.error && !meta.conflict && !!meta.base && stable(meta.base) === stable(document),
        syncing: !!syncFlight, lastSyncedAt: meta.lastSyncedAt, error: meta.error,
        conflictCount: meta.conflict?.count ?? 0, conflictToken: meta.conflict?.token ?? null, conflicts: lastConflicts,
      };
    });
  }
  async function runSync(choices: Choices = {}, token?: string) {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const initial = await study.exclusive(snapshot);
        if (!initial.meta.enabled) return status();
        const user = await remote.user();
        if (!user || user.id !== initial.meta.owner) throw new Error("Entre novamente na conta vinculada a este dispositivo.");
        const cloud = await remote.read(user.id);
        const remoteDoc = cloud?.document ?? emptyDocument();
        const remoteRevision = cloud?.revision ?? 0;
        const prepared = await study.exclusive(async () => {
          const current = await snapshot();
          const { meta, document } = current;
          if (!meta.enabled || meta.owner !== user.id) return null;
          const base = meta.base ?? emptyDocument();
          const fingerprint = await signature([base, document, remoteDoc, remoteRevision]);
          if (Object.keys(choices).length && (!token || token !== meta.conflict?.token || fingerprint !== meta.conflict.signature)) {
            throw new Error("Os dados mudaram. Sincronize e revise os conflitos novamente.");
          }
          const merged = mergeDocuments(base, document, remoteDoc, choices);
          if (merged.conflicts.length) {
            lastConflicts = merged.conflicts;
            meta.conflict = { token: meta.conflict?.signature === fingerprint ? meta.conflict.token : crypto.randomUUID(), signature: fingerprint, count: merged.conflicts.length };
            meta.error = null;
            await storage.set({ [ACCOUNT_KEY]: meta });
            return null;
          }
          return { ...current, merged: merged.document };
        });
        if (!prepared) return status();
        const revision = stable(prepared.merged) === stable(remoteDoc) && cloud ? remoteRevision
          : await remote.write(remoteRevision, prepared.merged);
        if (revision === null) continue; // Compare-and-swap lost a race; re-read, never overwrite.
        await study.exclusive(async () => {
          const current = await snapshot();
          if (!current.meta.enabled || current.meta.owner !== user.id) return;
          // Preserve saves/edits made locally while the request was in flight.
          const concurrent = mergeDocuments(prepared.document, current.document, prepared.merged);
          if (concurrent.conflicts.length) {
            current.meta.error = "Houve edição local durante a sincronização. Sincronize novamente para revisar os conflitos.";
            await storage.set({ [ACCOUNT_KEY]: current.meta });
            return;
          }
          current.meta.base = prepared.merged; current.meta.revision = revision;
          current.meta.lastSyncedAt = new Date().toISOString(); current.meta.error = null; current.meta.conflict = null;
          lastConflicts = [];
          await persist(current.raw, concurrent.document, current.meta);
        });
        return status();
      }
      throw new Error("A conta mudou em outro dispositivo. Tente sincronizar novamente.");
    } catch (error) {
      const message = error instanceof Error && !/token|jwt|fetch|apikey/i.test(error.message) ? error.message : "Falha na conexão ou sessão. Dados locais preservados; entre novamente se necessário.";
      await study.exclusive(async () => { const { meta } = await snapshot(); meta.error = message; await storage.set({ [ACCOUNT_KEY]: meta }); });
      return status();
    }
  }
  function sync(choices: Choices = {}, token?: string): Promise<unknown> {
    if (syncFlight) return syncFlight;
    if (authChanging) return status();
    syncFlight = runSync(choices, token).finally(() => { syncFlight = null; });
    return syncFlight;
  }
  async function operation(action: string, payload: Record<string, unknown>): Promise<unknown> {
    if (action === "status") return status();
    if (action === "sync") {
      const choices = payload.choices ?? {};
      if (!isRecord(choices) || Object.values(choices).some(v => v !== "local" && v !== "remote") || (payload.token !== undefined && typeof payload.token !== "string")) throw new Error("Resolução inválida.");
      return sync(choices as Choices, payload.token as string | undefined);
    }
    if (action === "export") return study.exclusive(async () => ({ backup: makeBackup((await snapshot()).document) }));
    if (action === "preview-import" || action === "import") {
      if (typeof payload.text !== "string" || typeof payload.includeSettings !== "boolean") throw new Error("Backup inválido.");
      const incoming = parseBackup(payload.text);
      const result = await study.exclusive(async () => {
        const current = await snapshot();
        const merged = importDocument(current.document, incoming, payload.includeSettings as boolean);
        if (action === "import") await persist(current.raw, merged.document, current.meta);
        return { phrases: incoming.phrases.length, words: Object.values(incoming.vocabulary.languages).reduce((n, e) => n + Object.keys(e.marks).length, 0), keptLocalConflicts: merged.conflicts.length };
      });
      return result;
    }
    if (action === "sign-in" || action === "sign-up") {
      const { email, password } = payload;
      if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 8 || password.length > 256) throw new Error("Informe e-mail válido e senha com 8 a 256 caracteres.");
      if (action === "sign-up") { await remote.signUp(email, password); return { message: "Cadastro solicitado. Confira seu e-mail para confirmar antes de entrar." }; }
      const user = await remote.signIn(email, password);
      try {
        await study.exclusive(async () => {
          const { meta } = await snapshot();
          if (meta.owner && meta.owner !== user.id) throw new Error("Este dispositivo está vinculado a outra conta. Use outro perfil Chrome para não misturar bibliotecas.");
          meta.owner = user.id; meta.email = user.email; meta.signedIn = true; meta.enabled = false; meta.error = null;
          await storage.set({ [ACCOUNT_KEY]: meta });
        });
      } catch (error) { await remote.signOut(); throw error; }
      return status();
    }
    if (action === "enable") {
      if (payload.consent !== true) throw new Error("Ative a sincronização somente após ler e aceitar o envio dos dados.");
      const user = await remote.user();
      await study.exclusive(async () => {
        const { meta } = await snapshot();
        if (!user || user.id !== meta.owner || !meta.signedIn) throw new Error("Entre primeiro na conta vinculada.");
        meta.enabled = true; await storage.set({ [ACCOUNT_KEY]: meta });
      });
      return sync();
    }
    if (action === "disable" || action === "sign-out") {
      await study.exclusive(async () => {
        const { meta } = await snapshot(); meta.enabled = false;
        if (action === "sign-out") meta.signedIn = false;
        await storage.set({ [ACCOUNT_KEY]: meta });
      });
      if (action === "sign-out") await remote.signOut();
      return status();
    }
    throw new Error("Ação de conta inválida.");
  }
  return {
    sync,
    async handle(message: unknown, sender: chrome.runtime.MessageSender) {
      const requestId = isRecord(message) && typeof message.requestId === "string" ? message.requestId : "";
      try {
        if (!isAccountSender(sender) || !requestId || requestId.length > 200 || !isRecord(message) || typeof message.type !== "string" || !message.type.startsWith("sf:account:") || !isRecord(message.payload)) throw new Error("Pedido de conta inválido.");
        const action = message.type.slice("sf:account:".length);
        if (["status", "export", "preview-import"].includes(action)) return { ok: true, requestId, data: await operation(action, message.payload) };
        if (active) throw new Error("Uma operação de conta está em andamento. Aguarde.");
        const payload = message.payload;
        const changesAuth = ["sign-in", "sign-up", "sign-out"].includes(action);
        active = (async () => {
          if (changesAuth) { authChanging = true; if (syncFlight) await syncFlight; }
          try { return await operation(action, payload); }
          finally { if (changesAuth) authChanging = false; }
        })();
        try { return { ok: true, requestId, data: await active }; }
        finally { active = null; }
      } catch (error) { return { ok: false, requestId, error: error instanceof Error ? error.message : "Não foi possível acessar a conta." }; }
    },
  };
}
