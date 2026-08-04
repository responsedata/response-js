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
const repositoryUrl = "git+https://github.com/responsedata/response-js.git";
const packageFiles = [
  "packages/browser/package.json",
  "packages/next/package.json",
];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
};

const packages = await Promise.all(
  packageFiles.map(async (file) =>
    JSON.parse(await fs.readFile(path.join(rootDirectory, file), "utf8")),
  ),
);
const versions = new Set(packages.map((manifest) => manifest.version));

if (versions.size !== 1) {
  throw new Error(
    `SDK package versions must stay in lockstep: ${[...versions].join(", ")}`,
  );
}

for (const manifest of packages) {
  if (manifest.private === true) {
    throw new Error(`${manifest.name} is configured as a private package.`);
  }
  if (manifest.repository?.url !== repositoryUrl) {
    throw new Error(
      `${manifest.name} must declare repository.url as ${repositoryUrl}.`,
    );
  }
  if (!manifest.license || manifest.license === "UNLICENSED") {
    const message = `${manifest.name} does not have a distributable license.`;
    if (!dryRun) {
      throw new Error(`${message} Choose one before the first release.`);
    }
    console.warn(`Warning: ${message}`);
  }
}

for (const manifest of packages) {
  if (!dryRun) {
    const published = run("npm", [
      "view",
      `${manifest.name}@${manifest.version}`,
      "version",
      "--json",
    ]);

    if (published.status === 0) {
      console.log(
        `Skipping ${manifest.name}@${manifest.version}; it is already published.`,
      );
      continue;
    }

    const lookupOutput = `${published.stdout}\n${published.stderr}`;
    if (!lookupOutput.includes("E404")) {
      throw new Error(
        `Unable to check ${manifest.name}@${manifest.version} on npm:\n${lookupOutput}`,
      );
    }
  }

  const publishArgs = [
    "--filter",
    manifest.name,
    "publish",
    "--access",
    "public",
    "--no-git-checks",
  ];
  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  const result = run("pnpm", publishArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
