export const PRODUCTION_COLLECTOR_URL =
  "https://www.response.sh/api/events";

export const WEB_REQUEST_URLS = [
  "https://www.response.sh/api/events*",
  "*://localhost/api/events*",
  "*://127.0.0.1/api/events*",
  "*://[::1]/api/events*",
];

export const MAX_CAPTURED_EVENTS = 100;
export const ARMED_TABS_STORAGE_KEY = "response-inspector:armed-tabs";

const CAPTURES_STORAGE_PREFIX = "response-inspector:captures:";
const PENDING_STORAGE_PREFIX = "response-inspector:pending:";
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

export interface PendingResponseEvent {
  collectorUrl: string;
  observedAt: string;
  path: string;
  rawPayload: string;
  requestId: string;
  sdkVersion: string;
  tabId: number;
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

const readHeader = (headers: unknown, name: string): string | undefined => {
  if (!Array.isArray(headers)) {
    return undefined;
  }

  for (const header of headers) {
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

export const classifyDelivery = (
  httpStatus: number,
  responseHeaders: unknown,
  networkError?: unknown,
): DeliveryResult => {
  if (
    httpStatus === 0 ||
    (typeof networkError === "string" && networkError.length > 0)
  ) {
    return "network";
  }

  const receipt = readHeader(responseHeaders, RESULT_HEADER)
    ?.trim()
    .toLowerCase();
  if (receipt === "stored" && httpStatus >= 200 && httpStatus < 300) {
    return "stored";
  }
  if (receipt === "not-stored") {
    return "not-stored";
  }

  return "unverified";
};

const readRequestText = (requestBody: unknown): string => {
  if (!isRecord(requestBody)) {
    return "";
  }

  if (Array.isArray(requestBody.raw)) {
    const decoder = new TextDecoder();
    return requestBody.raw
      .map((part) => {
        if (!isRecord(part) || !(part.bytes instanceof ArrayBuffer)) {
          return "";
        }

        return decoder.decode(new Uint8Array(part.bytes));
      })
      .join("");
  }

  if (isRecord(requestBody.formData)) {
    return JSON.stringify(requestBody.formData);
  }

  return "";
};

const readPayload = (requestBody: unknown): {
  path: string;
  rawPayload: string;
  sdkVersion: string;
} => {
  const rawText = readRequestText(requestBody);

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = undefined;
  }

  const payloadRecord = isRecord(payload) ? payload : undefined;
  const formattedPayload =
    payload === undefined ? undefined : JSON.stringify(payload, null, 2);

  return {
    path:
      payloadRecord && typeof payloadRecord.path === "string"
        ? payloadRecord.path
        : "Unknown path",
    rawPayload:
      typeof formattedPayload === "string"
        ? formattedPayload
        : rawText || "(No request payload)",
    sdkVersion:
      payloadRecord && typeof payloadRecord.sdkVersion === "string"
        ? payloadRecord.sdkVersion
        : "Unknown",
  };
};

const readObservedAt = (value: unknown, fallback: Date): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const observedAt = new Date(value);
    if (!Number.isNaN(observedAt.getTime())) {
      return observedAt.toISOString();
    }
  }

  return fallback.toISOString();
};

export const capturePendingResponseEvent = (
  request: unknown,
  now: () => Date = () => new Date(),
): PendingResponseEvent | null => {
  if (!isRecord(request) || !isResponseEventRequest(request)) {
    return null;
  }

  if (
    typeof request.requestId !== "string" ||
    typeof request.tabId !== "number" ||
    !Number.isInteger(request.tabId) ||
    request.tabId < 0
  ) {
    return null;
  }

  const payload = readPayload(request.requestBody);

  return {
    collectorUrl: request.url as string,
    observedAt: readObservedAt(request.timeStamp, now()),
    path: payload.path,
    rawPayload: payload.rawPayload,
    requestId: request.requestId,
    sdkVersion: payload.sdkVersion,
    tabId: request.tabId,
  };
};

const readStatusCode = (response: unknown): number => {
  if (
    isRecord(response) &&
    typeof response.statusCode === "number" &&
    Number.isFinite(response.statusCode)
  ) {
    return response.statusCode;
  }

  return 0;
};

export const completeResponseEvent = (
  pending: PendingResponseEvent,
  response: unknown,
  networkError?: string,
): CapturedEvent => {
  const httpStatus = readStatusCode(response);
  const responseHeaders = isRecord(response)
    ? response.responseHeaders
    : undefined;

  return {
    collectorUrl: pending.collectorUrl,
    httpStatus,
    observedAt: pending.observedAt,
    path: pending.path,
    rawPayload: pending.rawPayload,
    result: classifyDelivery(httpStatus, responseHeaders, networkError),
    sdkVersion: pending.sdkVersion,
  };
};

const DELIVERY_RESULTS = new Set<DeliveryResult>([
  "stored",
  "not-stored",
  "network",
  "unverified",
]);

export const isPendingResponseEvent = (
  value: unknown,
): value is PendingResponseEvent =>
  isRecord(value) &&
  typeof value.collectorUrl === "string" &&
  typeof value.observedAt === "string" &&
  typeof value.path === "string" &&
  typeof value.rawPayload === "string" &&
  typeof value.requestId === "string" &&
  typeof value.sdkVersion === "string" &&
  typeof value.tabId === "number" &&
  Number.isInteger(value.tabId) &&
  value.tabId >= 0;

const isCapturedEvent = (value: unknown): value is CapturedEvent =>
  isRecord(value) &&
  typeof value.collectorUrl === "string" &&
  typeof value.httpStatus === "number" &&
  typeof value.observedAt === "string" &&
  typeof value.path === "string" &&
  typeof value.rawPayload === "string" &&
  typeof value.result === "string" &&
  DELIVERY_RESULTS.has(value.result as DeliveryResult) &&
  typeof value.sdkVersion === "string";

export const readCapturedEvents = (value: unknown): CapturedEvent[] =>
  Array.isArray(value)
    ? value.filter(isCapturedEvent).slice(-MAX_CAPTURED_EVENTS)
    : [];

export const appendCapturedEvent = (
  current: unknown,
  event: CapturedEvent,
): CapturedEvent[] => [
  ...readCapturedEvents(current).slice(-(MAX_CAPTURED_EVENTS - 1)),
  event,
];

export const readArmedTabIds = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter(
        (tabId): tabId is number =>
          typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0,
      )
    : [];

export const captureStorageKey = (tabId: number): string =>
  `${CAPTURES_STORAGE_PREFIX}${tabId}`;

export const pendingStorageKey = (requestId: string): string =>
  `${PENDING_STORAGE_PREFIX}${requestId}`;
