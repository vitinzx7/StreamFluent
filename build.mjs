// Build for StreamFluent.
//
// Why a script and not just "tsc"? Because a content script is NOT an ES module
// — the browser injects a standalone .js file into the page. esbuild bundles
// all of your imports into a single file wrapped in an IIFE, which is the
// format a content script understands. tsc is left to only check types
// (npm run typecheck). Splitting "transpile" from "type-check" is intentional:
// the build stays fast and won't break on a type error while you test.
//
// Java analogy: esbuild is the Maven build plugin that produces the final
// artifact (the "JAR"); the dist/ folder is your target/.

import * as esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

// 1. Clean and recreate the output folder.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// 2. Copy static assets (manifest.json, icons...) public/ -> dist/.
cpSync("public", "dist", { recursive: true });

// 3. Bundle the content script.
const ctx = await esbuild.context({
  entryPoints: { content: "src/content/content.ts" },
  bundle: true,
  format: "iife", // a classic content script doesn't use ES modules
  target: ["chrome111"],
  outdir: "dist",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("[StreamFluent] watch enabled — rebuilding on save.");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[StreamFluent] build ready in dist/");
}
