import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("builds a passive page-view component with the expected public export", () => {
  const source = fs.readFileSync(
    new URL("../dist/index.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /^"use client";/);
  assert.match(source, /from "next\/navigation\.js"/);
  assert.match(source, /usePathname\(\)/);
  assert.match(
    source,
    /trackPageView\(\{ clientId, collectorEndpoint, path: pathname \}\)/,
  );
  assert.match(source, /export\s*\{\s*ResponseAnalytics\s*\}/);
});

test("loads from Node without requiring package transpilation", async () => {
  const sdk = await import("../dist/index.js");

  assert.equal(typeof sdk.ResponseAnalytics, "function");
});

test("keeps the client and server entries isolated", () => {
  const clientSource = fs.readFileSync(
    new URL("../dist/index.js", import.meta.url),
    "utf8",
  );
  const serverSource = fs.readFileSync(
    new URL("../dist/server.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(clientSource, /RESPONSE_TOKEN|createResponseProxy/);
  assert.doesNotMatch(serverSource, /@responsedata\/browser|use client/);
  assert.match(serverSource, /from "@responsedata\/server"/);
  assert.match(serverSource, /createResponseProxy/);
  assert.doesNotMatch(
    serverSource,
    /api\/requests|Authorization|acceptLanguage|rsp_server_|\bfetch\(/,
  );
});
