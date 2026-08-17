import type { StreamingAdapter } from "../core/types.ts";

export function getAdapter(): StreamingAdapter | null {
  const host = location.hostname;

  if (host.includes("netflix.com")) {
    // Netflix adapter will be imported here
    return null;
  }

  if (host.includes("max.com") || host.includes("hbomax.com")) {
    // Max adapter will be imported here
    return null;
  }

  return null;
}
