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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, maximumLength: number) => {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const sanitized = sanitizeHeader(value, maximumLength);
  return sanitized || undefined;
};

const boundedInteger = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : undefined;

const boundedIntegerArray = (value: unknown, maximumItems: number) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const integers = value
    .filter(
      (item): item is number =>
        typeof item === "number" &&
        Number.isSafeInteger(item) &&
        item >= 0,
    )
    .slice(0, maximumItems);
  return integers.length > 0 ? integers : undefined;
};

const compact = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );

const hasValues = (value: object) => Object.keys(value).length > 0;

const decodeHeader = (value: string | null, maximumLength: number) => {
  if (!value) {
    return undefined;
  }

  try {
    return boundedString(decodeURIComponent(value), maximumLength);
  } catch {
    return boundedString(value, maximumLength);
  }
};

const createCloudflareEvidence = (cloudflare: Record<string, unknown>) => {
  const botManagement = isRecord(cloudflare.botManagement)
    ? cloudflare.botManagement
    : undefined;
  const jsDetection = isRecord(botManagement?.jsDetection)
    ? botManagement.jsDetection
    : undefined;
  const evidence = compact({
    botScore: boundedInteger(botManagement?.score, 0, 99),
    colo: boundedString(cloudflare.colo, 8),
    corporateProxy:
      typeof botManagement?.corporateProxy === "boolean"
        ? botManagement.corporateProxy
        : undefined,
    detectionIds: boundedIntegerArray(botManagement?.detectionIds, 32),
    ja3Hash: boundedString(botManagement?.ja3Hash, 128),
    ja4: boundedString(botManagement?.ja4, 128),
    jsDetectionPassed:
      typeof jsDetection?.passed === "boolean"
        ? jsDetection.passed
        : undefined,
    signedAgent:
      typeof botManagement?.signedAgent === "boolean"
        ? botManagement.signedAgent
        : undefined,
    staticResource:
      typeof botManagement?.staticResource === "boolean"
        ? botManagement.staticResource
        : undefined,
    verifiedBot:
      typeof botManagement?.verifiedBot === "boolean"
        ? botManagement.verifiedBot
        : undefined,
    verifiedBotCategory: boundedString(cloudflare.verifiedBotCategory, 64),
  });
  return hasValues(evidence) ? evidence : undefined;
};

const createCloudflareNetworkEvidence = (
  cloudflare: Record<string, unknown>,
) => {
  const network = compact({
    asn: boundedInteger(cloudflare.asn, 1, 4_294_967_295),
    city: boundedString(cloudflare.city, 128),
    continent: boundedString(cloudflare.continent, 2),
    country: boundedString(cloudflare.country, 2),
    organization: boundedString(cloudflare.asOrganization, 256),
    region: boundedString(cloudflare.region, 128),
    regionCode: boundedString(cloudflare.regionCode, 16),
    source: "cloudflare",
    timezone: boundedString(cloudflare.timezone, 64),
  });
  return hasValues(network) ? network : undefined;
};

const createVercelNetworkEvidence = (headers: ServerRequestHeaders) => {
  // Vercel overwrites these headers with geolocation derived from the
  // original request IP. Keep only coarse location and never send the IP.
  if (!headers.get("x-vercel-id")) {
    return undefined;
  }

  const network = compact({
    city: decodeHeader(headers.get("x-vercel-ip-city"), 128),
    continent: boundedString(headers.get("x-vercel-ip-continent"), 2),
    country: boundedString(headers.get("x-vercel-ip-country"), 2),
    regionCode: boundedString(
      headers.get("x-vercel-ip-country-region"),
      16,
    ),
    source: "vercel",
    timezone: boundedString(headers.get("x-vercel-ip-timezone"), 64),
  });
  return Object.keys(network).length > 1 ? network : undefined;
};

const createTransportEvidence = (cloudflare: Record<string, unknown>) => {
  const transport = compact({
    clientQuicRtt: boundedInteger(cloudflare.clientQuicRtt, 0, 60_000),
    clientTcpRtt: boundedInteger(cloudflare.clientTcpRtt, 0, 60_000),
    httpProtocol: boundedString(cloudflare.httpProtocol, 32),
    tlsCipher: boundedString(cloudflare.tlsCipher, 128),
    tlsVersion: boundedString(cloudflare.tlsVersion, 32),
  });
  return hasValues(transport) ? transport : undefined;
};

const createPlatformEvidence = (
  request: ServerRequest,
  suppliedCloudflare?: unknown,
) => {
  const cloudflare = isRecord(suppliedCloudflare)
    ? suppliedCloudflare
    : isRecord(request.cf)
      ? request.cf
      : undefined;
  return compact({
    cloudflare: cloudflare
      ? createCloudflareEvidence(cloudflare)
      : undefined,
    network: cloudflare
      ? createCloudflareNetworkEvidence(cloudflare)
      : createVercelNetworkEvidence(request.headers),
    transport: cloudflare
      ? createTransportEvidence(cloudflare)
      : undefined,
  });
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
