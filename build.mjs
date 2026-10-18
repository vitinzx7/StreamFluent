import * as esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
// `--demo`: a separate extension for recording a demo video (see src/core/demo-colors.ts).
// Its own folder gives it its own extension id, so its data never mixes with the real one.
const demo = process.argv.includes("--demo");
const outdir = demo ? "dist-demo" : "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

cpSync("public", outdir, { recursive: true });
if (demo) {
  const manifestPath = `${outdir}/manifest.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.name = `${manifest.name} (demo)`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const shared = {
  bundle: true,
  format: "iife",
  target: ["chrome111"],
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  define: { __SF_DEMO__: String(demo) },
};

const entries = {
  content: "src/content/content.ts",
  background: "src/background/background.ts",
  "player-test": "src/content/player-test.ts",
  // Runs in Netflix's page world to reach its player API; see netflix-bridge.ts.
  "netflix-main": "src/content/netflix-main.ts",
};

if (watch) {
  const ctx = await esbuild.context({ ...shared, entryPoints: entries, outdir });
  await ctx.watch();
  console.log("[StreamFluent] watch enabled — rebuilding on save.");
} else {
  await esbuild.build({ ...shared, entryPoints: entries, outdir });
  console.log(`[StreamFluent] build ready in ${outdir}/`);
}
