import type { StreamingAdapter } from "../core/types.ts";
import { NetflixAdapter } from "./netflix.ts";
import { MaxAdapter } from "./max.ts";

let cached: StreamingAdapter | null = null;

export function getAdapter(): StreamingAdapter | null {
  if (cached) return cached;

  const host = location.hostname;
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (matches("netflix.com")) {
    cached = new NetflixAdapter();
    return cached;
  }

  if (matches("max.com") || matches("hbomax.com")) {
    cached = new MaxAdapter();
    return cached;
  }

  return null;
}
