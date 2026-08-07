import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createResponseProxy } from "../dist/server.js";

const TOKEN = "rsp_server_0123456789abcdefghijklmnopqrstuv";
const serverPackage = JSON.parse(
  fs.readFileSync(
    new URL("../../server/package.json", import.meta.url),
    "utf8",
  ),
);

test("loads through the published server subpath", async () => {
  const sdk = await import("@responsedata/nextjs/server");

  assert.equal(typeof sdk.createResponseProxy, "function");
});

const captureDelivery = async ({
  collectorEndpoint = "https://collector.example/api/requests",
  enabled,
  request = new Request("https://docs.example.com/guides/install"),
  token = TOKEN,
} = {}) => {
  const deliveries = [];
  const pending = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    deliveries.push({ init, url: url.toString() });
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  try {
    const proxy = createResponseProxy({ collectorEndpoint, enabled, token });
    const result = proxy(request, {
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    await Promise.all(pending);
    return { deliveries, pending, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("delegates one normalized observation to the server core", async () => {
  const request = new Request(
    "https://docs.example.com/guides/install?apiKey=private#section",
    {
      headers: {
        cookie: "session=private",
        referer: "https://search.example/results?q=private",
        "user-agent": "ExampleBot/1.0",
      },
    },
  );

  const { deliveries, pending, result } = await captureDelivery({ request });

  assert.equal(result, undefined);
  assert.equal(pending.length, 1);
  assert.equal(deliveries.length, 1);
  const payload = JSON.parse(deliveries[0].init.body);
  assert.equal(payload.path, "/guides/install");
  assert.equal(payload.referrerOrigin, "https://search.example");
  assert.equal(payload.sdkVersion, serverPackage.version);
  assert.equal(payload.source, "nextjs");
  assert.equal(JSON.stringify(payload).includes("private"), false);
});

test("ignores non-page requests and internal Next.js traffic", async () => {
  const ignoredRequests = [
    new Request("https://docs.example.com/api/action", { method: "POST" }),
    new Request("https://docs.example.com/_next/static/chunk.js"),
    new Request("https://docs.example.com/_next/image?url=%2Fhero.png"),
    new Request("https://docs.example.com/_next/data/build-id/pricing.json"),
    new Request("https://docs.example.com/images/hero.svg"),
    new Request("https://docs.example.com//invalid-path"),
    new Request("https://docs.example.com/pricing", {
      headers: { "next-router-prefetch": "1" },
    }),
    new Request("https://docs.example.com/pricing", {
      headers: { "x-middleware-prefetch": "1" },
    }),
    new Request("https://docs.example.com/pricing", {
      headers: { rsc: "1" },
    }),
    new Request("https://docs.example.com/pricing", {
      headers: { "x-nextjs-data": "1" },
    }),
    new Request("https://docs.example.com/pricing", {
      headers: { purpose: "prefetch" },
    }),
    new Request("https://docs.example.com/pricing", {
      headers: { "sec-purpose": "prefetch;prerender" },
    }),
    new Request("https://docs.example.com/site.webmanifest"),
  ];

  for (const request of ignoredRequests) {
    const { deliveries, pending } = await captureDelivery({ request });
    assert.equal(deliveries.length, 0, request.url);
    assert.equal(pending.length, 0, request.url);
  }
});

test("keeps GET APIs and text discovery files visible", async () => {
  for (const path of [
    "/api/public-data",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
  ]) {
    const { deliveries, pending } = await captureDelivery({
      request: new Request(`https://docs.example.com${path}`, {
        method: "HEAD",
      }),
    });
    assert.equal(deliveries.length, 1, path);
    assert.equal(pending.length, 1, path);
    assert.equal(JSON.parse(deliveries[0].init.body).path, path);
  }
});

test("does not schedule delivery when collection is disabled", async () => {
  const { deliveries, pending } = await captureDelivery({ enabled: false });

  assert.equal(deliveries.length, 0);
  assert.equal(pending.length, 0);
});
