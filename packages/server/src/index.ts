import { createCloudflarePlatformEvidence } from "./platforms/cloudflare";
import {
  isRecord,
  sanitizeString,
  type PlatformEvidence,
} from "./platforms/shared";
import { createVercelPlatformEvidence } from "./platforms/vercel";

declare const __RESPONSE_SERVER_SDK_VERSION__: string;
declare const process: {
  env: {
    RESPONSE_SERVER_ID?: string;
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
const STATIC_ASSET_PATTERN =
  /\.(?:avif|bmp|css|cur|eot|gif|ico|jpe?g|js|mjs|map|mp3|mp4|ogg|otf|png|svg|ttf|wasm|webm|webmanifest|webp|woff2?)$/i;

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
  /** Cloudflare Workers metadata for the original incoming request, when available. */
  cf?: unknown;
  headers: ServerRequestHeaders;
  method: string;
  url: string;
};

export type TrackServerRequestOptions = {
  /** Cloudflare metadata for the original request when an adapter exposes it. */
  cloudflare?: unknown;
  /** Overrides the Response collector URL. HTTPS is required outside localhost. */
  collectorEndpoint?: string;
  /** Set to false to disable collection without removing the integration. */
  enabled?: boolean;
  request: ServerRequest;
  /** Identifies the framework adapter that supplied the request. */
  source: string;
  /** Defaults to the server-only RESPONSE_SERVER_ID environment variable. */
  token?: string;
};

const isPrefetchPurpose = (headers: ServerRequestHeaders) =>
  [headers.get("purpose"), headers.get("sec-purpose")].some((value) => {
    const purpose = value?.toLowerCase();
    return purpose?.includes("prefetch") || purpose?.includes("prerender");
  });

const acceptsOnlyJson = (headers: ServerRequestHeaders) => {
  const accept = headers.get("accept");
  if (!accept) {
    return false;
  }

  const mediaTypes = accept
    .split(",")
    .map((value) => value.split(";", 1)[0].trim().toLowerCase())
    .filter(Boolean);
  return (
    mediaTypes.length > 0 &&
    mediaTypes.every(
      (mediaType) =>
        mediaType === "application/json" || mediaType.endsWith("+json"),
    )
  );
};

/**
 * Returns whether universal HTTP evidence is consistent with a page request.
 * Missing browser-only headers remain eligible so direct crawlers are kept.
 * Framework adapters should compose this with their own routing rules.
 */
export const isPageRequestCandidate = (request: ServerRequest): boolean => {
  try {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return false;
    }

    const requestUrl = new URL(request.url);
    const path = requestUrl.pathname;
    if (
      (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") ||
      !requestUrl.host ||
      requestUrl.host.length > MAX_HOST_LENGTH ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.length > MAX_PATH_LENGTH ||
      STATIC_ASSET_PATTERN.test(path) ||
      isPrefetchPurpose(request.headers) ||
      acceptsOnlyJson(request.headers)
    ) {
      return false;
    }

    const destination = request.headers
      .get("sec-fetch-dest")
      ?.trim()
      .toLowerCase();
    return !destination || destination === "document";
  } catch {
    return false;
  }
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
    return process.env.RESPONSE_SERVER_ID;
  } catch {
    return undefined;
  }
};

const sanitizeHeader = (value: string | null, maximumLength: number) => {
  if (!value) {
    return "";
  }
  return sanitizeString(value, maximumLength);
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

const createPlatformEvidence = (
  request: ServerRequest,
  suppliedCloudflare?: unknown,
): PlatformEvidence => {
  const cloudflare = isRecord(suppliedCloudflare)
    ? suppliedCloudflare
    : isRecord(request.cf)
      ? request.cf
      : undefined;
  return cloudflare
    ? createCloudflarePlatformEvidence(cloudflare)
    : createVercelPlatformEvidence(request.headers);
};

const normalizeRequest = ({
  cloudflare,
  collectorEndpoint,
  request,
}: {
  cloudflare?: unknown;
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
    ...createPlatformEvidence(request, cloudflare),
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
  cloudflare,
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
      cloudflare,
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
