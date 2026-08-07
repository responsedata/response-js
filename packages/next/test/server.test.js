import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createResponseProxy } from "../dist/server.js";

const TOKEN = "rsp_server_0123456789abcdefghijklmnopqrstuv";
const nextPackage = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("loads through the published server subpath", async () => {
  const sdk = await import("@responsedata/nextjs/server");

  assert.equal(typeof sdk.createResponseProxy, "function");
});

const captureDelivery = async ({
  collectorEndpoint = "https://collector.example/api/requests",
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
    const proxy = createResponseProxy({ collectorEndpoint, token });
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

test("schedules a privacy-limited server request observation", async () => {
  const request = new Request(
    "https://docs.example.com/guides/install?apiKey=private#section",
    {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        cookie: "session=private",
        referer: "https://search.example/results?q=private",
        "sec-ch-ua": '"Chromium";v="140"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
        "user-agent": "ExampleBot/1.0",
      },
    },
  );

  const { deliveries, pending, result } = await captureDelivery({ request });

  assert.equal(result, undefined);
  assert.equal(pending.length, 1);
  assert.equal(deliveries.length, 1);
  assert.equal(
    deliveries[0].url,
    "https://collector.example/api/requests",
  );
  assert.deepEqual(deliveries[0].init.headers, {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  });
  assert.equal(deliveries[0].init.method, "POST");
  assert.equal(deliveries[0].init.signal instanceof AbortSignal, true);

  const payload = JSON.parse(deliveries[0].init.body);
  assert.deepEqual(Object.keys(payload).sort(), [
    "headers",
    "host",
    "method",
    "path",
    "referrerOrigin",
    "requestAt",
    "requestId",
    "sdkVersion",
    "source",
    "userAgent",
  ]);
  assert.match(
    payload.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(Number.isNaN(Date.parse(payload.requestAt)), false);
  assert.equal(payload.host, "docs.example.com");
  assert.equal(payload.method, "GET");
  assert.equal(payload.path, "/guides/install");
  assert.equal(payload.referrerOrigin, "https://search.example");
  assert.equal(payload.sdkVersion, nextPackage.version);
  assert.equal(payload.source, "nextjs");
  assert.equal(payload.userAgent, "ExampleBot/1.0");
  assert.deepEqual(payload.headers, {
    acceptLanguage: "en-US,en;q=0.9",
    secChUa: '"Chromium";v="140"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    secFetchDest: "document",
    secFetchMode: "navigate",
    secFetchSite: "cross-site",
  });
  assert.equal(JSON.stringify(payload).includes("private"), false);
  assert.equal(JSON.stringify(payload).includes("cookie"), false);
});

test("uses RESPONSE_TOKEN when no token option is supplied", async () => {
  const previousToken = process.env.RESPONSE_TOKEN;
  process.env.RESPONSE_TOKEN = TOKEN;
  const deliveries = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => {
    deliveries.push(init);
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  try {
    let delivery;
    createResponseProxy({
      collectorEndpoint: "https://collector.example/api/requests",
    })(new Request("https://docs.example.com/pricing"), {
      waitUntil(promise) {
        delivery = promise;
      },
    });
    await delivery;

    assert.equal(deliveries[0].headers.Authorization, `Bearer ${TOKEN}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) {
      delete process.env.RESPONSE_TOKEN;
    } else {
      process.env.RESPONSE_TOKEN = previousToken;
    }
  }
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
      headers: { rsc: "1" },
    }),
    new Request("https://docs.example.com/pricing", {
      headers: { "x-nextjs-data": "1" },
    }),
    new Request("https://docs.example.com/site.webmanifest"),
    new Request("https://docs.example.com/api/requests"),
  ];

  for (const request of ignoredRequests) {
    const { deliveries, pending } = await captureDelivery({
      collectorEndpoint: "https://docs.example.com/api/requests",
      request,
    });
    assert.equal(deliveries.length, 0, request.url);
    assert.equal(pending.length, 0, request.url);
  }
});

test("keeps robots, sitemaps, and llms text visible", async () => {
  for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
    const { deliveries } = await captureDelivery({
      request: new Request(`https://docs.example.com${path}`, {
        method: "HEAD",
      }),
    });
    assert.equal(deliveries.length, 1, path);
    assert.equal(JSON.parse(deliveries[0].init.body).path, path);
  }
});

test("fails open when configuration or delivery is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("collector unavailable"));
  };

  try {
    let rejectedDelivery;
    assert.doesNotThrow(() => {
      createResponseProxy({ token: TOKEN })(
        new Request("https://docs.example.com/pricing"),
        {
          waitUntil(promise) {
            rejectedDelivery = promise;
          },
        },
      );
    });
    await assert.doesNotReject(rejectedDelivery);
    assert.equal(fetchCalls, 1);

    let scheduled = false;
    createResponseProxy({ token: " " })(
      new Request("https://docs.example.com/pricing"),
      {
        waitUntil() {
          scheduled = true;
        },
      },
    );
    assert.equal(scheduled, false);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
