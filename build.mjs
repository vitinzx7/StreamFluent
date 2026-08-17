import * as esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

cpSync("public", "dist", { recursive: true });

const shared = {
  bundle: true,
  format: "iife",
  target: ["chrome111"],
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

const entries = {
  content: "src/content/content.ts",
};

if (watch) {
  const ctx = await esbuild.context({ ...shared, entryPoints: entries, outdir: "dist" });
  await ctx.watch();
  console.log("[StreamFluent] watch enabled — rebuilding on save.");
} else {
  await esbuild.build({ ...shared, entryPoints: entries, outdir: "dist" });
  console.log("[StreamFluent] build ready in dist/");
}
