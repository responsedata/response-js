import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { trackPageView } from "../dist/index.js";

const CLIENT_ID = "rsp_0123456789abcdefghijklmnopqrstuv";
const browserPackage = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const installBrowserGlobals = ({
  automationArtifact = false,
  fetchResponse,
  doNotTrack = null,
  globalPrivacyControl = false,
  legacyDoNotTrack = null,
  pathname = "/pricing",
  referrer = "https://search.example/results?q=private",
  webdriver = true,
} = {}) => {
  let consoleDebugCalls = 0;
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
    console: {
      debug() {
        consoleDebugCalls += 1;
      },
    },
    document: { referrer },
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
      userAgent:
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
      webdriver,
    },
  };
  if (automationArtifact) {
    values.__playwright__binding__ = () => undefined;
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
    get consoleDebugCalls() {
      return consoleDebugCalls;
    },
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
    assert.deepEqual(payload.capabilities, ["agent_check_in"]);
    assert.equal(payload.path, "/pricing");
    assert.equal(payload.referrerOrigin, "https://search.example");
    assert.equal(payload.signals.automationArtifactsDetected, false);
    assert.equal("cdpRuntimeDetected" in payload.signals, false);
    assert.equal(payload.signals.webdriver, true);
    assert.equal(browser.consoleDebugCalls, 0);
    assert.equal(payload.sdkVersion, browserPackage.version);
    assert.equal(
      JSON.stringify(payload).includes("private"),
      false,
    );
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
    assert.equal(trackPageView({ clientId: CLIENT_ID }), true);
    const payload = JSON.parse(browser.requests[0].init.body);
    assert.equal(payload.signals.automationArtifactsDetected, true);
  } finally {
    browser.restore();
  }
});

