import { cpSync, mkdirSync, rmSync, copyFileSync, statSync } from "node:fs";
let esbuild;
try { esbuild = await import("esbuild"); }
catch { esbuild = await import(process.env.ESBUILD_PATH ?? "esbuild"); } // offline fallback: set ESBUILD_PATH
rmSync("dist", { recursive: true, force: true }); mkdirSync("dist", { recursive: true });
await esbuild.build({ entryPoints: { app: "src/main.ts" }, bundle: true, minify: true, format: "esm", target: "es2022", outdir: "dist", sourcemap: true });
await esbuild.build({ entryPoints: { app: "src/styles.css" }, bundle: true, minify: true, outdir: "dist" });
copyFileSync("index.html", "dist/index.html"); cpSync("public", "dist", { recursive: true });
console.log("built dist/ — app.js", statSync("dist/app.js").size, "bytes");
