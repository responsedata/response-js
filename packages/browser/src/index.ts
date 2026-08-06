declare const __RESPONSE_SDK_VERSION__: string;

export const SDK_VERSION = __RESPONSE_SDK_VERSION__;

const COLLECTOR_ENDPOINT = "https://www.response.sh/api/events";
const PUBLIC_CLIENT_ID_PATTERN = /^rsp_[A-Za-z0-9_-]{32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUPLICATE_WINDOW_MS = 1_000;
const SESSION_KEY_PREFIX = "response:session:";

type PrivacyAwareNavigator = Navigator & {
  globalPrivacyControl?: boolean;
};

type PrivacyAwareGlobal = typeof globalThis & {
  doNotTrack?: string | null;
};

export type TrackPageViewOptions = {
  clientId: string;
  collectorEndpoint?: string;
  path?: string;
};

let lastPageViewKey = "";
let lastPageViewTime = 0;
const memorySessionIds = new Map<string, string>();

const trackingAllowed = () => {
  const privacyNavigator = navigator as PrivacyAwareNavigator;
  const privacyGlobal = globalThis as PrivacyAwareGlobal;
  const doNotTrack = (
    privacyNavigator.doNotTrack ?? privacyGlobal.doNotTrack
  )?.toLowerCase();

  return (
    privacyNavigator.globalPrivacyControl !== true &&
    doNotTrack !== "1" &&
    doNotTrack !== "yes"
  );
};

const createId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

const getSessionId = (clientId: string) => {
  const memorySessionId = memorySessionIds.get(clientId);
  if (memorySessionId) {
    return memorySessionId;
  }

  const storageKey = `${SESSION_KEY_PREFIX}${clientId}`;
  try {
    const storedSessionId = sessionStorage.getItem(storageKey);
    if (storedSessionId && UUID_PATTERN.test(storedSessionId)) {
      const normalizedSessionId = storedSessionId.toLowerCase();
      memorySessionIds.set(clientId, normalizedSessionId);
      return normalizedSessionId;
    }
  } catch {
    // Fall back to module memory when session storage is unavailable.
  }

  const sessionId = createId();
  memorySessionIds.set(clientId, sessionId);
  try {
    sessionStorage.setItem(storageKey, sessionId);
  } catch {
    // The in-memory ID still groups this tab's page views for this SDK load.
  }

  return sessionId;
};

const getReferrerOrigin = () => {
  if (!document.referrer) {
    return null;
  }

  try {
    const url = new URL(document.referrer);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

const normalizePath = (value: string) => {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  try {
    const pathname = new URL(value, "https://response.invalid").pathname;
    return pathname.length > 0 && pathname.length <= 512 ? pathname : null;
  } catch {
    return null;
  }
};

const normalizeCollectorEndpoint = (value = COLLECTOR_ENDPOINT) => {
  try {
    const endpoint = new URL(value);
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(
      endpoint.hostname,
    );
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== "https:" &&
        !(endpoint.protocol === "http:" && isLoopback))
    ) {
      return null;
    }

    return endpoint.toString();
  } catch {
    return null;
  }
};

const detectAutomationArtifacts = () => {
  try {
    const automationPattern =
      /(?:^|_)(?:cdc|phantom|playwright|puppeteer|selenium|webdriver)(?:_|$)/i;
    const globalNames = Object.getOwnPropertyNames(globalThis);
    const documentAttributes = document.documentElement
      ? Array.from(document.documentElement.attributes, (attribute) =>
          attribute.name,
        )
      : [];

    return (
      globalNames.some((name) => automationPattern.test(name)) ||
      documentAttributes.some((name) => automationPattern.test(name))
    );
  } catch {
    return false;
  }
};

const detectWebdriver = () => {
  try {
    return navigator.webdriver === true;
  } catch {
    return false;
  }
};

const collectClientAutomationEvidence = () => ({
  automationArtifactsDetected: detectAutomationArtifacts(),
  webdriver: detectWebdriver(),
});

/**
 * Sends one privacy-limited page observation to the Response collector.
 * Returns true when delivery was queued and false when collection was skipped.
 */
export const trackPageView = ({
  clientId,
  collectorEndpoint: suppliedCollectorEndpoint,
  path,
}: TrackPageViewOptions): boolean => {
  try {
    if (
      typeof document === "undefined" ||
      typeof navigator === "undefined" ||
      typeof location === "undefined" ||
      typeof fetch === "undefined" ||
      typeof crypto === "undefined" ||
      !PUBLIC_CLIENT_ID_PATTERN.test(clientId) ||
      !trackingAllowed()
    ) {
      return false;
    }

    const normalizedPath = normalizePath(path ?? location.pathname);
    const collectorEndpoint = normalizeCollectorEndpoint(
      suppliedCollectorEndpoint,
    );
    if (!normalizedPath || !collectorEndpoint) {
      return false;
    }

    const pageViewKey = `${clientId}\n${normalizedPath}`;
    const now = Date.now();
    if (
      pageViewKey === lastPageViewKey &&
      now - lastPageViewTime < DUPLICATE_WINDOW_MS
    ) {
      return false;
    }

    const sessionId = getSessionId(clientId);
    const eventId = createId();
    lastPageViewKey = pageViewKey;
    lastPageViewTime = now;

    const signals = collectClientAutomationEvidence();
    void fetch(collectorEndpoint, {
      body: JSON.stringify({
        clientId,
        eventId,
        sessionId,
        path: normalizedPath,
        referrerOrigin: getReferrerOrigin(),
        sdkVersion: SDK_VERSION,
        signals,
      }),
      credentials: "omit",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      keepalive: true,
      method: "POST",
      mode: "cors",
      referrerPolicy: "no-referrer",
    }).catch(() => undefined);

    return true;
  } catch {
    return false;
  }
};
