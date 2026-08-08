import {
  captureStorageKey,
  readCapturedEvents,
  type CapturedEvent,
  type DeliveryResult,
} from "./inspect";

const RESULT_LABELS: Record<DeliveryResult, string> = {
  network: "Network error",
  "not-stored": "Not stored",
  stored: "Stored",
  unverified: "Unverified",
};

type BackgroundResponse = {
  error?: unknown;
  events?: unknown;
  ok?: unknown;
};

const eventList = document.querySelector<HTMLDivElement>("#event-list");
const emptyState = document.querySelector<HTMLDivElement>("#empty-state");
const clearButton = document.querySelector<HTMLButtonElement>("#clear-events");
const reloadButton = document.querySelector<HTMLButtonElement>("#reload-tab");
const errorMessage = document.querySelector<HTMLParagraphElement>("#error-message");

if (
  !eventList ||
  !emptyState ||
  !clearButton ||
  !reloadButton ||
  !errorMessage
) {
  throw new Error("Response Inspector popup could not initialize.");
}

let activeTabId: number | undefined;
let capturedEvents: CapturedEvent[] = [];

const createText = (value: string, className = ""): HTMLSpanElement => {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  element.title = value;
  return element;
};

const renderEvent = (event: CapturedEvent): HTMLDetailsElement => {
  const details = document.createElement("details");
  details.className = "event";

  const summary = document.createElement("summary");
  summary.className = "event-summary";

  const primary = document.createElement("div");
  primary.className = "event-primary";
  primary.append(createText(event.path, "path"));

  const result = createText(RESULT_LABELS[event.result], "result");
  result.dataset.result = event.result;
  primary.append(result);

  const metadata = document.createElement("div");
  metadata.className = "event-meta";
  metadata.append(
    createText(`SDK ${event.sdkVersion}`),
    createText(event.httpStatus === 0 ? "No HTTP response" : `HTTP ${event.httpStatus}`),
    createText(new Date(event.observedAt).toLocaleTimeString()),
  );

  summary.append(primary, metadata);

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
  collector.title = event.collectorUrl;

  payload.append(payloadHeading, rawPayload, collector);
  details.append(summary, payload);
  return details;
};

const render = (): void => {
  eventList.replaceChildren(
    ...[...capturedEvents].reverse().map(renderEvent),
  );

  const isEmpty = capturedEvents.length === 0;
  emptyState.hidden = !isEmpty;
  clearButton.disabled = isEmpty || activeTabId === undefined;
};

const showError = (message?: string): void => {
  errorMessage.textContent = message ?? "";
  errorMessage.hidden = !message;
};

const sendBackgroundMessage = async (
  message: Record<string, unknown>,
): Promise<BackgroundResponse> => {
  const response = (await chrome.runtime.sendMessage(message)) as unknown;
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("The extension background service did not respond.");
  }

  const parsed = response as BackgroundResponse;
  if (parsed.ok !== true) {
    throw new Error(
      typeof parsed.error === "string"
        ? parsed.error
        : "The extension action could not be completed.",
    );
  }

  return parsed;
};

const initialize = async (): Promise<void> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== "number") {
    throw new Error("No active browser tab was found.");
  }

  activeTabId = tab.id;
  const response = await sendBackgroundMessage({
    tabId: activeTabId,
    type: "arm-tab",
  });

  capturedEvents = readCapturedEvents(response.events);
  reloadButton.disabled = false;
  render();
};

reloadButton.addEventListener("click", () => {
  if (activeTabId === undefined) {
    return;
  }

  reloadButton.disabled = true;
  reloadButton.textContent = "Reloading…";
  showError();

  void sendBackgroundMessage({
    tabId: activeTabId,
    type: "reload-tab",
  })
    .then(() => {
      reloadButton.textContent = "Reloaded";
    })
    .catch((error: unknown) => {
      reloadButton.disabled = false;
      reloadButton.textContent = "Reload & capture";
      showError(error instanceof Error ? error.message : "Could not reload this tab.");
    });
});

clearButton.addEventListener("click", () => {
  if (activeTabId === undefined) {
    return;
  }

  clearButton.disabled = true;
  showError();

  void sendBackgroundMessage({
    tabId: activeTabId,
    type: "clear-tab",
  })
    .then(() => {
      capturedEvents = [];
      render();
    })
    .catch((error: unknown) => {
      clearButton.disabled = false;
      showError(error instanceof Error ? error.message : "Could not clear captures.");
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || activeTabId === undefined) {
    return;
  }

  const change = changes[captureStorageKey(activeTabId)];
  if (!change) {
    return;
  }

  capturedEvents = readCapturedEvents(change.newValue);
  render();
});

void initialize().catch((error: unknown) => {
  showError(
    error instanceof Error ? error.message : "Response Inspector could not open.",
  );
  render();
});
