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
    background: path.join(appDirectory, "src/background.ts"),
    popup: path.join(appDirectory, "src/popup.ts"),
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
    ["src/popup.html", "popup.html"],
    ["src/popup.css", "popup.css"],
  ].map(([source, destination]) =>
    fs.copyFile(
      path.join(appDirectory, source),
      path.join(outputDirectory, destination),
    ),
  ),
);

const encodedIcon = await fs.readFile(
  path.join(appDirectory, "src/icon.png.base64"),
  "utf8",
);
await fs.writeFile(
  path.join(outputDirectory, "icon.png"),
  Buffer.from(encodedIcon.trim(), "base64"),
);