test("allows an explicit loopback collector for local development", () => {
  const browser = installBrowserGlobals({ pathname: "/local-collector" });

  try {
    assert.equal(
      trackPageView({
        clientId: CLIENT_ID,
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

test("rejects insecure remote collectors", () => {
  const browser = installBrowserGlobals({ pathname: "/unsafe-collector" });

  try {
    assert.equal(
      trackPageView({
        clientId: CLIENT_ID,
        collectorEndpoint: "http://collector.example/api/events",
      }),
      false,
    );
    assert.equal(browser.requests.length, 0);
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

test("honors legacy Do Not Track", () => {
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
});

class FakeElement {
  constructor(tagName) {
    this.attributes = {};
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.parent = null;
    this.style = {};
    this.tagName = tagName.toUpperCase();
    this.textContent = "";
    this.value = "";
    this.open = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  checkValidity() {
    return true;
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault() {} });
    }
  }

  focus() {}

  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
      this.parent = null;
    }
  }

  reportValidity() {}

  showModal() {
    this.open = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

const findElement = (element, predicate) => {
  if (predicate(element)) {
    return element;
  }

  for (const child of element.children) {
    const match = findElement(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
};

const waitForPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

test("renders a blocking pending gate before the collector responds", async () => {
  const body = new FakeElement("body");
  const page = new FakeElement("main");
  body.append(page);
  let resolveCollector;
  const collectorResponse = new Promise((resolve) => {
    resolveCollector = resolve;
  });
  const browser = installBrowserGlobals({
    fetchResponse: () => collectorResponse,
    pathname: "/pending-agent-check-in",
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      createElement: (tagName) => new FakeElement(tagName),
      referrer: "",
    },
    writable: true,
  });

  try {
    const clientId = "rsp_5123456789abcdefghijklmnopqrstuv";
    assert.equal(trackPageView({ clientId }), true);

    const gate = findElement(body, (element) => element.tagName === "DIALOG");
    assert.ok(gate);
    assert.equal(gate.open, true);
    assert.ok(
      findElement(
        gate,
        (element) => element.textContent === "Agent check-in required",
      ),
    );
    assert.ok(
      findElement(
        gate,
        (element) => element.textContent === "Preparing check-in…",
      ),
    );

    resolveCollector({ ok: true, status: 204 });
    await waitForPromises();
    assert.deepEqual(body.children, [page]);
  } finally {
    browser.restore();
  }
});

test("renders and submits an agent check-in, then suppresses it for the tab", async () => {
  const interactionId = "9f4b8da9-8fc4-4ceb-8124-9da1461b780e";
  const body = new FakeElement("body");
  const page = new FakeElement("main");
  body.append(page);
  const storage = new Map();
  const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const browser = installBrowserGlobals({
    fetchResponse(url) {
      return url.endsWith("/api/events")
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              interaction: { id: interactionId, type: "agent_check_in" },
            }),
          }
        : { ok: true, status: 204 };
    },
    pathname: "/agent-test",
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      createElement: (tagName) => new FakeElement(tagName),
      referrer: "",
    },
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    writable: true,
  });

  try {
    const clientId = "rsp_3123456789abcdefghijklmnopqrstuv";
    assert.equal(trackPageView({ clientId }), true);
    await waitForPromises();
    assert.equal(body.children.length, 2);

    const gate = findElement(body, (element) => element.tagName === "DIALOG");
    assert.ok(gate);
    assert.equal(gate.open, true);
    assert.equal(gate.attributes["aria-modal"], "true");
    assert.equal(gate.attributes.role, "dialog");

    const form = findElement(body, (element) => element.tagName === "FORM");
    const agentName = findElement(body, (element) => element.name === "agentName");
    const message = findElement(body, (element) => element.name === "message");
    assert.ok(form);
    assert.ok(agentName);
    assert.ok(message);
    agentName.value = "ChatGPT";
    message.value = "Researching font-generation tools for a user.";
    form.dispatch("submit");
    await waitForPromises();

    assert.equal(
      browser.requests[1].url,
      `https://www.response.sh/api/interactions/${interactionId}`,
    );
    assert.deepEqual(JSON.parse(browser.requests[1].init.body), {
      agentName: "ChatGPT",
      message: "Researching font-generation tools for a user.",
      resolution: "submitted",
    });
    assert.deepEqual(body.children, [page]);

    assert.equal(trackPageView({ clientId, path: "/another-page" }), true);
    const nextPayload = JSON.parse(browser.requests[2].init.body);
    assert.equal(nextPayload.capabilities, undefined);
  } finally {
    browser.restore();
    if (originalSessionStorageDescriptor === undefined) {
      delete globalThis.sessionStorage;
    } else {
      Object.defineProperty(
        globalThis,
        "sessionStorage",
        originalSessionStorageDescriptor,
      );
    }
  }
});

test("keeps the page gated when an interaction cannot be saved", async () => {
  const interactionId = "539f9f01-4f9c-4caf-9ed6-95fe1b73d438";
  const body = new FakeElement("body");
  const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const browser = installBrowserGlobals({
    fetchResponse(url) {
      return url.endsWith("/api/events")
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              interaction: { id: interactionId, type: "agent_check_in" },
            }),
          }
        : { ok: false, status: 500 };
    },
    pathname: "/failed-agent-check-in",
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      createElement: (tagName) => new FakeElement(tagName),
      referrer: "",
    },
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
    writable: true,
  });

  try {
    const clientId = "rsp_4123456789abcdefghijklmnopqrstuv";
    assert.equal(trackPageView({ clientId }), true);
    await waitForPromises();

    const form = findElement(body, (element) => element.tagName === "FORM");
    const agentName = findElement(body, (element) => element.name === "agentName");
    const message = findElement(body, (element) => element.name === "message");
    const status = findElement(
      body,
      (element) => element.attributes["aria-live"] === "polite",
    );
    assert.ok(form);
    assert.ok(agentName);
    assert.ok(message);
    assert.ok(status);
    agentName.value = "Codex";
    message.value = "Testing a required interaction gate.";
    form.dispatch("submit");
    await waitForPromises();

    assert.ok(findElement(body, (element) => element.tagName === "DIALOG"));
    assert.equal(agentName.disabled, false);
    assert.equal(message.disabled, false);
    assert.match(status.textContent, /couldn’t be saved/i);
  } finally {
    browser.restore();
    if (originalSessionStorageDescriptor === undefined) {
      delete globalThis.sessionStorage;
    } else {
      Object.defineProperty(
        globalThis,
        "sessionStorage",
        originalSessionStorageDescriptor,
      );
    }
  }
});
