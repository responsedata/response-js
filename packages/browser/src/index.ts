declare const __RESPONSE_SDK_VERSION__: string;

export const SDK_VERSION = __RESPONSE_SDK_VERSION__;

const DEFAULT_ENDPOINT = "https://www.response.sh/api/events";
const PUBLIC_CLIENT_ID_PATTERN = /^rsp_[A-Za-z0-9_-]{32}$/;
const DUPLICATE_WINDOW_MS = 1_000;

type PrivacyAwareNavigator = Navigator & {
  globalPrivacyControl?: boolean;
};

type PrivacyAwareGlobal = typeof globalThis & {
  doNotTrack?: string | null;
};

export type TrackPageViewOptions = {
  clientId: string;
  endpoint?: string;
  path?: string;
};

let lastPageViewKey = "";
let lastPageViewTime = 0;

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

const createEventId = () => {
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

const normalizeEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    const isLoopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";

    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopback))
    ) {
      return null;
    }

    url.hash = "";
    return url.href;
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

/**
 * Sends one privacy-limited page observation to the Response collector.
 * Returns true when delivery was queued and false when collection was skipped.
 */
export const trackPageView = ({
  clientId,
  endpoint = DEFAULT_ENDPOINT,
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

    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const normalizedPath = normalizePath(path ?? location.pathname);
    if (!normalizedEndpoint || !normalizedPath) {
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
    lastPageViewKey = pageViewKey;
    lastPageViewTime = now;

    void fetch(normalizedEndpoint, {
      body: JSON.stringify({
        clientId,
        eventId: createEventId(),
        path: normalizedPath,
        referrerOrigin: getReferrerOrigin(),
        sdkVersion: SDK_VERSION,
        signals: {
          webdriver: navigator.webdriver === true,
        },
        version: 1,
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
