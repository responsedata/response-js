#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const releaseType = process.argv[2] ?? "patch";
const allowedReleaseTypes = new Set(["major", "minor", "patch"]);
const versionFiles = [
  "packages/browser/package.json",
  "packages/next/package.json",
];
const releaseEnvironment = {
  ...process.env,
  EDITOR: "true",
  GIT_EDITOR: "true",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_PAGER: "cat",
  GIT_SEQUENCE_EDITOR: "true",
  PAGER: "cat",
  VISUAL: "true",
};

if (!allowedReleaseTypes.has(releaseType)) {
  console.error("\nRelease stopped\n");
  console.error(`Unknown release type: ${releaseType}`);
  console.error("Use: pnpm release [patch|minor|major]\n");
  process.exit(1);
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    env: releaseEnvironment,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
};

const runChecked = (command, args) => {
  const result = run(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
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

try {
  if (output("git", ["branch", "--show-current"]) !== "main") {
    throw new Error("Releases must be created from the main branch.");
  }

  const workingTreeStatus = output("git", ["status", "--short"]);
  if (workingTreeStatus) {
    throw new Error(
      [
        "Your working tree has uncommitted changes:",
        "",
        workingTreeStatus,
        "",
        "Commit or stash these changes, then run `pnpm release` again.",
      ].join("\n"),
    );
  }

  console.log("Checking origin/main...");
  runChecked("git", ["fetch", "origin", "main", "--tags"]);
  if (
    output("git", ["rev-parse", "HEAD"]) !==
    output("git", ["rev-parse", "origin/main"])
  ) {
    throw new Error(
      "Local main must exactly match origin/main. Pull or push your changes first.",
    );
  }

  const originalFiles = new Map(
    await Promise.all(
      versionFiles.map(async (file) => [
        file,
        await fs.readFile(path.join(rootDirectory, file), "utf8"),
      ]),
    ),
  );
  let releaseCommitted = false;
  let releaseTag = "";

  try {
    runChecked("pnpm", ["sdk:version", releaseType]);

    const manifest = JSON.parse(
      await fs.readFile(
        path.join(rootDirectory, "packages/browser/package.json"),
        "utf8",
      ),
    );
    releaseTag = `v${manifest.version}`;

    const localTag = run("git", [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/tags/${releaseTag}`,
    ]);
    if (localTag.status === 0) {
      throw new Error(`Tag ${releaseTag} already exists locally.`);
    }
    if (
      output("git", [
        "ls-remote",
        "--tags",
        "origin",
        `refs/tags/${releaseTag}`,
      ])
    ) {
      throw new Error(`Tag ${releaseTag} already exists on origin.`);
    }

    console.log(`Testing ${releaseTag}...`);
    runChecked("pnpm", ["test"]);
    runChecked("pnpm", ["cdn:upload:dry-run"]);

    const changedFiles = output("git", ["diff", "--name-only"])
      .split("\n")
      .filter(Boolean)
      .sort();
    if (
      JSON.stringify(changedFiles) !== JSON.stringify([...versionFiles].sort())
    ) {
      throw new Error(
        `Unexpected files changed during release preparation:\n${changedFiles.join("\n")}`,
      );
    }

    runChecked("git", ["--no-pager", "diff", "--check"]);
    runChecked("git", ["add", ...versionFiles]);

    // Create the release commit and tag through Git's non-interactive plumbing.
    // This cannot open an editor or signing prompt, regardless of user config.
    const parentCommit = output("git", ["rev-parse", "HEAD"]);
    const releaseTree = output("git", ["write-tree"]);
    const releaseCommit = output("git", [
      "commit-tree",
      releaseTree,
      "-p",
      parentCommit,
      "-m",
      `Release Response JS ${releaseTag}`,
    ]);
    runChecked("git", [
      "update-ref",
      "--create-reflog",
      "-m",
      `release: ${releaseTag}`,
      "refs/heads/main",
      releaseCommit,
      parentCommit,
    ]);
    releaseCommitted = true;
    runChecked("git", [
      "update-ref",
      "-m",
      `release: ${releaseTag}`,
      `refs/tags/${releaseTag}`,
      releaseCommit,
    ]);
    runChecked("git", ["push", "--atomic", "origin", "main", releaseTag]);

    console.log(`\n${releaseTag} was pushed successfully.`);
    console.log(
      "GitHub Actions is now publishing the npm packages and CDN assets:",
    );
    console.log("https://github.com/responsedata/response-js/actions");
  } catch (error) {
    if (!releaseCommitted) {
      run("git", [
        "restore",
        "--staged",
        "--source=HEAD",
        "--",
        ...versionFiles,
      ]);
      await Promise.all(
        [...originalFiles].map(([file, contents]) =>
          fs.writeFile(path.join(rootDirectory, file), contents),
        ),
      );
    } else {
      console.error(
        `The ${releaseTag} commit remains local. Fix the problem and push it instead of running another release.`,
      );
    }
    throw error;
  }
} catch (error) {
  console.error("\nRelease stopped\n");
  console.error(error instanceof Error ? error.message : String(error));
  console.error();
  process.exitCode = 1;
}
