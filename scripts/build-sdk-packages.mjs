#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const target = process.argv[2];

const readPackageVersion = async (packageDirectory) => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"),
  );
  return packageJson.version;
};

const resetGeneratedDirectory = async (directory) => {
  await fs.rm(directory, { force: true, recursive: true });
  await fs.mkdir(directory, { recursive: true });
};

const buildBrowserPackage = async () => {
  const packageDirectory = path.join(rootDirectory, "packages/browser");
  const version = await readPackageVersion(packageDirectory);
  const outputDirectory = path.join(packageDirectory, "dist");
  await resetGeneratedDirectory(outputDirectory);

  await build({
    bundle: true,
    define: {
      __RESPONSE_SDK_VERSION__: JSON.stringify(version),
    },
    entryNames: "index",
    entryPoints: [path.join(packageDirectory, "src/index.ts")],
    format: "esm",
    legalComments: "none",
    outdir: outputDirectory,
    platform: "browser",
    target: "es2020",
  });
};

const buildServerPackage = async () => {
  const packageDirectory = path.join(rootDirectory, "packages/server");
  const version = await readPackageVersion(packageDirectory);
  const outputDirectory = path.join(packageDirectory, "dist");
  await resetGeneratedDirectory(outputDirectory);

  await build({
    bundle: true,
    define: {
      __RESPONSE_SERVER_SDK_VERSION__: JSON.stringify(version),
    },
    entryNames: "index",
    entryPoints: [path.join(packageDirectory, "src/index.ts")],
    format: "esm",
    legalComments: "none",
    outdir: outputDirectory,
    platform: "neutral",
    target: "es2020",
  });
};

const buildNextPackage = async () => {
  const packageDirectory = path.join(rootDirectory, "packages/next");
  const outputDirectory = path.join(packageDirectory, "dist");
  await resetGeneratedDirectory(outputDirectory);

  await build({
    bundle: false,
    entryNames: "index",
    entryPoints: [path.join(packageDirectory, "src/index.tsx")],
    format: "esm",
    jsx: "automatic",
    legalComments: "none",
    outdir: outputDirectory,
    platform: "browser",
    target: "es2020",
  });

  await build({
    bundle: false,
    entryNames: "server",
    entryPoints: [path.join(packageDirectory, "src/server.ts")],
    format: "esm",
    legalComments: "none",
    outdir: outputDirectory,
    platform: "neutral",
    target: "es2020",
  });
};

const buildCdnPackage = async () => {
  const browserDirectory = path.join(rootDirectory, "packages/browser");
  const cdnDirectory = path.join(rootDirectory, "apps/cdn");
  const version = await readPackageVersion(browserDirectory);
  const stableAsset = path.join(cdnDirectory, "dist/browser.js");

  await resetGeneratedDirectory(path.join(cdnDirectory, "dist"));
  await build({
    bundle: true,
    define: {
      __RESPONSE_SDK_VERSION__: JSON.stringify(version),
    },
    entryPoints: [path.join(cdnDirectory, "src/index.ts")],
    format: "iife",
    legalComments: "none",
    minify: true,
    outfile: stableAsset,
    platform: "browser",
    target: "es2020",
  });
};

if (target === "browser") {
  await buildBrowserPackage();
} else if (target === "server") {
  await buildServerPackage();
} else if (target === "next") {
  await buildNextPackage();
} else if (target === "cdn") {
  await buildCdnPackage();
} else {
  throw new Error("Expected build target: browser, server, next, or cdn.");
}
