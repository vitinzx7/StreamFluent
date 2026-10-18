import { handleNetflixSeekRequests } from "../core/netflix-bridge.ts";

// Runs in Netflix's own page world (manifest "world": "MAIN"); see
// src/core/netflix-bridge.ts for why seeking cannot happen from content.ts.
// A re-injection replaces the previous listener instead of adding a second.
const page = window as Window & { __sfNetflixBridge?: () => void };
page.__sfNetflixBridge?.();
page.__sfNetflixBridge = handleNetflixSeekRequests(window);
