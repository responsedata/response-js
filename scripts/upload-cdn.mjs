#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dryRun = process.argv.includes("--dry-run");
const bucket =
  process.env.RESPONSE_CDN_R2_BUCKET?.trim() || "response-js-cdn";
const origin = (
  process.env.RESPONSE_CDN_ORIGIN?.trim() || "https://cdn.response.sh"
).replace(/\/$/, "");
const manifest = JSON.parse(
  await fs.readFile(
    path.join(rootDirectory, "packages/browser/package.json"),
    "utf8",
  ),
);
const artifact = path.join(rootDirectory, "apps/cdn/dist/browser.js");
await fs.access(artifact);

const uploads = [
  {
    cacheControl: "public, max-age=31536000, immutable",
    key: `${manifest.version}/browser.js`,
  },
  {
    cacheControl:
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    key: "browser.js",
  },
];

for (const upload of uploads) {
  const args = [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${upload.key}`,
    "--file",
    artifact,
    "--content-type",
    "application/javascript; charset=utf-8",
    "--cache-control",
    upload.cacheControl,
    "--remote",
    "--force",
  ];

  if (dryRun) {
    console.log(`Would run: pnpm ${args.join(" ")}`);
    continue;
  }

  const result = spawnSync("pnpm", args, {
    cwd: rootDirectory,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const verb = dryRun ? "Would publish" : "Published";
console.log(`${verb} immutable SDK: ${origin}/${manifest.version}/browser.js`);
console.log(`${verb} rolling SDK:   ${origin}/browser.js`);
