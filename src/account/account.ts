import type { Conflict } from "../core/study-document.ts";
import { requestStudy } from "../core/study-messages.ts";
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
let busy = false;
let conflictToken: string | null = null;
let syncEnabled = false;
let statusSequence = 0;
async function request<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const requestId = crypto.randomUUID();
  const response: unknown = await chrome.runtime.sendMessage({ type: `sf:account:${action}`, requestId, payload });
  const reply = response as { ok?: boolean; requestId?: string; data?: T; error?: string } | null;
  if (!reply || reply.requestId !== requestId || reply.ok !== true || !("data" in reply)) throw new Error(reply?.error ?? "Não foi possível acessar os dados.");
  return reply.data as T;
}
interface Status { email: string; signedIn: boolean; enabled: boolean; synchronized: boolean; syncing: boolean; error: string | null; lastSyncedAt: string | null; conflictCount: number; conflictToken: string | null; conflicts: Conflict[] }
function stateOf(status: Status): [kind: string, text: string] {
  if (status.synchronized) return ["on", "Salvo neste dispositivo e sincronizado com a conta"];
  if (status.conflictCount) return ["conflict", "Salvo neste dispositivo · conflitos aguardando sua escolha"];
  if (status.enabled) return ["pending", "Salvo neste dispositivo · sincronização pendente"];
  return ["off", status.signedIn ? "Salvo neste dispositivo · sincronização desativada" : "Salvo só neste dispositivo · sincronização desativada"];
}
function render(status: Status) {
  const [kind, text] = stateOf(status);
  el("state").textContent = text; el("state").dataset.state = kind;
  el("account").textContent = status.email;
  const relogin = !!status.email && !status.signedIn;
  el("relogin").hidden = !relogin;
  el("relogin").textContent = relogin ? `Esta biblioteca está vinculada a ${status.email}. Entre de novo com essa conta.` : "";
  if (relogin && !input("email").value) input("email").value = status.email;
  el("last-sync").textContent = status.lastSyncedAt ? `Última sincronização: ${new Date(status.lastSyncedAt).toLocaleString("pt-BR")}` : "Ainda não há sincronização confirmada.";
  el("error").textContent = status.error ?? "";
  el("login-section").hidden = status.signedIn; el("sync-section").hidden = !status.signedIn;
  el("sync-on").hidden = !status.enabled; el("sync-off").hidden = status.enabled;
  syncEnabled = status.enabled;
  conflictToken = status.conflictToken;
  const root = el("conflicts");
  // Storage events during an operation must not erase choices the user is making.
  if (root.dataset.token !== (status.conflictToken ?? "") || (status.conflicts.length > 0 && !root.querySelector("select"))) {
    root.dataset.token = status.conflictToken ?? ""; root.replaceChildren();
    for (const conflict of status.conflicts) {
      const row = document.createElement("div"); row.className = "conflict";
      const title = document.createElement("p"); title.textContent = conflict.key; row.append(title);
      for (const [label, value] of [["Dispositivo", conflict.local], ["Conta", conflict.remote]] as const) {
        const pre = document.createElement("pre"); pre.textContent = `${label}: ${value === null ? "Excluído" : JSON.stringify(value, null, 2)}`; row.append(pre);
      }
      const label = document.createElement("label"); label.textContent = "Preservar: ";
      const select = document.createElement("select"); select.dataset.key = conflict.key;
      for (const [text, value] of [["Escolha…", ""], ["Versão do dispositivo", "local"], ["Versão da conta", "remote"]]) {
        const option = document.createElement("option"); option.textContent = text; option.value = value; select.append(option);
      }
      label.append(select); row.append(label); root.append(row);
    }
    if (status.conflictCount && !status.conflicts.length) root.textContent = "Clique em Sincronizar agora para carregar os conflitos novamente.";
  }
  el("conflict-section").hidden = status.conflictCount === 0;
}
async function refresh() { const sequence = ++statusSequence; const next = await request<Status>("status"); if (sequence === statusSequence) render(next); }
async function run(operation: () => Promise<void>) {
  if (busy) return;
  busy = true; document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach(b => { b.disabled = true; });
  el("feedback").textContent = "Processando…"; delete el("feedback").dataset.kind;
  try { await operation(); await refresh(); }
  catch (error) { el("feedback").textContent = error instanceof Error ? error.message : "Não foi possível concluir."; el("feedback").dataset.kind = "error"; }
  finally {
    busy = false; document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach(b => { b.disabled = false; });
  }
}
el("login").addEventListener("submit", event => {
  event.preventDefault(); const email = input("email").value.trim(), password = input("password").value; input("password").value = "";
  void run(async () => { await request("sign-in", { email, password }); el("feedback").textContent = "Conta conectada. Leia e aceite o envio se quiser ativar a sincronização."; });
});
el("signup").addEventListener("click", () => {
  if (!(el("login") as HTMLFormElement).reportValidity()) return;
  const email = input("email").value.trim(), password = input("password").value; input("password").value = "";
  void run(async () => { const result = await request<{ message: string }>("sign-up", { email, password }); el("feedback").textContent = result.message; });
});
for (const [id, action] of [["enable", "enable"], ["sync", "sync"], ["disable", "disable"], ["signout", "sign-out"]]) {
  el(id).addEventListener("click", () => void run(async () => {
    await request(action, action === "enable" ? { consent: input("consent").checked } : {});
    if (action === "sign-out") input("consent").checked = false;
    el("feedback").textContent = "Estado atualizado. Confira a indicação acima.";
  }));
}
el("resolve").addEventListener("click", () => void run(async () => {
  const choices: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const select of document.querySelectorAll<HTMLSelectElement>("#conflicts select")) {
    if (!select.value) throw new Error("Escolha uma versão para cada conflito.");
    choices[select.dataset.key!] = select.value;
  }
  await request("sync", { choices, token: conflictToken }); el("feedback").textContent = "Escolhas processadas. Confira o estado da conta.";
}));

