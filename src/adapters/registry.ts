import type { StreamingAdapter } from "../core/types.ts";
import { NetflixAdapter } from "./netflix.ts";
import { MaxAdapter } from "./max.ts";

let cached: StreamingAdapter | null = null;

export function getAdapter(): StreamingAdapter | null {
  if (cached) return cached;

  const host = location.hostname;

  if (host.includes("netflix.com")) {
    cached = new NetflixAdapter();
    return cached;
  }

  if (host.includes("max.com") || host.includes("hbomax.com")) {
    cached = new MaxAdapter();
    return cached;
  }

  return null;
}
