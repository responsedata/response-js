import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("builds a client component with the expected public export", () => {
  const source = fs.readFileSync(
    new URL("../dist/index.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /^"use client";/);
  assert.match(source, /usePathname\(\)/);
  assert.match(source, /trackPageView\(\{ clientId, endpoint, path: pathname \}\)/);
  assert.match(source, /export\s*\{\s*ResponseAnalytics\s*\}/);
});
