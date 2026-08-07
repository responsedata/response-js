import {
  captureResponseEvent,
  type CapturedEvent,
  type DeliveryResult,
} from "./inspect";

const MAX_CAPTURED_EVENTS = 100;
const RESULT_LABELS: Record<DeliveryResult, string> = {
  network: "Network error",
  "not-stored": "Not stored",
  stored: "Stored",
  unverified: "Unverified",
};

const eventList = document.querySelector<HTMLDivElement>("#event-list");
const emptyState = document.querySelector<HTMLDivElement>("#empty-state");
const clearButton = document.querySelector<HTMLButtonElement>("#clear-events");

if (!eventList || !emptyState || !clearButton) {
  throw new Error("Response Inspector panel could not initialize.");
}

const capturedEvents: CapturedEvent[] = [];

const createCell = (value: string, className = ""): HTMLSpanElement => {
  const cell = document.createElement("span");
  cell.className = className;
  cell.textContent = value;
  cell.title = value;
  return cell;
};

const renderEvent = (event: CapturedEvent): HTMLDetailsElement => {
  const details = document.createElement("details");
  details.className = "event";

  const summary = document.createElement("summary");
  summary.className = "event-row";
  summary.append(
    createCell(event.path, "path"),
    createCell(event.sdkVersion, "sdk-version"),
    createCell(new Date(event.observedAt).toLocaleTimeString(), "time"),
    createCell(event.httpStatus === 0 ? "—" : String(event.httpStatus), "http"),
  );

  const result = createCell(RESULT_LABELS[event.result], "result");
  result.dataset.result = event.result;
  summary.append(result);

  const payload = document.createElement("div");
  payload.className = "payload";

  const payloadHeading = document.createElement("div");
  payloadHeading.className = "payload-heading";
  payloadHeading.textContent = "Request payload";

  const rawPayload = document.createElement("pre");
  rawPayload.textContent = event.rawPayload;

  const collector = document.createElement("div");
  collector.className = "collector";
  collector.textContent = event.collectorUrl;

  payload.append(payloadHeading, rawPayload, collector);
  details.append(summary, payload);
  return details;
};

const updateEmptyState = (): void => {
  const isEmpty = capturedEvents.length === 0;
  emptyState.hidden = !isEmpty;
  clearButton.disabled = isEmpty;
};

clearButton.addEventListener("click", () => {
  capturedEvents.length = 0;
  eventList.replaceChildren();
  updateEmptyState();
});

chrome.devtools.network.onRequestFinished.addListener((request) => {
  const event = captureResponseEvent(request);
  if (!event) {
    return;
  }

  capturedEvents.push(event);
  eventList.append(renderEvent(event));

  if (capturedEvents.length > MAX_CAPTURED_EVENTS) {
    capturedEvents.shift();
    eventList.firstElementChild?.remove();
  }

  updateEmptyState();
});

updateEmptyState();
