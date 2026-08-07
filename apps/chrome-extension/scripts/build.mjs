#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(appDirectory, "dist");

await fs.rm(outputDirectory, { force: true, recursive: true });
await fs.mkdir(outputDirectory, { recursive: true });

await build({
  bundle: true,
  entryPoints: {
    devtools: path.join(appDirectory, "src/devtools.ts"),
    panel: path.join(appDirectory, "src/panel.ts"),
  },
  format: "iife",
  legalComments: "none",
  outdir: outputDirectory,
  platform: "browser",
  target: "es2020",
});

await build({
  bundle: true,
  entryPoints: [path.join(appDirectory, "src/inspect.ts")],
  format: "esm",
  legalComments: "none",
  outfile: path.join(outputDirectory, "inspect.js"),
  platform: "neutral",
  target: "es2020",
});

await Promise.all(
  [
    ["manifest.json", "manifest.json"],
    ["src/devtools.html", "devtools.html"],
    ["src/panel.html", "panel.html"],
    ["src/panel.css", "panel.css"],
  ].map(([source, destination]) =>
    fs.copyFile(
      path.join(appDirectory, source),
      path.join(outputDirectory, destination),
    ),
  ),
);
