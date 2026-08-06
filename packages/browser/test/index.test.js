import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { trackPageView } from "../dist/index.js";

const CLIENT_ID = "rsp_0123456789abcdefghijklmnopqrstuv";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_EVENT_ID = "33333333-3333-4333-8333-333333333333";
const browserPackage = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const installBrowserGlobals = ({
  automationArtifact = false,
  doNotTrack = null,
  fetchResponse,
  globalPrivacyControl = false,
  legacyDoNotTrack = null,
  pathname = "/pricing",
  referrer = "https://search.example/results?q=private",
  sessionEntries = [],
  storageThrows = false,
  uuids = [SESSION_ID, EVENT_ID, NEXT_EVENT_ID],
  webdriver = true,
  webdriverThrows = false,
} = {}) => {
  const requests = [];
  const storage = new Map(sessionEntries);
  const originalDescriptors = new Map();
  let storageReads = 0;
  let storageWrites = 0;
  let uuidCalls = 0;
  const values = {
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(1);
        return bytes;
      },
      randomUUID() {
        const uuid = uuids[uuidCalls] ?? uuids.at(-1);
        uuidCalls += 1;
        return uuid;
      },
    },
    document: {
      documentElement: { attributes: [] },
      referrer,
    },
    doNotTrack: legacyDoNotTrack,
    fetch(url, init) {
      requests.push({ init, url });
      return Promise.resolve(
        fetchResponse?.(url, init) ?? { ok: true, status: 204 },
      );
    },
    location: { pathname },
    navigator: {
      doNotTrack,
      globalPrivacyControl,
      webdriver,
    },
    sessionStorage: {
      getItem(key) {
        storageReads += 1;
        if (storageThrows) {
          throw new Error("storage unavailable");
        }
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storageWrites += 1;
        if (storageThrows) {
          throw new Error("storage unavailable");
        }
        storage.set(key, value);
      },
    },
  };
  if (automationArtifact) {
    values.__playwright__binding__ = () => undefined;
  }
  if (webdriverThrows) {
    Object.defineProperty(values.navigator, "webdriver", {
      get() {
        throw new Error("webdriver unavailable");
      },
    });
  }

  for (const [key, value] of Object.entries(values)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  return {
    requests,
    storage,
    get storageReads() {
      return storageReads;
    },
    get storageWrites() {
      return storageWrites;
    },
    get uuidCalls() {
      return uuidCalls;
    },
    restore() {
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          delete globalThis[key];
        }
      }
    },
  };
};

test("queues a minimal page observation with a tab-scoped session", () => {
  const browser = installBrowserGlobals();

  try {
    assert.equal(trackPageView({ clientId: CLIENT_ID }), true);
    assert.equal(browser.requests.length, 1);
    assert.equal(
      browser.requests[0].url,
      "https://www.response.sh/api/events",
    );

    const payload = JSON.parse(browser.requests[0].init.body);
    assert.deepEqual(Object.keys(payload).sort(), [
      "clientId",
      "eventId",
      "path",
      "referrerOrigin",
      "sdkVersion",
      "sessionId",
      "signals",
    ]);
    assert.equal(payload.clientId, CLIENT_ID);
    assert.equal(payload.eventId, EVENT_ID);
    assert.equal(payload.sessionId, SESSION_ID);
    assert.equal(payload.path, "/pricing");
    assert.equal(payload.referrerOrigin, "https://search.example");
    assert.deepEqual(payload.signals, {
      automationArtifactsDetected: false,
      webdriver: true,
    });
    assert.equal(payload.sdkVersion, browserPackage.version);
    assert.equal(JSON.stringify(payload).includes("private"), false);
    assert.equal(
      browser.storage.get(`response:session:${CLIENT_ID}`),
      SESSION_ID,
    );
  } finally {
    browser.restore();
  }
});

test("reuses one session across page views and keeps event IDs unique", () => {
  const clientId = "rsp_1123456789abcdefghijklmnopqrstuv";
  const browser = installBrowserGlobals({ pathname: "/initial" });

  try {
    assert.equal(trackPageView({ clientId, path: "/first" }), true);
    assert.equal(trackPageView({ clientId, path: "/second" }), true);

    const first = JSON.parse(browser.requests[0].init.body);
    const second = JSON.parse(browser.requests[1].init.body);
    assert.equal(first.sessionId, SESSION_ID);
    assert.equal(second.sessionId, SESSION_ID);
    assert.equal(first.eventId, EVENT_ID);
    assert.equal(second.eventId, NEXT_EVENT_ID);
    assert.equal(browser.storageWrites, 1);
  } finally {
    browser.restore();
  }
});

test("uses an existing valid session ID", () => {
  const clientId = "rsp_2123456789abcdefghijklmnopqrstuv";
  const storedSessionId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const browser = installBrowserGlobals({
    sessionEntries: [[`response:session:${clientId}`, storedSessionId]],
    uuids: [EVENT_ID],
  });

  try {
    assert.equal(trackPageView({ clientId }), true);
    const payload = JSON.parse(browser.requests[0].init.body);
    assert.equal(payload.sessionId, storedSessionId.toLowerCase());
    assert.equal(payload.eventId, EVENT_ID);
    assert.equal(browser.storageWrites, 0);
    assert.equal(browser.uuidCalls, 1);
  } finally {
    browser.restore();
  }
});

