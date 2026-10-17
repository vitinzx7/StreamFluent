import { handleNetflixSeekRequests } from "../core/netflix-bridge.ts";

// Runs in Netflix's own page world (manifest "world": "MAIN"); see
// src/core/netflix-bridge.ts for why seeking cannot happen from content.ts.
handleNetflixSeekRequests(window);
