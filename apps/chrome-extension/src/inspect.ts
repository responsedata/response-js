export const PRODUCTION_COLLECTOR_URL =
  "https://www.response.sh/api/events";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RESULT_HEADER = "response-event-result";

export type DeliveryResult =
  | "stored"
  | "not-stored"
  | "network"
  | "unverified";

export interface CapturedEvent {
  collectorUrl: string;
  httpStatus: number;
  observedAt: string;
  path: string;
  rawPayload: string;
  result: DeliveryResult;
  sdkVersion: string;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCollectorUrl = (url: string): boolean => {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.pathname !== "/api/events") {
    return false;
  }

  if (parsed.origin === "https://www.response.sh") {
    return true;
  }

  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    LOOPBACK_HOSTS.has(parsed.hostname)
  );
};

export const isResponseEventRequest = (request: unknown): boolean => {
  if (!isRecord(request)) {
    return false;
  }

  return (
    typeof request.method === "string" &&
    request.method.toUpperCase() === "POST" &&
    typeof request.url === "string" &&
    isCollectorUrl(request.url)
  );
};

const readHeader = (response: unknown, name: string): string | undefined => {
  if (!isRecord(response) || !Array.isArray(response.headers)) {
    return undefined;
  }

  for (const header of response.headers) {
    if (
      isRecord(header) &&
      typeof header.name === "string" &&
      header.name.toLowerCase() === name &&
      typeof header.value === "string"
    ) {
      return header.value;
    }
  }

  return undefined;
};

const readStatus = (response: unknown): number => {
  if (
    isRecord(response) &&
    typeof response.status === "number" &&
    Number.isFinite(response.status)
  ) {
    return response.status;
  }

  return 0;
};

export const classifyDelivery = (
  response: unknown,
  networkError?: unknown,
): DeliveryResult => {
  const status = readStatus(response);
  if (
    status === 0 ||
    (typeof networkError === "string" && networkError.length > 0)
  ) {
    return "network";
  }

  const receipt = readHeader(response, RESULT_HEADER)?.trim().toLowerCase();
  if (receipt === "stored" && status >= 200 && status < 300) {
    return "stored";
  }
  if (receipt === "not-stored") {
    return "not-stored";
  }

  return "unverified";
};

const readPayload = (request: UnknownRecord): {
  path: string;
  rawPayload: string;
  sdkVersion: string;
} => {
  const postData = request.postData;
  const rawText =
    isRecord(postData) && typeof postData.text === "string"
      ? postData.text
      : "";

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = undefined;
  }

  const payloadRecord = isRecord(payload) ? payload : undefined;

  return {
    path:
      payloadRecord && typeof payloadRecord.path === "string"
        ? payloadRecord.path
        : "Unknown path",
    rawPayload: payloadRecord
      ? JSON.stringify(payloadRecord, null, 2)
      : rawText || "(No request payload)",
    sdkVersion:
      payloadRecord && typeof payloadRecord.sdkVersion === "string"
        ? payloadRecord.sdkVersion
        : "Unknown",
  };
};

const readObservedAt = (value: unknown, fallback: Date): string => {
  if (typeof value === "string") {
    const observedAt = new Date(value);
    if (!Number.isNaN(observedAt.getTime())) {
      return observedAt.toISOString();
    }
  }

  return fallback.toISOString();
};

export const captureResponseEvent = (
  entry: unknown,
  now: () => Date = () => new Date(),
): CapturedEvent | null => {
  if (!isRecord(entry) || !isResponseEventRequest(entry.request)) {
    return null;
  }

  const request = entry.request as UnknownRecord;
  const response = entry.response;
  const payload = readPayload(request);

  return {
    collectorUrl: request.url as string,
    httpStatus: readStatus(response),
    observedAt: readObservedAt(entry.startedDateTime, now()),
    path: payload.path,
    rawPayload: payload.rawPayload,
    result: classifyDelivery(response, entry._error),
    sdkVersion: payload.sdkVersion,
  };
};
