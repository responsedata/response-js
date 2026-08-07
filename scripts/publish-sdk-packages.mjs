#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sdkPackageFiles } from "./sdk-package-files.mjs";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dryRun = process.argv.includes("--dry-run");
const publicRegistry = "https://registry.npmjs.org";
const availabilityTimeoutMs = 20 * 60 * 1000;
const availabilityPollIntervalMs = 5 * 1000;
const repositoryUrl = "git+https://github.com/responsedata/response-js.git";
const packageFiles = sdkPackageFiles;
const npmEnvironment = { ...process.env };

// pnpm exposes private npm-config variables to child processes. npm warns
// about these unknown values, and they are unrelated to publishing.
for (const key of Object.keys(npmEnvironment)) {
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey === "npm_config_verify_deps_before_run" ||
    normalizedKey.includes("jsr_registry") ||
    normalizedKey.includes("jsr-registry")
  ) {
    delete npmEnvironment[key];
  }
}

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

const isNotFound = (result) =>
  `${result.stdout}\n${result.stderr}`.includes("E404");

const npmDistTagVersions = (packageName) => {
  const result = run(
    "npm",
    [
      "dist-tag",
      "ls",
      packageName,
      "--registry",
      publicRegistry,
    ],
    { env: npmEnvironment },
  );
  if (result.status === 0) {
    return new Set(
      result.stdout
        .split("\n")
        .map((line) => line.slice(line.indexOf(":") + 1).trim())
        .filter(Boolean),
    );
  }
  if (isNotFound(result)) {
    return new Set();
  }
  throw new Error(
    `Unable to read npm dist-tags for ${packageName}:\n` +
      `${result.stderr || result.stdout}`,
  );
};

const waitForNpmAvailability = async (manifests) => {
  const deadline = Date.now() + availabilityTimeoutMs;
  let nextProgressMessageAt = 0;

  while (true) {
    const pending = [];
    for (const manifest of manifests) {
      const published = run(
        "npm",
        [
          "view",
          `${manifest.name}@${manifest.version}`,
          "version",
          "--json",
          "--registry",
          publicRegistry,
        ],
        { env: npmEnvironment },
      );
      if (published.status === 0) {
        continue;
      }
      if (!isNotFound(published)) {
        throw new Error(
          `Unable to check ${manifest.name}@${manifest.version} on npm:\n` +
            `${published.stderr || published.stdout}`,
        );
      }
      pending.push(`${manifest.name}@${manifest.version}`);
    }

    if (pending.length === 0) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `npm is still scanning ${pending.join(", ")} after 20 minutes. ` +
          "Check npm for a security-review notice, then rerun the release workflow.",
      );
    }
    if (Date.now() >= nextProgressMessageAt) {
      console.log(`Waiting for npm scanning: ${pending.join(", ")}...`);
      nextProgressMessageAt = Date.now() + 30 * 1000;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, availabilityPollIntervalMs),
    );
  }
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

const stagingDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "response-js-publish-"),
);

try {
  for (const manifest of packages) {
    const published = run(
      "npm",
      [
        "view",
        `${manifest.name}@${manifest.version}`,
        "version",
        "--json",
        "--registry",
        publicRegistry,
      ],
      { env: npmEnvironment },
    );

    if (published.status === 0) {
      console.log(
        `Skipping ${manifest.name}@${manifest.version}; it is already published.`,
      );
      continue;
    }

    const lookupOutput = `${published.stdout}\n${published.stderr}`;
    if (!isNotFound(published)) {
      throw new Error(
        `Unable to check ${manifest.name}@${manifest.version} on npm:\n${lookupOutput}`,
      );
    }

    if (npmDistTagVersions(manifest.name).has(manifest.version)) {
      console.log(
        `Skipping ${manifest.name}@${manifest.version}; npm accepted it and is scanning it.`,
      );
      continue;
    }

    const packageDirectory = await fs.mkdtemp(
      path.join(stagingDirectory, "package-"),
    );
    const packResult = run(
      "pnpm",
      [
        "--filter",
        manifest.name,
        "pack",
        "--pack-destination",
        packageDirectory,
      ],
      { stdio: "inherit" },
    );
    if (packResult.status !== 0) {
      process.exitCode = packResult.status ?? 1;
      break;
    }

    const archives = (await fs.readdir(packageDirectory)).filter((file) =>
      file.endsWith(".tgz"),
    );
    if (archives.length !== 1) {
      throw new Error(
        `Expected one tarball for ${manifest.name}; found ${archives.length}.`,
      );
    }

    const publishArgs = [
      "publish",
      path.join(packageDirectory, archives[0]),
      "--access",
      "public",
      "--registry",
      publicRegistry,
    ];
    if (dryRun) {
      publishArgs.push("--dry-run");
    }

    // Trusted publishing exchanges GitHub's OIDC token only for npm publish.
    const publishResult = run("npm", publishArgs, {
      env: npmEnvironment,
      stdio: "inherit",
    });
    if (publishResult.status !== 0) {
      process.exitCode = publishResult.status ?? 1;
      break;
    }
  }
  if (!dryRun && !process.exitCode) {
    await waitForNpmAvailability(packages);
  }
} finally {
  await fs.rm(stagingDirectory, { force: true, recursive: true });
}
