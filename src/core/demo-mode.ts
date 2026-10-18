// Set by build.mjs: true only in `npm run build:demo` (dist-demo/), false in the
// normal build. Absent under vitest, where it reads as false.
declare const __SF_DEMO__: boolean | undefined;

/** The demo build, for recording a video: see demo-colors.ts. */
export const DEMO_MODE: boolean = typeof __SF_DEMO__ !== "undefined" && __SF_DEMO__;
