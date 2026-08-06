#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dryRun = process.argv.includes("--dry-run");
const tagArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--dry-run");
const packageFiles = [
  "packages/browser/package.json",
  "packages/next/package.json",
];
const bucket =
  process.env.RESPONSE_CDN_R2_BUCKET?.trim() || "response-js-cdn";
const releaseEnvironment = {
  ...process.env,
  // A local publish cannot create npm's CI provenance attestation. The normal
  // trusted-publishing workflow still generates provenance automatically.
  NPM_CONFIG_PROVENANCE: "false",
};

const run = (cwd, command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: releaseEnvironment,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
};

const output = (cwd, command, args) => {
  const result = run(cwd, command, args);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
};

const runChecked = (cwd, command, args) => {
  const result = run(cwd, command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
};

const compareStableVersions = (left, right) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
};

let temporaryRoot;
let worktreeDirectory;
let worktreeAdded = false;

try {
  if (tagArguments.length !== 1 || !/^v\d+\.\d+\.\d+$/.test(tagArguments[0])) {
    throw new Error(
      "Pass exactly one stable release tag, for example: " +
        "`pnpm release:publish-local v0.1.8`.",
    );
  }
  const releaseTag = tagArguments[0];
  const requestedVersion = releaseTag.slice(1);

  const registry = output(rootDirectory, "npm", [
    "config",
    "get",
    "registry",
  ]).replace(/\/+$/, "");
  if (registry !== "https://registry.npmjs.org") {
    throw new Error(
      `Expected the public npm registry; npm is configured for ${registry}.`,
    );
  }

  const taggedCommit = output(rootDirectory, "git", [
    "rev-parse",
    `${releaseTag}^{commit}`,
  ]);
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "response-js-release-"),
  );
  worktreeDirectory = path.join(temporaryRoot, "checkout");
  runChecked(rootDirectory, "git", [
    "worktree",
    "add",
    "--detach",
    worktreeDirectory,
    releaseTag,
  ]);
  worktreeAdded = true;

  const manifests = await Promise.all(
    packageFiles.map(async (file) =>
      JSON.parse(await fs.readFile(path.join(worktreeDirectory, file), "utf8")),
    ),
  );
  const versions = new Set(manifests.map((manifest) => manifest.version));
  if (versions.size !== 1 || !versions.has(requestedVersion)) {
    throw new Error(
      `${releaseTag} does not match both SDK package versions: ` +
        `${[...versions].join(", ")}.`,
    );
  }

  const checkoutCommit = output(worktreeDirectory, "git", [
    "rev-parse",
    "HEAD",
  ]);
  if (checkoutCommit !== taggedCommit) {
    throw new Error(`The release checkout does not match ${releaseTag}.`);
  }
  runChecked(worktreeDirectory, "pnpm", ["release:verify", releaseTag]);

  for (const manifest of manifests) {
    const latest = run(worktreeDirectory, "npm", [
      "view",
      manifest.name,
      "dist-tags.latest",
      "--json",
    ]);
    if (latest.status === 0) {
      const latestVersion = JSON.parse(latest.stdout);
      if (compareStableVersions(requestedVersion, latestVersion) < 0) {
        throw new Error(
          `Refusing to publish ${releaseTag}: ${manifest.name}@${latestVersion} ` +
            "is already newer. This would roll back npm latest and the rolling CDN asset.",
        );
      }
    } else if (!`${latest.stdout}\n${latest.stderr}`.includes("E404")) {
      throw new Error(
        `Unable to read the latest ${manifest.name} release from npm:\n` +
          `${latest.stderr || latest.stdout}`,
      );
    }
  }

  console.log(`Preparing ${releaseTag} from ${taggedCommit}.`);
  runChecked(worktreeDirectory, "pnpm", ["install", "--frozen-lockfile"]);

  if (!dryRun) {
    const npmIdentity = run(worktreeDirectory, "npm", ["whoami"]);
    if (npmIdentity.status !== 0) {
      throw new Error(
        "npm is not authenticated. Run `npm login --auth-type=web`, complete " +
          "the browser and 2FA prompts, then retry.",
      );
    }
    console.log(`Authenticated to npm as ${npmIdentity.stdout.trim()}.`);

    const cloudflareBucket = run(worktreeDirectory, "pnpm", [
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "info",
      bucket,
      "--json",
    ]);
    if (cloudflareBucket.status !== 0) {
      throw new Error(
        `Cloudflare access to R2 bucket ${bucket} could not be verified. Run ` +
          "`pnpm exec wrangler login` or export a narrowly scoped " +
          "CLOUDFLARE_API_TOKEN, then retry.",
      );
    }
    console.log(`Authenticated to Cloudflare R2 bucket ${bucket}.`);
  }

  runChecked(worktreeDirectory, "pnpm", ["test"]);

  const postTestCommit = output(worktreeDirectory, "git", [
    "rev-parse",
    "HEAD",
  ]);
  const postTestStatus = output(worktreeDirectory, "git", ["status", "--short"]);
  if (postTestCommit !== taggedCommit || postTestStatus) {
    throw new Error(
      `The temporary checkout changed while preparing ${releaseTag}:\n` +
        (postTestStatus || `${postTestCommit} does not match ${taggedCommit}`),
    );
  }

  if (dryRun) {
    runChecked(worktreeDirectory, "pnpm", ["sdk:publish:dry-run"]);
    runChecked(worktreeDirectory, "pnpm", ["cdn:upload:dry-run"]);
    console.log(`\nDry run completed for ${releaseTag}. Nothing was published.`);
  } else {
    runChecked(worktreeDirectory, "pnpm", ["sdk:publish"]);
    runChecked(worktreeDirectory, "pnpm", ["cdn:upload"]);
    console.log(`\nPublished ${releaseTag} to npm and the Response CDN.`);
  }
} catch (error) {
  console.error("\nLocal release publication stopped\n");
  console.error(error instanceof Error ? error.message : String(error));
  console.error();
  process.exitCode = 1;
} finally {
  if (worktreeAdded && worktreeDirectory) {
    const cleanup = run(rootDirectory, "git", [
      "worktree",
      "remove",
      "--force",
      worktreeDirectory,
    ]);
    if (cleanup.status !== 0) {
      console.error(
        `Unable to remove temporary worktree ${worktreeDirectory}:\n` +
          `${cleanup.stderr || cleanup.stdout}`,
      );
      process.exitCode = 1;
    }
  }
  if (temporaryRoot) {
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  }
}
