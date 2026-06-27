// Entry point of the StreamFluent content script.
// This file runs INSIDE the Netflix page, in the "isolated world": it sees the
// page's DOM but has its own variable scope (it doesn't collide with Netflix's
// own JavaScript).
//
// ─────────────────────────────────────────────────────────────────────────
// STEP 1 — "Skeleton" (your turn)
// Make a sign of your own show up here. A console.log is enough to prove the
// extension was loaded and injected into the page. Then:
//   1. npm run build
//   2. chrome://extensions  ->  Developer mode  ->  Load unpacked
//      -> point it at the dist/ folder
//   3. open Netflix, open DevTools (F12) and confirm your log in the Console.
//
// When that shows up, step 1 is DONE. From step 2 on, this file becomes the
// "conductor": it captures the subtitle, draws yours on top and ties everything
// to video.currentTime.
// ─────────────────────────────────────────────────────────────────────────

console.log("teste");

export {};
