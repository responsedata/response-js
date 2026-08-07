import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  captureResponseEvent,
  classifyDelivery,
  isResponseEventRequest,
} from "../dist/inspect.js";

const payload = {
  clientId: "rsp_0123456789abcdefghijklmnopqrstuv",
  eventId: "22222222-2222-4222-8222-222222222222",
  path: "/pricing",
  sdkVersion: "0.2.1",
  sessionId: "11111111-1111-4111-8111-111111111111",
};

const createEntry = ({
  headers = [{ name: "Response-Event-Result", value: "stored" }],
  method = "POST",
  postData = JSON.stringify(payload),
  status = 204,
  url = "https://www.response.sh/api/events",
} = {}) => ({
  request: {
    method,
    postData: { text: postData },
    url,
  },
  response: { headers, status },
  startedDateTime: "2026-08-07T19:20:30.000Z",
});

test("matches only production and loopback Response event posts", () => {
  assert.equal(isResponseEventRequest(createEntry().request), true);
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "https://www.response.sh/api/events?source=test" })
        .request,
    ),
    true,
  );
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "http://localhost:3000/api/events" }).request,
    ),
    true,
  );
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "http://127.0.0.1:8787/api/events" }).request,
    ),
    true,
  );
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "http://[::1]:3000/api/events" }).request,
    ),
    true,
  );
  assert.equal(isResponseEventRequest(createEntry({ method: "GET" }).request), false);
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "https://response.sh/api/events" }).request,
    ),
    false,
  );
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "https://www.response.sh/api/other" }).request,
    ),
    false,
  );
  assert.equal(
    isResponseEventRequest(
      createEntry({ url: "https://localhost.example/api/events" }).request,
    ),
    false,
  );
});

test("classifies delivery from the receipt header without assuming success", () => {
  assert.equal(
    classifyDelivery({
      headers: [{ name: "response-event-result", value: " STORED " }],
      status: 204,
    }),
    "stored",
  );
  assert.equal(
    classifyDelivery({
      headers: [{ name: "RESPONSE-EVENT-RESULT", value: "not-stored" }],
      status: 204,
    }),
    "not-stored",
  );
  assert.equal(classifyDelivery({ headers: [], status: 204 }), "unverified");
  assert.equal(classifyDelivery({ headers: [], status: 500 }), "unverified");
  assert.equal(
    classifyDelivery({
      headers: [{ name: "Response-Event-Result", value: "stored" }],
      status: 500,
    }),
    "unverified",
  );
  assert.equal(classifyDelivery({ headers: [], status: 0 }), "network");
  assert.equal(
    classifyDelivery({ headers: [], status: 204 }, "net::ERR_FAILED"),
    "network",
  );
});

test("extracts the event summary and formats its raw payload", () => {
  const event = captureResponseEvent(createEntry());

  assert.deepEqual(event, {
    collectorUrl: "https://www.response.sh/api/events",
    httpStatus: 204,
    observedAt: "2026-08-07T19:20:30.000Z",
    path: "/pricing",
    rawPayload: JSON.stringify(payload, null, 2),
    result: "stored",
    sdkVersion: "0.2.1",
  });
});

test("keeps malformed payloads inspectable and ignores unrelated entries", () => {
  const fallbackNow = new Date("2026-08-07T20:00:00.000Z");
  const malformed = createEntry({ postData: "not-json" });
  malformed.startedDateTime = "not-a-date";

  assert.deepEqual(captureResponseEvent(malformed, () => fallbackNow), {
    collectorUrl: "https://www.response.sh/api/events",
    httpStatus: 204,
    observedAt: fallbackNow.toISOString(),
    path: "Unknown path",
    rawPayload: "not-json",
    result: "stored",
    sdkVersion: "Unknown",
  });
  assert.equal(captureResponseEvent(undefined), null);
  assert.equal(
    captureResponseEvent(createEntry({ url: "https://example.com/api/events" })),
    null,
  );
});

test("build output is a permission-free DevTools extension", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../dist/manifest.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.devtools_page, "devtools.html");
  assert.equal("permissions" in manifest, false);
  assert.equal("host_permissions" in manifest, false);
  assert.equal("background" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
  assert.equal("action" in manifest, false);

  for (const file of [
    "devtools.html",
    "devtools.js",
    "panel.css",
    "panel.html",
    "panel.js",
  ]) {
    assert.equal(
      fs.existsSync(new URL(`../dist/${file}`, import.meta.url)),
      true,
      `${file} should be included in the extension build`,
    );
  }
});
