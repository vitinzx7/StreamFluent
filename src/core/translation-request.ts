/** Only these existing providers may receive subtitle text. */
export function isAllowedProviderUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return (url.hostname === "clients5.google.com" && url.pathname === "/translate_a/t") ||
      (url.hostname === "api.mymemory.translated.net" && url.pathname === "/get") ||
      (url.hostname === "api.dictionaryapi.dev" && /^\/api\/v2\/entries\/en\/[^/]+$/.test(url.pathname));
  } catch {
    return false;
  }
}

export interface ProviderResponse {
  ok: boolean;
  data?: unknown;
}

/** Runs in the service worker; never forwards page cookies or follows redirects. */
export async function fetchProviderJson(url: string): Promise<ProviderResponse> {
  if (!isAllowedProviderUrl(url)) return { ok: false };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    if (!response.ok) return { ok: false };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  }
}

/** Content-script fetch is subject to the page's CORS policy. Use the worker. */
export async function requestProviderJson(url: string): Promise<unknown> {
  const response: ProviderResponse = typeof chrome !== "undefined" && chrome.runtime?.id
    ? await chrome.runtime.sendMessage({ type: "sf:provider-json", url })
    : await fetchProviderJson(url);
  return response?.ok ? response.data : null;
}
