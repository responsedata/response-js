#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dryRun = process.argv.includes("--dry-run");
const repositoryUrl = "git+https://github.com/responsedata/response-js.git";
const packageFiles = [
  "packages/browser/package.json",
  "packages/next/package.json",
  "packages/cdn/package.json",
];
const publicPackageFiles = new Set(packageFiles.slice(0, 2));

const withoutRepositoryMetadata = ({
  bugs: _bugs,
  homepage: _homepage,
  repository: _repository,
  ...manifest
}) => manifest;

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
    `SDK package versions must stay in lockstep: ${[...versions].join(", ")}`,
  );
}

for (const { manifest } of packages.filter(
  ({ manifest }) => manifest.private !== true,
)) {
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

const base = process.env.PUBLISH_BASE_SHA?.trim();
if (base && !/^0+$/.test(base)) {
  const diff = run("git", ["diff", "--name-only", base, "HEAD"]);
  if (diff.status !== 0) {
    throw new Error(`Unable to compare this release with ${base}.`);
  }

  const releaseInputsChanged = diff.stdout.split("\n").some((file) => {
    if (file === "scripts/build-sdk-packages.mjs") {
      return true;
    }
    if (publicPackageFiles.has(file)) {
      const previous = run("git", ["show", `${base}:${file}`]);
      if (previous.status !== 0) {
        return true;
      }
      const current = packages.find((entry) => entry.file === file)?.manifest;
      return (
        !current ||
        !isDeepStrictEqual(
          withoutRepositoryMetadata(JSON.parse(previous.stdout)),
          withoutRepositoryMetadata(current),
        )
      );
    }
    return (
      file.startsWith("packages/browser/") ||
      file.startsWith("packages/cdn/") ||
      file.startsWith("packages/next/")
    );
  });

  if (releaseInputsChanged) {
    const unbumped = packages.filter(({ file, manifest }) => {
      const previous = run("git", ["show", `${base}:${file}`]);
      return (
        previous.status === 0 &&
        JSON.parse(previous.stdout).version === manifest.version
      );
    });

    if (unbumped.length > 0) {
      throw new Error(
        [
          "SDK release inputs changed without a version bump:",
          ...unbumped.map(
            ({ manifest }) => `- ${manifest.name}@${manifest.version}`,
          ),
          "Run `pnpm sdk:version patch`, test, and commit the manifests.",
        ].join("\n"),
      );
    }
  }
}

const publishArgs = [
  "--filter",
  "@responsedata/browser",
  "--filter",
  "@responsedata/nextjs",
  "--recursive",
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
