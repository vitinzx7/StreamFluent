import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_ORIGIN, accountFetch, allowedAccountUrl } from "../core/account-remote.ts";
import { isAllowedProviderUrl } from "../core/translation-request.ts";
afterEach(() => vi.unstubAllGlobals());
describe("account network boundary", () => {
  it("only admits the exact project and necessary paths, never a provider relay", () => {
    expect(allowedAccountUrl(`${ACCOUNT_ORIGIN}/auth/v1/token?grant_type=password`)).toBe(true);
    expect(allowedAccountUrl(`${ACCOUNT_ORIGIN}/rest/v1/rpc/save_study_account`)).toBe(true);
    for (const url of ["http://ttzpioosgfacsutwmhif.supabase.co/auth/v1/token", `${ACCOUNT_ORIGIN}.evil.test/auth/v1/token`, `${ACCOUNT_ORIGIN}/storage/v1/object`, `https://user@ttzpioosgfacsutwmhif.supabase.co/auth/v1/token`, "https://evil.test/auth/v1/token"]) expect(allowedAccountUrl(url)).toBe(false);
    expect(isAllowedProviderUrl(`${ACCOUNT_ORIGIN}/rest/v1/study_accounts`)).toBe(false);
  });
  it("omits cookies and refuses redirects and unapproved destinations", async () => {
    const fetcher = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await accountFetch(`${ACCOUNT_ORIGIN}/auth/v1/user`);
    expect(fetcher).toHaveBeenCalledWith(`${ACCOUNT_ORIGIN}/auth/v1/user`, expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
    await expect(accountFetch("https://evil.test")).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("real SDK with controlled HTTP and trusted storage", () => {
  it("authenticates, persists/reloads a worker session and uses authenticated Data API requests", async () => {
    const { createAccountRemote } = await import("../core/account-remote.ts");
    const { emptyDocument } = await import("../core/study-document.ts");
    const values: Record<string, string> = {};
    const id = "5f000000-0000-4000-8000-000000000001";
    const user = { id, email: "a@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/v1/token")) return Response.json({ access_token: jwt, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, user });
      if (url.includes("/auth/v1/user")) return Response.json(user);
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${jwt}`);
      if (url.includes("/rest/v1/study_accounts")) return Response.json({ revision: 1, document: emptyDocument() });
      if (url.includes("/rest/v1/rpc/save_study_account")) return Response.json(2);
      throw new Error("Unexpected fixture URL");
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("chrome", { storage: { local: {
      get: async (key: string) => ({ [key]: values[key] }), set: async (items: Record<string, string>) => { Object.assign(values, items); }, remove: async (key: string) => { delete values[key]; },
    } } });
    const remote = createAccountRemote(Promise.resolve());
    expect(await remote.signIn(user.email, "fixture-password")).toEqual({ id, email: user.email });
    expect(Object.keys(values)).toEqual(["sfAccountSession"]);
    const restarted = createAccountRemote(Promise.resolve());
    expect(await restarted.user()).toEqual({ id, email: user.email });
    expect((await restarted.read(id))?.revision).toBe(1);
    expect(await restarted.write(1, emptyDocument())).toBe(2);
    await restarted.signOut(); expect(values).toEqual({});
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
  });
  it("does not touch auth or persist a session if trusted storage setup failed", async () => {
    const { createAccountRemote } = await import("../core/account-remote.ts");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const remote = createAccountRemote(Promise.reject(new Error("storage denied")));
    await expect(remote.signIn("a@example.test", "fixture-password")).rejects.toThrow(/storage denied/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
