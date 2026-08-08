import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MAX_CAPTURED_EVENTS,
  appendCapturedEvent,
  capturePendingResponseEvent,
  classifyDelivery,
  completeResponseEvent,
  isResponseEventRequest,
  readCapturedEvents,
} from "../dist/inspect.js";

const payload = {
  clientId: "rsp_0123456789abcdefghijklmnopqrstuv",
  eventId: "22222222-2222-4222-8222-222222222222",
  path: "/pricing",
  sdkVersion: "0.2.1",
  sessionId: "11111111-1111-4111-8111-111111111111",
};

const encodeBody = (value) => new TextEncoder().encode(value).buffer;

const createRequest = ({
  method = "POST",
  postData = JSON.stringify(payload),
  requestId = "request-1",
  tabId = 42,
  timeStamp = Date.parse("2026-08-07T19:20:30.000Z"),
  url = "https://www.response.sh/api/events",
} = {}) => ({
  method,
  requestBody: { raw: [{ bytes: encodeBody(postData) }] },
  requestId,
  tabId,
  timeStamp,
  url,
});

const createResponse = ({
  headers = [{ name: "Response-Event-Result", value: "stored" }],
  requestId = "request-1",
  statusCode = 204,
} = {}) => ({
  requestId,
  responseHeaders: headers,
  statusCode,
});

test("matches only production and loopback Response event posts", () => {
  assert.equal(isResponseEventRequest(createRequest()), true);
  assert.equal(
    isResponseEventRequest(
      createRequest({
        url: "https://www.response.sh/api/events?source=test",
      }),
    ),
    true,
  );
  assert.equal(
    isResponseEventRequest(
      createRequest({ url: "http://localhost:3000/api/events" }),
    ),
    true,
  );
  assert.equal(
    isResponseEventRequest(
      createRequest({ url: "https://127.0.0.1:8787/api/events" }),
    ),
    true,
  );
  assert.equal(
    isResponseEventRequest(
      createRequest({ url: "http://[::1]:3000/api/events" }),
    ),
    true,
  );
  assert.equal(isResponseEventRequest(createRequest({ method: "GET" })), false);
  assert.equal(
    isResponseEventRequest(
      createRequest({ url: "https://response.sh/api/events" }),
    ),
    false,
  );
  assert.equal(
    isResponseEventRequest(
      createRequest({ url: "https://www.response.sh/api/other" }),
    ),
    false,
  );
  assert.equal(
    isResponseEventRequest(
      createRequest({ url: "https://localhost.example/api/events" }),
    ),
    false,
  );
});

test("classifies delivery from the receipt header without assuming success", () => {
  assert.equal(
    classifyDelivery(204, [
      { name: "response-event-result", value: " STORED " },
    ]),
    "stored",
  );
  assert.equal(
    classifyDelivery(204, [
      { name: "RESPONSE-EVENT-RESULT", value: "not-stored" },
    ]),
    "not-stored",
  );
  assert.equal(classifyDelivery(204, []), "unverified");
  assert.equal(classifyDelivery(500, []), "unverified");
  assert.equal(
    classifyDelivery(500, [
      { name: "Response-Event-Result", value: "stored" },
    ]),
    "unverified",
  );
  assert.equal(classifyDelivery(0, []), "network");
  assert.equal(classifyDelivery(204, [], "net::ERR_FAILED"), "network");
});

test("extracts the outgoing body and completes an event with its receipt", () => {
  const pending = capturePendingResponseEvent(createRequest());

  assert.deepEqual(pending, {
    collectorUrl: "https://www.response.sh/api/events",
    observedAt: "2026-08-07T19:20:30.000Z",
    path: "/pricing",
    rawPayload: JSON.stringify(payload, null, 2),
    requestId: "request-1",
    sdkVersion: "0.2.1",
    tabId: 42,
  });
  assert.deepEqual(completeResponseEvent(pending, createResponse()), {
    collectorUrl: "https://www.response.sh/api/events",
    httpStatus: 204,
    observedAt: "2026-08-07T19:20:30.000Z",
    path: "/pricing",
    rawPayload: JSON.stringify(payload, null, 2),
    result: "stored",
    sdkVersion: "0.2.1",
  });
});

test("keeps malformed bodies inspectable and reports network failures", () => {
  const fallbackNow = new Date("2026-08-07T20:00:00.000Z");
  const malformed = capturePendingResponseEvent(
    createRequest({ postData: "not-json", timeStamp: Number.NaN }),
    () => fallbackNow,
  );

  assert.deepEqual(malformed, {
    collectorUrl: "https://www.response.sh/api/events",
    observedAt: fallbackNow.toISOString(),
    path: "Unknown path",
    rawPayload: "not-json",
    requestId: "request-1",
    sdkVersion: "Unknown",
    tabId: 42,
  });
  assert.equal(capturePendingResponseEvent(undefined), null);
  assert.equal(
    capturePendingResponseEvent(
      createRequest({ url: "https://example.com/api/events" }),
    ),
    null,
  );
  assert.equal(
    completeResponseEvent(
      malformed,
      { requestId: "request-1" },
      "net::ERR_FAILED",
    ).result,
    "network",
  );
});

test("keeps only the newest 100 valid captures", () => {
  const pending = capturePendingResponseEvent(createRequest());
  const baseEvent = completeResponseEvent(pending, createResponse());
  let captures = [];

  for (let index = 0; index < MAX_CAPTURED_EVENTS + 5; index += 1) {
    captures = appendCapturedEvent(captures, {
      ...baseEvent,
      path: `/page-${index}`,
    });
  }

  assert.equal(captures.length, MAX_CAPTURED_EVENTS);
  assert.equal(captures[0].path, "/page-5");
  assert.equal(captures.at(-1).path, "/page-104");
  assert.deepEqual(readCapturedEvents([null, ...captures, { result: "bad" }]), captures);
});

test("build output is a narrowly scoped toolbar extension", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../dist/manifest.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "102");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.action.default_icon, "icon.png");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["activeTab", "storage", "webRequest"],
  );
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.response.sh/api/events*",
    "*://localhost/*",
    "*://127.0.0.1/*",
    "*://[::1]/*",
  ]);
  assert.equal("devtools_page" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
  assert.equal(manifest.permissions.includes("debugger"), false);

  for (const file of [
    "background.js",
    "icon.png",
    "inspect.js",
    "popup.css",
    "popup.html",
    "popup.js",
  ]) {
    assert.equal(
      fs.existsSync(new URL(`../dist/${file}`, import.meta.url)),
      true,
      `${file} should be included in the extension build`,
    );
  }

  for (const file of ["devtools.html", "devtools.js", "panel.html", "panel.js"] ) {
    assert.equal(
      fs.existsSync(new URL(`../dist/${file}`, import.meta.url)),
      false,
      `${file} should not remain in the extension build`,
    );
  }
});
