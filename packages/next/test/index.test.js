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
