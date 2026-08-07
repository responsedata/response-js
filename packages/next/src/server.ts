import {
  trackServerRequest,
  type TrackServerRequestOptions,
} from "@responsedata/server";
import type { NextFetchEvent, NextRequest } from "next/server.js";

const STATIC_ASSET_PATTERN =
  /\.(?:avif|bmp|css|cur|eot|gif|ico|jpe?g|js|mjs|map|mp3|mp4|ogg|otf|png|svg|ttf|wasm|webm|webmanifest|webp|woff2?)$/i;

type CoreResponseProxyOptions = Pick<
  TrackServerRequestOptions,
  "collectorEndpoint" | "enabled" | "token"
>;

export type ResponseProxyOptions = CoreResponseProxyOptions & {
  /**
   * Supplies Cloudflare metadata for the original request. OpenNext users can
   * return `getCloudflareContext().cf` here from inside the request lifecycle.
   */
  getCloudflareProperties?: () => unknown;
};

export type ResponseProxy = (
  request: NextRequest,
  event: NextFetchEvent,
) => void;

const isPrefetch = (headers: Headers) =>
  headers.has("next-router-prefetch") ||
  headers.has("x-middleware-prefetch") ||
  headers.has("x-nextjs-data") ||
  headers.get("rsc") === "1" ||
  headers.get("purpose")?.toLowerCase().includes("prefetch") === true ||
  headers.get("sec-purpose")?.toLowerCase().includes("prefetch") === true;

const isPageLikeNextRequest = (request: NextRequest) => {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  const path = new URL(request.url).pathname;
  return !(
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /(?:^|\/)_next(?:\/|$)/.test(path) ||
    STATIC_ASSET_PATTERN.test(path) ||
    isPrefetch(request.headers)
  );
};

/**
 * Creates a Next.js Proxy handler that records incoming page requests without
 * delaying or changing the site's response.
 */
export const createResponseProxy = (
  options: ResponseProxyOptions = {},
): ResponseProxy =>
  (request, event) => {
    try {
      if (!isPageLikeNextRequest(request)) {
        return;
      }

      const { getCloudflareProperties, ...coreOptions } = options;
      const delivery = trackServerRequest({
        ...coreOptions,
        cloudflare: getCloudflareProperties?.(),
        request,
        source: "nextjs",
      });
      if (delivery) {
        event.waitUntil(delivery);
      }
    } catch {
      // Analytics must never change or break the site's request handling.
    }
  };
