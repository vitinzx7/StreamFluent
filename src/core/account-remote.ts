import { createClient, isAuthError, isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { validateDocument, type StudyDocument } from "./study-document.ts";
export const ACCOUNT_ORIGIN = "https://ttzpioosgfacsutwmhif.supabase.co";
// Intentionally public. RLS, not this key, is the authorization boundary.
const PUBLISHABLE_KEY = "sb_publishable_wvzsO3v2ppV8TfCChqObVA_nL0TcyY3";
const SESSION_KEY = "sfAccountSession";
export interface AccountUser { id: string; email: string }
export interface RemoteDocument { revision: number; document: StudyDocument }
export interface AccountRemote {
  user(): Promise<AccountUser | null>;
  signIn(email: string, password: string): Promise<AccountUser>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  read(userId: string): Promise<RemoteDocument | null>;
  write(expectedRevision: number, document: StudyDocument): Promise<number | null>;
}
// Supabase Auth codes the user can act on. Anything else keeps the caller's generic message.
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos. Se ainda não tem conta, use Criar conta.",
  email_not_confirmed: "Cadastro ainda não confirmado. Abra o link enviado ao seu e-mail (veja também o spam) e entre de novo.",
  user_already_exists: "Este e-mail já tem conta. Use Entrar.",
  email_exists: "Este e-mail já tem conta. Use Entrar.",
  weak_password: "Senha fraca. Use uma senha mais longa, misturando letras e números.",
  email_address_invalid: "O servidor de contas recusou este e-mail. Use outro endereço.",
  email_address_not_authorized: "O envio de e-mail do projeto ainda não aceita este endereço (falta configurar o SMTP próprio no Supabase).",
  over_email_send_rate_limit: "O projeto atingiu o limite de e-mails por hora. Tente de novo mais tarde.",
  over_request_rate_limit: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  signup_disabled: "O cadastro de contas está desativado no momento.",
};
function authError(error: unknown, fallback: string): Error {
  if (isAuthRetryableFetchError(error)) return new Error("Sem conexão com o servidor de contas. Confira a internet e tente de novo.");
  const code = isAuthError(error) ? error.code : undefined;
  return new Error((code && AUTH_MESSAGES[code]) || fallback);
}
export function allowedAccountUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.origin === ACCOUNT_ORIGIN && !url.username && !url.password
      && ["/auth/v1/token", "/auth/v1/signup", "/auth/v1/user", "/auth/v1/logout", "/rest/v1/study_accounts", "/rest/v1/rpc/save_study_account"].includes(url.pathname);
  } catch { return false; }
}
export async function accountFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!allowedAccountUrl(url)) throw new Error("Destino de conta bloqueado.");
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 12000);
  const signal = init?.signal;
  const cancel = () => timeout.abort();
  if (signal?.aborted) timeout.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try { return await fetch(input, { ...init, signal: timeout.signal, credentials: "omit", redirect: "error", cache: "no-store" }); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}
export function createAccountRemote(ready: Promise<void>): AccountRemote {
  let client: SupabaseClient | undefined;
  async function getClient() {
    await ready;
    return client ??= createClient(ACCOUNT_ORIGIN, PUBLISHABLE_KEY, {
      global: { fetch: accountFetch },
      auth: {
        storageKey: SESSION_KEY, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
        storage: {
          async getItem(key) { const raw = await chrome.storage.local.get(key); return typeof raw[key] === "string" ? raw[key] as string : null; },
          async setItem(key, value) { await chrome.storage.local.set({ [key]: value }); },
          async removeItem(key) { await chrome.storage.local.remove(key); },
        },
      },
    });
  }
  function userValue(user: { id: string; email?: string } | null): AccountUser | null { return user ? { id: user.id, email: user.email ?? "" } : null; }
  return {
    async user() {
      const supabase = await getClient();
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session.session) return null;
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return userValue(data.user);
    },
    async signIn(email, password) {
      const { data, error } = await (await getClient()).auth.signInWithPassword({ email, password });
      if (error || !data.user) throw authError(error, "Não foi possível entrar. Confira e-mail, senha e confirmação do cadastro.");
      return userValue(data.user)!;
    },
    async signUp(email, password) {
      const supabase = await getClient();
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw authError(error, "Não foi possível cadastrar. Confira os dados e a configuração de e-mail do projeto.");
      await supabase.auth.signOut({ scope: "local" });
      // With confirmation on, Supabase answers an already confirmed e-mail with a user without identities and sends nothing.
      if (data.user?.identities?.length === 0) throw new Error(AUTH_MESSAGES.user_already_exists);
    },
    async signOut() {
      const supabase = await getClient();
      try { await supabase.auth.signOut({ scope: "local" }); }
      finally {
        // Local logout must work offline too. Discard the in-memory client as well.
        await chrome.storage.local.remove(SESSION_KEY); client = undefined;
      }
    },
    async read(userId) {
      const { data, error } = await (await getClient()).from("study_accounts").select("revision,document").eq("user_id", userId).maybeSingle();
      if (error) throw new Error("Não foi possível ler a conta. Os dados locais foram preservados.");
      if (!data) return null;
      if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error("Revisão de conta incompatível.");
      return { revision: data.revision as number, document: validateDocument(data.document) };
    },
    async write(expectedRevision, document) {
      const { data, error } = await (await getClient()).rpc("save_study_account", { expected_revision: expectedRevision, new_document: document });
      if (error) throw new Error("Não foi possível sincronizar. Dados locais preservados; tente novamente.");
      if (data === null) return null;
      if (!Number.isSafeInteger(data) || data < 1) throw new Error("Resposta de sincronização incompatível.");
      return data as number;
    },
  };
}
