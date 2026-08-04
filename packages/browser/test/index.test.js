import assert from "node:assert/strict";
import test from "node:test";
import { trackPageView } from "../dist/index.js";

const CLIENT_ID = "rsp_0123456789abcdefghijklmnopqrstuv";

const installBrowserGlobals = ({
  doNotTrack = null,
  globalPrivacyControl = false,
  legacyDoNotTrack = null,
  pathname = "/pricing",
  referrer = "https://search.example/results?q=private",
  webdriver = true,
} = {}) => {
  const requests = [];
  const originalDescriptors = new Map();
  const values = {
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(1);
        return bytes;
      },
      randomUUID() {
        return "39bb0340-379f-46ee-af2d-591d722f4798";
      },
    },
    document: { referrer },
    doNotTrack: legacyDoNotTrack,
    fetch(url, init) {
      requests.push({ init, url });
      return Promise.resolve({ ok: true });
    },
    location: { pathname },
    navigator: {
      doNotTrack,
      globalPrivacyControl,
      webdriver,
    },
  };

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

test("queues a minimal page observation with the default collector", () => {
  const browser = installBrowserGlobals();

  try {
    assert.equal(trackPageView({ clientId: CLIENT_ID }), true);
    assert.equal(browser.requests.length, 1);
    assert.equal(
      browser.requests[0].url,
      "https://www.response.sh/api/events",
    );

    const payload = JSON.parse(browser.requests[0].init.body);
    assert.equal(payload.clientId, CLIENT_ID);
    assert.equal(payload.path, "/pricing");
    assert.equal(payload.referrerOrigin, "https://search.example");
    assert.equal(payload.signals.webdriver, true);
    assert.equal(payload.sdkVersion, "0.1.0");
    assert.equal(
      JSON.stringify(payload).includes("private"),
      false,
    );
  } finally {
    browser.restore();
  }
});

test("normalizes a supplied SPA path and suppresses an immediate duplicate", () => {
  const browser = installBrowserGlobals({ pathname: "/initial" });

  try {
    const options = {
      clientId: "rsp_1123456789abcdefghijklmnopqrstuv",
      path: "/docs/start?private=yes#section",
    };
    assert.equal(trackPageView(options), true);
    assert.equal(trackPageView(options), false);
    assert.equal(browser.requests.length, 1);
    assert.equal(
      JSON.parse(browser.requests[0].init.body).path,
      "/docs/start",
    );
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
  } finally {
    browser.restore();
  }
});

test("honors legacy Do Not Track and rejects insecure remote endpoints", () => {
  const browser = installBrowserGlobals({ legacyDoNotTrack: "1" });

  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_2123456789abcdefghijklmnopqrstuv",
      }),
      false,
    );
    assert.equal(browser.requests.length, 0);
  } finally {
    browser.restore();
  }

  const secondBrowser = installBrowserGlobals();
  try {
    assert.equal(
      trackPageView({
        clientId: "rsp_3123456789abcdefghijklmnopqrstuv",
        endpoint: "http://collector.example/events",
      }),
      false,
    );
    assert.equal(secondBrowser.requests.length, 0);
  } finally {
    secondBrowser.restore();
  }
});
