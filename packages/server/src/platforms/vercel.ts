import {
  boundedString,
  compact,
  decodeHeader,
  type HeaderReader,
  type NetworkEvidence,
  type PlatformEvidence,
} from "./shared";

export const createVercelPlatformEvidence = (
  headers: HeaderReader,
): PlatformEvidence => {
  // Vercel overwrites these headers with geolocation derived from the
  // original request IP. Keep only coarse location and never send the IP.
  if (!headers.get("x-vercel-id")) {
    return {};
  }

  const network = compact({
    city: decodeHeader(headers.get("x-vercel-ip-city"), 128),
    continent: boundedString(headers.get("x-vercel-ip-continent"), 2),
    country: boundedString(headers.get("x-vercel-ip-country"), 2),
    regionCode: boundedString(
      headers.get("x-vercel-ip-country-region"),
      16,
    ),
    source: "vercel" as const,
    timezone: boundedString(headers.get("x-vercel-ip-timezone"), 64),
  }) as NetworkEvidence;

  return Object.keys(network).length > 1 ? { network } : {};
};
