import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.resolve(
  testDirectory,
  "../dist/browser.js",
);
const browserPackage = JSON.parse(
  fs.readFileSync(
    path.resolve(testDirectory, "../../../packages/browser/package.json"),
    "utf8",
  ),
);

function runSdk({
  cdpRuntimeDetected = true,
  clientId = "rsp_0123456789abcdefghijklmnopqrstuv",
  doNotTrack = null,
  fetcher,
  globalPrivacyControl = false,
  referrer = "https://search.example/results?q=private",
  webdriver = true,
} = {}) {
  const requests = [];
  const source = fs.readFileSync(artifactPath, "utf8");
  const fetchImplementation =
    fetcher ??
    ((url, init) => {
      requests.push({ init, url });
      return Promise.resolve({ ok: true });
    });

  const context = vm.createContext({
    URL,
    console: {
      debug(value) {
        if (cdpRuntimeDetected) {
          void value.stack;
        }
      },
    },
    crypto: {
      randomUUID: () => "39bb0340-379f-46ee-af2d-591d722f4798",
    },
    document: {
      currentScript: {
        dataset: { clientId },
        src: "https://cdn.response.sh/browser.js",
      },
      referrer,
    },
    fetch: fetchImplementation,
    location: {
      hash: "#private",
      pathname: "/pricing",
      search: "?email=private@example.com",
    },
    navigator: {
      doNotTrack,
      globalPrivacyControl,
      webdriver,
    },
  });

  vm.runInContext(source, context);
  return requests;
}

test("sends one minimal observation to the stable collector", () => {
  const requests = runSdk();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://www.response.sh/api/events");
  assert.deepEqual(
    {
      credentials: requests[0].init.credentials,
      keepalive: requests[0].init.keepalive,
      method: requests[0].init.method,
      mode: requests[0].init.mode,
      referrerPolicy: requests[0].init.referrerPolicy,
    },
    {
      credentials: "omit",
      keepalive: true,
      method: "POST",
      mode: "cors",
      referrerPolicy: "no-referrer",
    },
  );

  const payload = JSON.parse(requests[0].init.body);
  assert.deepEqual(payload.capabilities, ["agent_check_in"]);
  assert.equal(
    payload.clientId,
    "rsp_0123456789abcdefghijklmnopqrstuv",
  );
  assert.equal(payload.eventId, "39bb0340-379f-46ee-af2d-591d722f4798");
  assert.equal(payload.path, "/pricing");
  assert.equal(payload.referrerOrigin, "https://search.example");
  assert.equal(payload.signals.cdpRuntimeDetected, true);
  assert.equal(payload.signals.webdriver, true);
  assert.equal(payload.sdkVersion, browserPackage.version);
  assert.equal(JSON.stringify(payload).includes("private@example.com"), false);
  assert.equal(payload.version, 1);
});

test("does nothing without a valid public client ID", () => {
  assert.equal(runSdk({ clientId: "" }).length, 0);
  assert.equal(runSdk({ clientId: "not-a-client-id" }).length, 0);
});

test("honors browser privacy signals", () => {
  assert.equal(runSdk({ doNotTrack: "1" }).length, 0);
  assert.equal(runSdk({ globalPrivacyControl: true }).length, 0);
});

test("delivery failures never escape into the page", () => {
  assert.doesNotThrow(() =>
    runSdk({
      fetcher() {
        throw new Error("network unavailable");
      },
    }),
  );
});
