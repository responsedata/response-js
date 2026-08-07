#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkPackageFiles } from "./sdk-package-files.mjs";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const packageFiles = sdkPackageFiles;
const manifests = await Promise.all(
  packageFiles.map(async (file) =>
    JSON.parse(await fs.readFile(path.join(rootDirectory, file), "utf8")),
  ),
);
const versions = new Set(manifests.map((manifest) => manifest.version));

if (versions.size !== 1) {
  throw new Error(
    `Release versions must stay in lockstep: ${[...versions].join(", ")}`,
  );
}

const version = manifests[0].version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Expected a stable semantic version; received ${version}.`);
}
if (!tag) {
  throw new Error("Pass the release tag, for example: pnpm release:verify v0.1.0");
}
if (tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match SDK version ${version}.`);
}

console.log(`Verified ${tag} for npm packages and CDN assets.`);