// ---- backup and starting over: the study protocol, like the library and the player ----
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
interface Backup { vocabulary?: { languages?: Record<string, { seen?: unknown[]; marks?: Record<string, unknown> }> }; phrases?: unknown[] }
function countBackup(backup: Backup) {
  const languages = Object.values(backup.vocabulary?.languages ?? {});
  const seen = languages.reduce((sum, entry) => sum + (entry.seen?.length ?? 0), 0);
  const marked = languages.reduce((sum, entry) => sum + Object.keys(entry.marks ?? {}).length, 0);
  return `${seen} palavras vistas, ${marked} marcadas e ${backup.phrases?.length ?? 0} frases`;
}
el("export-data").addEventListener("click", () => void run(async () => {
  const { data: backup } = await requestStudy<Backup>("export");
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `streamfluent-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  el("feedback").textContent = `Backup exportado: ${countBackup(backup)}. Guarde o arquivo em local seguro.`;
}));
el("import-button").addEventListener("click", () => input("import-data").click());
el("import-data").addEventListener("change", () => {
  const file = input("import-data").files?.[0]; input("import-data").value = "";
  if (!file) return;
  void run(async () => {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("Arquivo grande demais para um backup do StreamFluent.");
    let backup: unknown;
    try { backup = JSON.parse(await file.text()); } catch { throw new Error("Esse arquivo não é um backup do StreamFluent."); }
    let result: { words: number; marks: number; phrases: number };
    try { result = (await requestStudy<typeof result>("import", { backup })).data; }
    catch (error) { throw new Error(`Não foi possível importar: ${error instanceof Error ? error.message : "arquivo inválido."}`); }
    el("feedback").textContent = `Backup importado: ${result.words} palavras vistas novas, ${result.marks} marcações e ${result.phrases} frases adicionadas. Suas preferências foram restauradas.`;
  });
});
function startOver(id: string, question: string, action: "reset-seen" | "reset-all", done: string) {
  el(id).addEventListener("click", () => {
    // Deleting is an edit like any other: with sync on, the next cycle removes the same items from the account.
    const account = action === "reset-all" && syncEnabled ? " Com a sincronização ativa, a cópia na conta também será apagada na próxima sincronização." : "";
    if (!confirm(question + account)) return;
    void run(async () => { await requestStudy(action); el("feedback").textContent = done; });
  });
}
startOver("reset-seen", "Apagar o histórico de palavras vistas? Todas as palavras voltam a aparecer como novas (azul). Marcações e frases ficam.",
  "reset-seen", "Histórico de palavras vistas apagado.");
startOver("reset-all", "Apagar todos os dados de estudo? Palavras vistas, marcações, frases e traduções guardadas serão apagadas; nível e preferências ficam. Exporte um backup antes se quiser guardar.",
  "reset-all", "Dados de estudo apagados. Nível e preferências foram mantidos.");

chrome.storage.onChanged.addListener((changes, area) => {
  if (!busy && area === "local" && ["sfAccount", "phrases", "vocabulary", "settings"].some(k => k in changes)) void refresh().catch(() => {});
});
void refresh().catch(error => { el("error").textContent = error instanceof Error ? error.message : "Não foi possível carregar."; });
