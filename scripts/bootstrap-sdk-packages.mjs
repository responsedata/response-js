#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  locallyBootstrapableSdkPackageNames,
  sdkPackageFiles,
} from "./sdk-package-files.mjs";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicRegistry = "https://registry.npmjs.org";
const trustedPublisherRepository = "responsedata/response-js";
const trustedPublisherWorkflow = "publish-sdk.yml";
const availabilityTimeoutMs = 20 * 60 * 1000;
const availabilityPollIntervalMs = 5 * 1000;
const tagArguments = process.argv.slice(2);
const bootstrapPackageNames = new Set(
  locallyBootstrapableSdkPackageNames,
);
const npmEnvironment = {
  ...process.env,
  // Local npm publishes cannot create CI provenance. The normal GitHub
  // trusted-publishing workflow generates provenance on later releases.
  NPM_CONFIG_PROVENANCE: "false",
};

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
    env: npmEnvironment,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
};

const output = (command, args) => {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
};

const runChecked = (command, args) => {
  const result = run(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
};

const isNotFound = (result) =>
  `${result.stdout}\n${result.stderr}`.includes("E404");

const npmView = (specifier) =>
  run("npm", [
    "view",
    specifier,
    "version",
    "--json",
    "--registry",
    publicRegistry,
  ]);

const npmDistTagVersions = (packageName) => {
  const result = run("npm", [
    "dist-tag",
    "ls",
    packageName,
    "--registry",
    publicRegistry,
  ]);
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

const readTrustedPublishers = (packageName) => {
  const result = run("npm", [
    "trust",
    "list",
    packageName,
    "--json",
    "--registry",
    publicRegistry,
  ]);
  if (result.status !== 0) {
    throw new Error(
      `Unable to read trusted publishers for ${packageName}:\n` +
        `${result.stderr || result.stdout}`,
    );
  }
  if (!result.stdout.trim()) {
    return [];
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
};

const isExpectedTrustedPublisher = (publisher) =>
  publisher.type === "github" &&
  publisher.repository === trustedPublisherRepository &&
  publisher.file === trustedPublisherWorkflow &&
  publisher.environment === undefined &&
  Array.isArray(publisher.permissions) &&
  publisher.permissions.includes("createPackage");

const waitForNpmAvailability = async (manifests) => {
  if (manifests.length === 0) {
    return;
  }
  const deadline = Date.now() + availabilityTimeoutMs;
  let nextProgressMessageAt = 0;

  while (true) {
    const pending = [];
    for (const manifest of manifests) {
      const published = npmView(`${manifest.name}@${manifest.version}`);
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
          "Check npm for a security-review notice, then rerun this command.",
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

let stagingDirectory;

try {
  if (tagArguments.length !== 1 || !/^v\d+\.\d+\.\d+$/.test(tagArguments[0])) {
    throw new Error(
      "Pass exactly one stable release tag, for example: " +
        "`pnpm sdk:bootstrap v0.2.1`.",
    );
  }

  const releaseTag = tagArguments[0];
  const requestedVersion = releaseTag.slice(1);
  const workingTreeStatus = output("git", ["status", "--short"]);
  if (workingTreeStatus) {
    throw new Error(
      `The working tree must be clean before bootstrapping npm:\n${workingTreeStatus}`,
    );
  }

  const headCommit = output("git", ["rev-parse", "HEAD"]);
  const taggedCommit = output("git", [
    "rev-parse",
    `${releaseTag}^{commit}`,
  ]);
  if (headCommit !== taggedCommit) {
    throw new Error(`HEAD must be the commit tagged ${releaseTag}.`);
  }

  const manifests = await Promise.all(
    sdkPackageFiles.map(async (file) =>
      JSON.parse(await fs.readFile(path.join(rootDirectory, file), "utf8")),
    ),
  );
  const versions = new Set(manifests.map((manifest) => manifest.version));
  if (versions.size !== 1 || !versions.has(requestedVersion)) {
    throw new Error(
      `${releaseTag} does not match all SDK package versions: ` +
        `${[...versions].join(", ")}.`,
    );
  }

  runChecked("pnpm", ["release:verify", releaseTag]);

  const packagesToPublish = [];
  const acceptedBootstrapPackages = [];
  const packagesToConfigureTrust = manifests.filter((manifest) =>
    bootstrapPackageNames.has(manifest.name),
  );
  for (const manifest of manifests) {
    const exactVersion = npmView(`${manifest.name}@${manifest.version}`);
    if (exactVersion.status === 0) {
      if (bootstrapPackageNames.has(manifest.name)) {
        console.log(
          `Skipping ${manifest.name}@${manifest.version}; it is already published.`,
        );
      }
      continue;
    }
    if (!isNotFound(exactVersion)) {
      throw new Error(
        `Unable to check ${manifest.name}@${manifest.version} on npm:\n` +
          `${exactVersion.stderr || exactVersion.stdout}`,
      );
    }

    if (npmDistTagVersions(manifest.name).has(manifest.version)) {
      if (bootstrapPackageNames.has(manifest.name)) {
        console.log(
          `Skipping ${manifest.name}@${manifest.version}; npm accepted it and is scanning it.`,
        );
        acceptedBootstrapPackages.push(manifest);
      }
      continue;
    }

    const packageName = npmView(manifest.name);
    if (packageName.status === 0) {
      // Existing package names must use trusted publishing for new versions.
      continue;
    }
    if (!isNotFound(packageName)) {
      throw new Error(
        `Unable to check ${manifest.name} on npm:\n` +
          `${packageName.stderr || packageName.stdout}`,
      );
    }
    if (!bootstrapPackageNames.has(manifest.name)) {
      throw new Error(
        `${manifest.name} has never been published and is not approved for local bootstrap.`,
      );
    }
    packagesToPublish.push(manifest);
  }

  const npmVersion = output("npm", ["--version"]);
  const [npmMajor, npmMinor] = npmVersion.split(".").map(Number);
  if (
    !Number.isSafeInteger(npmMajor) ||
    !Number.isSafeInteger(npmMinor) ||
    npmMajor < 11 ||
    (npmMajor === 11 && npmMinor < 15)
  ) {
    throw new Error(
      `npm 11.15 or newer is required to configure trusted publishing; found ${npmVersion}. ` +
        "Run `npm install --global npm@11`, then retry.",
    );
  }

  const npmIdentity = run("npm", [
    "whoami",
    "--registry",
    publicRegistry,
  ]);
  if (npmIdentity.status !== 0) {
    throw new Error(
      "npm is not authenticated. Run `npm login --auth-type=web --registry " +
        "https://registry.npmjs.org`, complete the browser and 2FA prompts, " +
        "then retry.",
    );
  }
  console.log(`Authenticated to npm as ${npmIdentity.stdout.trim()}.`);

  stagingDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "response-js-bootstrap-"),
  );

  for (const manifest of packagesToPublish) {
    const packageDirectory = await fs.mkdtemp(
      path.join(stagingDirectory, "package-"),
    );
    runChecked("pnpm", [
      "--filter",
      manifest.name,
      "pack",
      "--pack-destination",
      packageDirectory,
    ]);

    const archives = (await fs.readdir(packageDirectory)).filter((file) =>
      file.endsWith(".tgz"),
    );
    if (archives.length !== 1) {
      throw new Error(
        `Expected one tarball for ${manifest.name}; found ${archives.length}.`,
      );
    }

    runChecked("npm", [
      "publish",
      path.join(packageDirectory, archives[0]),
      "--access",
      "public",
      "--registry",
      publicRegistry,
    ]);

    const publishedVersion = npmView(`${manifest.name}@${manifest.version}`);
    const awaitingAvailability =
      isNotFound(publishedVersion) &&
      npmDistTagVersions(manifest.name).has(manifest.version);
    if (publishedVersion.status !== 0 && !awaitingAvailability) {
      throw new Error(
        `npm did not confirm ${manifest.name}@${manifest.version} after publishing:\n` +
          `${publishedVersion.stderr || publishedVersion.stdout}`,
      );
    }
    console.log(
      `Bootstrapped ${manifest.name}@${manifest.version} on npm` +
        `${awaitingAvailability ? "; npm is scanning it before public availability" : ""}.`,
    );
    if (awaitingAvailability) {
      acceptedBootstrapPackages.push(manifest);
    }
  }

  if (packagesToPublish.length === 0) {
    console.log("No SDK packages need a first-publication bootstrap.");
  }

  for (const manifest of packagesToConfigureTrust) {
    const publishers = readTrustedPublishers(manifest.name);
    if (publishers.some(isExpectedTrustedPublisher)) {
      console.log(
        `${manifest.name} already trusts ${trustedPublisherWorkflow}.`,
      );
      continue;
    }
    if (publishers.length > 0) {
      throw new Error(
        `${manifest.name} already has a different trusted publisher. Review it on npm before replacing it.`,
      );
    }

    runChecked("npm", [
      "trust",
      "github",
      manifest.name,
      "--repo",
      trustedPublisherRepository,
      "--file",
      trustedPublisherWorkflow,
      "--allow-publish",
      "--yes",
      "--registry",
      publicRegistry,
    ]);

    const configuredPublishers = readTrustedPublishers(manifest.name);
    if (!configuredPublishers.some(isExpectedTrustedPublisher)) {
      throw new Error(
        `npm did not confirm the trusted publisher for ${manifest.name}.`,
      );
    }
    console.log(
      `Configured ${trustedPublisherWorkflow} as the trusted publisher for ${manifest.name}.`,
    );
  }

  await waitForNpmAvailability(acceptedBootstrapPackages);

  const postPublishStatus = output("git", ["status", "--short"]);
  if (postPublishStatus) {
    throw new Error(
      `The working tree changed while bootstrapping npm:\n${postPublishStatus}`,
    );
  }
} catch (error) {
  console.error("\nSDK package bootstrap stopped\n");
  console.error(error instanceof Error ? error.message : String(error));
  console.error();
  process.exitCode = 1;
} finally {
  if (stagingDirectory) {
    await fs.rm(stagingDirectory, { force: true, recursive: true });
  }
}
