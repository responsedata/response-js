import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  SDK_VERSION,
  trackServerRequest,
} from "../dist/index.js";

const TOKEN = "rsp_server_0123456789abcdefghijklmnopqrstuv";
const serverPackage = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const captureDelivery = async ({
  collectorEndpoint = "https://collector.example/api/requests",
  enabled,
  request = new Request("https://docs.example.com/guides/install"),
  source = "nextjs",
  token = TOKEN,
} = {}) => {
  const deliveries = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    deliveries.push({ init, url: url.toString() });
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  try {
    const delivery = trackServerRequest({
      collectorEndpoint,
      enabled,
      request,
      source,
      token,
    });
    if (delivery) {
      await delivery;
    }
    return { deliveries, delivery };
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("loads through the published package entry", async () => {
  const sdk = await import("@responsedata/server");

  assert.equal(typeof sdk.trackServerRequest, "function");
  assert.equal(sdk.SDK_VERSION, serverPackage.version);
  assert.equal(SDK_VERSION, serverPackage.version);
});

test("sends a privacy-limited server request observation", async () => {
  const request = new Request(
    "https://docs.example.com/guides/install?apiKey=private#section",
    {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        authorization: "Bearer private",
        cookie: "session=private",
        referer: "https://search.example/results?q=private",
        "sec-ch-ua": '"Chromium";v="140"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
        "user-agent": "ExampleBot/1.0",
        "x-private-header": "private",
      },
    },
  );

  const { deliveries, delivery } = await captureDelivery({ request });

  assert.equal(delivery instanceof Promise, true);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].url, "https://collector.example/api/requests");
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
  assert.equal(payload.sdkVersion, serverPackage.version);
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
  assert.equal(JSON.stringify(payload).includes("authorization"), false);
});

test("uses RESPONSE_SERVER_ID when no token option is supplied", async () => {
  const previousServerId = process.env.RESPONSE_SERVER_ID;
  process.env.RESPONSE_SERVER_ID = TOKEN;
  const deliveries = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => {
    deliveries.push(init);
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  try {
    const delivery = trackServerRequest({
      collectorEndpoint: "https://collector.example/api/requests",
      request: new Request("https://docs.example.com/pricing"),
      source: "nextjs",
    });
    await delivery;

    assert.equal(deliveries[0].headers.Authorization, `Bearer ${TOKEN}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousServerId === undefined) {
      delete process.env.RESPONSE_SERVER_ID;
    } else {
      process.env.RESPONSE_SERVER_ID = previousServerId;
    }
  }
});

test("rejects unsafe configuration and invalid requests", async () => {
  const cases = [
    { enabled: false },
    { token: " " },
    { token: "invalid" },
    { source: "Next.js" },
    { source: "" },
    { request: new Request("https://docs.example.com/action", { method: "POST" }) },
    { request: { headers: new Headers(), method: "GET", url: "not a url" } },
    { request: { headers: new Headers(), method: "GET", url: "ftp://docs.example.com/file" } },
    { request: new Request(`https://docs.example.com/${"a".repeat(513)}`) },
    { request: new Request("https://docs.example.com//invalid-path") },
    { collectorEndpoint: "http://collector.example/api/requests" },
    { collectorEndpoint: "https://user:pass@collector.example/api/requests" },
    { collectorEndpoint: "https://collector.example/api/requests?secret=yes" },
    { collectorEndpoint: "https://collector.example/api/requests#fragment" },
    {
      collectorEndpoint: "https://docs.example.com/api/requests",
      request: new Request("https://docs.example.com/api/requests"),
    },
  ];

  for (const options of cases) {
    const { deliveries, delivery } = await captureDelivery(options);
    assert.equal(delivery, null, JSON.stringify(options));
    assert.equal(deliveries.length, 0, JSON.stringify(options));
  }
});

test("allows loopback HTTP collectors", async () => {
  for (const collectorEndpoint of [
    "http://localhost:3000/api/requests",
    "http://127.0.0.1:3000/api/requests",
    "http://[::1]:3000/api/requests",
  ]) {
    const { deliveries } = await captureDelivery({ collectorEndpoint });
    assert.equal(deliveries.length, 1, collectorEndpoint);
  }
});

test("bounds text evidence and discards invalid referrers", async () => {
  const values = new Map([
    ["accept-language", "a".repeat(300)],
    ["referer", "not a URL"],
    ["user-agent", `Bot\0\ud800ok\udc00😀`],
  ]);
  const request = {
    headers: {
      get(name) {
        return values.get(name) ?? null;
      },
    },
    method: "HEAD",
    url: "https://DOCS.example.com/robots.txt?private=yes",
  };

  const { deliveries } = await captureDelivery({ request });
  const payload = JSON.parse(deliveries[0].init.body);

  assert.equal(payload.host, "docs.example.com");
  assert.equal(payload.method, "HEAD");
  assert.equal(payload.path, "/robots.txt");
  assert.equal(payload.referrerOrigin, null);
  assert.equal(payload.headers.acceptLanguage, "a".repeat(256));
  assert.equal(payload.userAgent, "Botok😀");
});

test("creates valid request IDs without global Web Crypto", async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "crypto",
  );

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    const { deliveries } = await captureDelivery();
    const payload = JSON.parse(deliveries[0].init.body);

    assert.match(
      payload.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  } finally {
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});

test("always fails open when delivery is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error("collector unavailable"));
    };
    const rejectedDelivery = trackServerRequest({
      request: new Request("https://docs.example.com/pricing"),
      source: "nextjs",
      token: TOKEN,
    });
    await assert.doesNotReject(rejectedDelivery);

    globalThis.fetch = () => {
      fetchCalls += 1;
      throw new Error("fetch failed synchronously");
    };
    assert.doesNotThrow(() => {
      assert.equal(
        trackServerRequest({
          request: new Request("https://docs.example.com/pricing"),
          source: "nextjs",
          token: TOKEN,
        }),
        null,
      );
    });
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
