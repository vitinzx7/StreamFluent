import type { Conflict } from "../core/study-document.ts";
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
let busy = false;
let conflictToken: string | null = null;
let importedText: string | null = null;
let statusSequence = 0;
async function request<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const requestId = crypto.randomUUID();
  const response: unknown = await chrome.runtime.sendMessage({ type: `sf:account:${action}`, requestId, payload });
  const reply = response as { ok?: boolean; requestId?: string; data?: T; error?: string } | null;
  if (!reply || reply.requestId !== requestId || reply.ok !== true || !("data" in reply)) throw new Error(reply?.error ?? "Não foi possível acessar os dados.");
  return reply.data as T;
}
interface Status { email: string; signedIn: boolean; enabled: boolean; synchronized: boolean; syncing: boolean; error: string | null; lastSyncedAt: string | null; conflictCount: number; conflictToken: string | null; conflicts: Conflict[] }
function render(status: Status) {
  el("state").textContent = status.synchronized ? "Salvo neste dispositivo · Sincronizado na conta"
    : status.conflictCount ? "Salvo neste dispositivo · Conflitos aguardando escolha"
    : status.enabled ? "Salvo neste dispositivo · Sincronização pendente" : "Salvo neste dispositivo · Sincronização desativada";
  el("account").textContent = status.email ? `Conta vinculada: ${status.email}${status.signedIn ? "" : " (entre novamente)"}` : "Sem conta vinculada.";
  el("last-sync").textContent = status.lastSyncedAt ? `Última confirmação da conta: ${new Date(status.lastSyncedAt).toLocaleString("pt-BR")}` : "Ainda não há sincronização confirmada.";
  el("error").textContent = status.error ?? "";
  el("login-section").hidden = status.signedIn; el("sync-section").hidden = !status.signedIn;
  el("sync").hidden = !status.enabled; el("disable").hidden = !status.enabled; el("enable").hidden = status.enabled;
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
  el("feedback").textContent = "Processando…";
  try { await operation(); await refresh(); }
  catch (error) { el("feedback").textContent = error instanceof Error ? error.message : "Não foi possível concluir."; }
  finally {
    busy = false; document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach(b => { b.disabled = false; });
    (el("import") as HTMLButtonElement).disabled = !importedText;
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
el("export").addEventListener("click", () => void run(async () => {
  const { backup } = await request<{ backup: string }>("export");
  const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `streamfluent-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); el("feedback").textContent = "Backup preparado sem credenciais. Confira o download e guarde o arquivo em local seguro.";
}));
async function preview() {
  (el("import") as HTMLButtonElement).disabled = true;
  const file = input("import-file").files?.[0]; importedText = null;
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) throw new Error("O arquivo excede 4 MB.");
  const text = await file.text();
  const result = await request<{ phrases: number; words: number; keptLocalConflicts: number }>("preview-import", { text, includeSettings: input("import-settings").checked });
  importedText = text;
  el("import-preview").textContent = `Arquivo: ${result.phrases} frases e ${result.words} palavras. ${result.keptLocalConflicts} conflitos manterão a versão local. Confirme para adicionar.`;
}
for (const id of ["import-file", "import-settings"]) el(id).addEventListener("change", () => void run(preview));
el("import").addEventListener("click", () => void run(async () => {
  if (!importedText) throw new Error("Escolha e confira um backup válido.");
  const result = await request<{ keptLocalConflicts: number }>("import", { text: importedText, includeSettings: input("import-settings").checked });
  importedText = null; input("import-file").value = "";
  el("feedback").textContent = `Importação salva neste dispositivo. ${result.keptLocalConflicts} conflitos mantiveram a versão local. Use Sincronizar agora para enviar à conta.`;
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (!busy && area === "local" && ["sfAccount", "phrases", "vocabulary", "settings"].some(k => k in changes)) void refresh().catch(() => {});
});
void refresh().catch(error => { el("error").textContent = error instanceof Error ? error.message : "Não foi possível carregar."; });
