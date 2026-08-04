#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const releaseType = process.argv[2];
const packageFiles = [
  "packages/browser/package.json",
  "packages/next/package.json",
];
const bumpIndex = { major: 0, minor: 1, patch: 2 }[releaseType];

if (bumpIndex === undefined) {
  console.error("Usage: pnpm sdk:version <major|minor|patch>");
  process.exit(1);
}

const packages = await Promise.all(
  packageFiles.map(async (file) => ({
    file,
    manifest: JSON.parse(
      await fs.readFile(path.join(rootDirectory, file), "utf8"),
    ),
  })),
);
const versions = new Set(packages.map(({ manifest }) => manifest.version));
if (versions.size !== 1) {
  throw new Error(
    `SDK package versions must match: ${[...versions].join(", ")}`,
  );
}

const currentVersion = packages[0].manifest.version;
const parts = currentVersion.split(".").map(Number);
if (
  !/^\d+\.\d+\.\d+$/.test(currentVersion) ||
  parts.some((part) => !Number.isSafeInteger(part))
) {
  throw new Error(`Expected a stable semantic version; received ${currentVersion}.`);
}

parts[bumpIndex] += 1;
for (let index = bumpIndex + 1; index < parts.length; index += 1) {
  parts[index] = 0;
}
const nextVersion = parts.join(".");

await Promise.all(
  packages.map(async ({ file, manifest }) => {
    manifest.version = nextVersion;
    await fs.writeFile(
      path.join(rootDirectory, file),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }),
);

console.log(`Updated SDK packages from ${currentVersion} to ${nextVersion}.`);
