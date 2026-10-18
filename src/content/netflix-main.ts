import { handleNetflixSeekRequests } from "../core/netflix-bridge.ts";
// Re-injection replaces the previous MAIN listener; no extension privileges.
const owner = window as Window & { __sfNetflixBridge?: () => void };
owner.__sfNetflixBridge?.();
owner.__sfNetflixBridge = handleNetflixSeekRequests(window);