test("falls back to memory when session storage is unavailable", () => {
  const clientId = "rsp_3123456789abcdefghijklmnopqrstuv";
  const browser = installBrowserGlobals({ storageThrows: true });

  try {
    assert.equal(trackPageView({ clientId, path: "/first" }), true);
    assert.equal(trackPageView({ clientId, path: "/second" }), true);
    const first = JSON.parse(browser.requests[0].init.body);
    const second = JSON.parse(browser.requests[1].init.body);
    assert.equal(first.sessionId, SESSION_ID);
    assert.equal(second.sessionId, SESSION_ID);
  } finally {
    browser.restore();
  }
});

test("reports known automation artifacts", () => {
  const browser = installBrowserGlobals({
    automationArtifact: true,
    pathname: "/automation-artifact",
    webdriver: false,
  });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_4123456789abcdefghijklmnopqrstuv",
      }),
      true,
    );
    const payload = JSON.parse(browser.requests[0].init.body);
    assert.deepEqual(payload.signals, {
      automationArtifactsDetected: true,
      webdriver: false,
    });
  } finally {
    browser.restore();
  }
});

test("still sends when the webdriver signal cannot be read", () => {
  const browser = installBrowserGlobals({
    pathname: "/unavailable-webdriver",
    webdriverThrows: true,
  });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_a123456789abcdefghijklmnopqrstuv",
      }),
      true,
    );
    const payload = JSON.parse(browser.requests[0].init.body);
    assert.deepEqual(payload.signals, {
      automationArtifactsDetected: false,
      webdriver: false,
    });
  } finally {
    browser.restore();
  }
});

test("ignores collector response bodies", async () => {
  let responseBodyReads = 0;
  const browser = installBrowserGlobals({
    fetchResponse: () => ({
      ok: true,
      status: 200,
      json() {
        responseBodyReads += 1;
        return Promise.resolve({ unexpected: "instructions" });
      },
    }),
  });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_9123456789abcdefghijklmnopqrstuv",
      }),
      true,
    );
    await Promise.resolve();
    assert.equal(responseBodyReads, 0);
    assert.equal(browser.requests.length, 1);
  } finally {
    browser.restore();
  }
});

test("allows an explicit loopback collector for local development", () => {
  const browser = installBrowserGlobals({ pathname: "/local-collector" });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_5123456789abcdefghijklmnopqrstuv",
        collectorEndpoint: "http://localhost:3000/api/events",
      }),
      true,
    );
    assert.equal(
      browser.requests[0].url,
      "http://localhost:3000/api/events",
    );
  } finally {
    browser.restore();
  }
});

test("rejects insecure remote collectors without creating a session", () => {
  const browser = installBrowserGlobals({ pathname: "/unsafe-collector" });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_6123456789abcdefghijklmnopqrstuv",
        collectorEndpoint: "http://collector.example/api/events",
      }),
      false,
    );
    assert.equal(browser.requests.length, 0);
    assert.equal(browser.storageReads, 0);
    assert.equal(browser.uuidCalls, 0);
  } finally {
    browser.restore();
  }
});

test("normalizes a supplied SPA path and suppresses an immediate duplicate", () => {
  const browser = installBrowserGlobals({ pathname: "/initial" });

  try {
    const options = {
      clientId: "rsp_7123456789abcdefghijklmnopqrstuv",
      path: "/docs/start?private=yes#section",
    };
    assert.equal(trackPageView(options), true);
    assert.equal(trackPageView(options), false);
    assert.equal(browser.requests.length, 1);
    assert.equal(JSON.parse(browser.requests[0].init.body).path, "/docs/start");
    assert.equal(browser.uuidCalls, 2);
  } finally {
    browser.restore();
  }
});

test("fails closed for invalid IDs and browser privacy signals", () => {
  const browser = installBrowserGlobals({ globalPrivacyControl: true });

  try {
    assert.equal(trackPageView({ clientId: CLIENT_ID }), false);
    assert.equal(trackPageView({ clientId: "invalid" }), false);
    assert.equal(browser.requests.length, 0);
    assert.equal(browser.storageReads, 0);
    assert.equal(browser.storageWrites, 0);
    assert.equal(browser.uuidCalls, 0);
  } finally {
    browser.restore();
  }
});

test("honors legacy Do Not Track without creating a session", () => {
  const browser = installBrowserGlobals({ legacyDoNotTrack: "1" });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_8123456789abcdefghijklmnopqrstuv",
      }),
      false,
    );
    assert.equal(browser.requests.length, 0);
    assert.equal(browser.storageReads, 0);
    assert.equal(browser.uuidCalls, 0);
  } finally {
    browser.restore();
  }
});
