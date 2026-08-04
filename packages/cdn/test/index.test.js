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
    path.resolve(testDirectory, "../../browser/package.json"),
    "utf8",
  ),
);
const versionedArtifactPath = path.resolve(
  testDirectory,
  `../dist/${browserPackage.version}/browser.js`,
);

function runSdk({
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
    crypto: {
      randomUUID: () => "39bb0340-379f-46ee-af2d-591d722f4798",
    },
    document: {
      currentScript: {
        dataset: { clientId },
        src: "https://www.response.sh/sdk/browser.js",
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

test("sends one minimal observation to the SDK origin", () => {
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
  assert.equal(
    payload.clientId,
    "rsp_0123456789abcdefghijklmnopqrstuv",
  );
  assert.equal(payload.eventId, "39bb0340-379f-46ee-af2d-591d722f4798");
  assert.equal(payload.path, "/pricing");
  assert.equal(payload.referrerOrigin, "https://search.example");
  assert.equal(payload.signals.webdriver, true);
  assert.equal(payload.sdkVersion, "0.1.0");
  assert.equal(JSON.stringify(payload).includes("private@example.com"), false);
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

test("the rolling and versioned CDN artifacts contain the same SDK", () => {
  assert.deepEqual(
    fs.readFileSync(artifactPath),
    fs.readFileSync(versionedArtifactPath),
  );
});
