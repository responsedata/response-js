import type { NextFetchEvent, NextRequest } from "next/server.js";

declare const __RESPONSE_NEXT_SDK_VERSION__: string;
declare const process: {
  env: {
    RESPONSE_TOKEN?: string;
  };
};

const DEFAULT_COLLECTOR_ENDPOINT = "https://www.response.sh/api/requests";
const DELIVERY_TIMEOUT_MS = 3_000;
const MAX_HOST_LENGTH = 253;
const MAX_PATH_LENGTH = 512;
const MAX_REFERRER_ORIGIN_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
const SERVER_TOKEN_PATTERN = /^rsp_server_[A-Za-z0-9_-]{32}$/;
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

export type ResponseProxyOptions = {
  /** Overrides the Response collector URL. HTTPS is required outside localhost. */
  collectorEndpoint?: string;
  /** Set to false to disable collection without removing the proxy. */
  enabled?: boolean;
  /** Defaults to the server-only RESPONSE_TOKEN environment variable. */
  token?: string;
};

export type ResponseProxy = (
  request: NextRequest,
  event: NextFetchEvent,
) => void;

const normalizeCollectorEndpoint = (value: string) => {
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

    return endpoint;
  } catch {
    return null;
  }
};

const normalizeToken = (value: string | undefined) => {
  const token = value?.trim();
  return token && SERVER_TOKEN_PATTERN.test(token) ? token : null;
};

const sanitizeHeader = (value: string | null, maxLength: number) => {
  if (!value) {
    return "";
  }

  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    if (sanitized.length === maxLength) {
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
      if (sanitized.length + 2 > maxLength) {
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

const getReferrerOrigin = (headers: Headers) => {
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

const getSafeHeaders = (headers: Headers) => {
  const values: Record<string, string> = {};
  for (const [headerName, propertyName, maxLength] of SAFE_HEADERS) {
    const value = sanitizeHeader(headers.get(headerName), maxLength);
    if (value) {
      values[propertyName] = value;
    }
  }

  return values;
};

const isPrefetch = (headers: Headers) =>
  headers.has("next-router-prefetch") ||
  headers.has("x-middleware-prefetch") ||
  headers.has("x-nextjs-data") ||
  headers.get("rsc") === "1" ||
  headers.get("purpose")?.toLowerCase().includes("prefetch") === true ||
  headers.get("sec-purpose")?.toLowerCase().includes("prefetch") === true;

const isPageLikeRequest = (
  requestUrl: URL,
  method: string,
  headers: Headers,
  collectorEndpoint: URL,
) => {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  const path = requestUrl.pathname;
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.length > MAX_PATH_LENGTH ||
    requestUrl.host.length === 0 ||
    requestUrl.host.length > MAX_HOST_LENGTH ||
    /(?:^|\/)_next(?:\/|$)/.test(path) ||
    STATIC_ASSET_PATTERN.test(path) ||
    isPrefetch(headers)
  ) {
    return false;
  }

  return !(
    requestUrl.origin === collectorEndpoint.origin &&
    path === collectorEndpoint.pathname
  );
};

const resolveDefaultToken = () => {
  try {
    return process.env.RESPONSE_TOKEN;
  } catch {
    return undefined;
  }
};

/**
 * Creates a Next.js Proxy handler that records incoming page requests without
 * delaying or changing the site's response.
 */
export const createResponseProxy = (
  options: ResponseProxyOptions = {},
): ResponseProxy => {
  const collectorEndpoint = normalizeCollectorEndpoint(
    options.collectorEndpoint ?? DEFAULT_COLLECTOR_ENDPOINT,
  );

  return (request, event) => {
    try {
      if (options.enabled === false || !collectorEndpoint) {
        return;
      }

      const token = normalizeToken(options.token ?? resolveDefaultToken());
      const requestUrl = new URL(request.url);
      const method = request.method.toUpperCase();
      if (
        !token ||
        !isPageLikeRequest(
          requestUrl,
          method,
          request.headers,
          collectorEndpoint,
        )
      ) {
        return;
      }

      const requestId = crypto.randomUUID();
      const body = JSON.stringify({
        requestId,
        requestAt: new Date().toISOString(),
        host: requestUrl.host,
        method,
        path: requestUrl.pathname,
        referrerOrigin: getReferrerOrigin(request.headers),
        sdkVersion: __RESPONSE_NEXT_SDK_VERSION__,
        source: "nextjs",
        userAgent: sanitizeHeader(
          request.headers.get("user-agent"),
          MAX_USER_AGENT_LENGTH,
        ),
        headers: getSafeHeaders(request.headers),
      });

      const delivery = fetch(collectorEndpoint, {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
        .then(() => undefined)
        .catch(() => undefined);

      event.waitUntil(delivery);
    } catch {
      // Analytics must never change or break the site's request handling.
    }
  };
};
