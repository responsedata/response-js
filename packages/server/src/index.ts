declare const __RESPONSE_SERVER_SDK_VERSION__: string;
declare const process: {
  env: {
    RESPONSE_TOKEN?: string;
  };
};

export const SDK_VERSION = __RESPONSE_SERVER_SDK_VERSION__;

const COLLECTOR_ENDPOINT = "https://www.response.sh/api/requests";
const DELIVERY_TIMEOUT_MS = 3_000;
const MAX_HOST_LENGTH = 253;
const MAX_PATH_LENGTH = 512;
const MAX_REFERRER_ORIGIN_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
const SERVER_TOKEN_PATTERN = /^rsp_server_[A-Za-z0-9_-]{32}$/;
const SOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const SAFE_HEADERS = [
  ["accept-language", "acceptLanguage", 256],
  ["sec-ch-ua", "secChUa", 512],
  ["sec-ch-ua-mobile", "secChUaMobile", 16],
  ["sec-ch-ua-platform", "secChUaPlatform", 128],
  ["sec-fetch-dest", "secFetchDest", 32],
  ["sec-fetch-mode", "secFetchMode", 32],
  ["sec-fetch-site", "secFetchSite", 32],
] as const;

export type ServerRequestHeaders = {
  get(name: string): string | null;
};

export type ServerRequest = {
  headers: ServerRequestHeaders;
  method: string;
  url: string;
};

export type TrackServerRequestOptions = {
  /** Overrides the Response collector URL. HTTPS is required outside localhost. */
  collectorEndpoint?: string;
  /** Set to false to disable collection without removing the integration. */
  enabled?: boolean;
  request: ServerRequest;
  /** Identifies the framework adapter that supplied the request. */
  source: string;
  /** Defaults to the server-only RESPONSE_TOKEN environment variable. */
  token?: string;
};

const normalizeCollectorEndpoint = (value = COLLECTOR_ENDPOINT) => {
  try {
    const endpoint = new URL(value);
    const isLoopback = [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
    ].includes(endpoint.hostname);
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

    return endpoint;
  } catch {
    return null;
  }
};

const normalizeToken = (value: string | undefined) => {
  const token = value?.trim();
  return token && SERVER_TOKEN_PATTERN.test(token) ? token : null;
};

const resolveDefaultToken = () => {
  try {
    return process.env.RESPONSE_TOKEN;
  } catch {
    return undefined;
  }
};

const sanitizeHeader = (value: string | null, maximumLength: number) => {
  if (!value) {
    return "";
  }

  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    if (sanitized.length === maximumLength) {
      break;
    }
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        continue;
      }
      if (sanitized.length + 2 > maximumLength) {
        break;
      }
      sanitized += value.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      continue;
    }
    sanitized += value[index];
  }

  return sanitized;
};

const getReferrerOrigin = (headers: ServerRequestHeaders) => {
  const referrer = headers.get("referer");
  if (!referrer) {
    return null;
  }

  try {
    const url = new URL(referrer);
    const origin = url.origin;
    return (url.protocol === "http:" || url.protocol === "https:") &&
      origin.length <= MAX_REFERRER_ORIGIN_LENGTH
      ? origin
      : null;
  } catch {
    return null;
  }
};

const getSafeHeaders = (headers: ServerRequestHeaders) => {
  const values: Record<string, string> = {};
  for (const [headerName, propertyName, maximumLength] of SAFE_HEADERS) {
    const value = sanitizeHeader(headers.get(headerName), maximumLength);
    if (value) {
      values[propertyName] = value;
    }
  }

  return values;
};

const normalizeRequest = ({
  collectorEndpoint,
  request,
}: {
  collectorEndpoint: URL;
  request: ServerRequest;
}) => {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return null;
  }

  const path = requestUrl.pathname;
  if (
    (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") ||
    requestUrl.host.length === 0 ||
    requestUrl.host.length > MAX_HOST_LENGTH ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.length > MAX_PATH_LENGTH ||
    (requestUrl.origin === collectorEndpoint.origin &&
      path === collectorEndpoint.pathname)
  ) {
    return null;
  }

  return {
    headers: getSafeHeaders(request.headers),
    host: requestUrl.host,
    method,
    path,
    referrerOrigin: getReferrerOrigin(request.headers),
    userAgent: sanitizeHeader(
      request.headers.get("user-agent"),
      MAX_USER_AGENT_LENGTH,
    ),
  };
};

const createId = () => {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof runtimeCrypto?.getRandomValues === "function") {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
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

const createDeliveryTimeout = () => {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return {
      cleanup: () => undefined,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    };
  }

  if (typeof AbortController !== "undefined") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    return {
      cleanup: () => clearTimeout(timeout),
      signal: controller.signal,
    };
  }

  return { cleanup: () => undefined, signal: undefined };
};

/**
 * Sends one normalized, privacy-limited server request observation.
 * Returns a fail-open delivery promise, or null when collection is skipped.
 */
export const trackServerRequest = ({
  collectorEndpoint: suppliedCollectorEndpoint,
  enabled = true,
  request,
  source,
  token: suppliedToken,
}: TrackServerRequestOptions): Promise<void> | null => {
  try {
    if (
      !enabled ||
      typeof fetch === "undefined" ||
      !SOURCE_PATTERN.test(source)
    ) {
      return null;
    }

    const collectorEndpoint = normalizeCollectorEndpoint(
      suppliedCollectorEndpoint,
    );
    const token = normalizeToken(suppliedToken ?? resolveDefaultToken());
    if (!collectorEndpoint || !token) {
      return null;
    }

    const normalizedRequest = normalizeRequest({
      collectorEndpoint,
      request,
    });
    if (!normalizedRequest) {
      return null;
    }

    const body = JSON.stringify({
      requestId: createId(),
      requestAt: new Date().toISOString(),
      ...normalizedRequest,
      sdkVersion: SDK_VERSION,
      source,
    });
    const timeout = createDeliveryTimeout();

    try {
      return Promise.resolve(
        fetch(collectorEndpoint, {
          body,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          ...(timeout.signal ? { signal: timeout.signal } : {}),
        }),
      )
        .then(() => undefined)
        .catch(() => undefined)
        .finally(timeout.cleanup);
    } catch {
      timeout.cleanup();
      return null;
    }
  } catch {
    return null;
  }
};
