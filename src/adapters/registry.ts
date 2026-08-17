import type { StreamingAdapter } from "../core/types.ts";
import { NetflixAdapter } from "./netflix.ts";

let cached: StreamingAdapter | null = null;

export function getAdapter(): StreamingAdapter | null {
  if (cached) return cached;

  const host = location.hostname;

  if (host.includes("netflix.com")) {
    cached = new NetflixAdapter();
    return cached;
  }

  if (host.includes("max.com") || host.includes("hbomax.com")) {
    // MaxAdapter will be added here
    return null;
  }

  return null;
}
