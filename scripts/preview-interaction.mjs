#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const previewPath = path.join(
  rootDirectory,
  "examples/interaction-preview.html",
);
const browserEntryPath = path.join(
  rootDirectory,
  "packages/browser/src/index.ts",
);
const browserPackage = JSON.parse(
  await fs.readFile(
    path.join(rootDirectory, "packages/browser/package.json"),
    "utf8",
  ),
);
const port = Number(process.env.RESPONSE_PREVIEW_PORT ?? 4173);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("RESPONSE_PREVIEW_PORT must be a valid TCP port.");
}

const send = (
  response,
  status,
  body,
  contentType = "text/plain; charset=utf-8",
) => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
};

const buildBrowserPreview = async () => {
  const result = await build({
    bundle: true,
    define: {
      __RESPONSE_SDK_VERSION__: JSON.stringify(browserPackage.version),
    },
    entryPoints: [browserEntryPath],
    format: "esm",
    legalComments: "none",
    platform: "browser",
    sourcemap: "inline",
    target: "es2020",
    write: false,
  });

  return result.outputFiles[0].contents;
};

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  try {
    if (pathname === "/" || pathname === "/interaction-preview.html") {
      send(
        response,
        200,
        await fs.readFile(previewPath),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (pathname === "/browser.js") {
      send(
        response,
        200,
        await buildBrowserPreview(),
        "text/javascript; charset=utf-8",
      );
      return;
    }

    send(response, 404, "Not found.");
  } catch (error) {
    console.error(error);
    send(response, 500, "Unable to build the interaction preview.");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Set RESPONSE_PREVIEW_PORT to use another port.`,
    );
    process.exitCode = 1;
    return;
  }

  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Response interaction preview: http://127.0.0.1:${port}`);
  console.log("Edit packages/browser/src/index.ts and reload to see changes.");
});
