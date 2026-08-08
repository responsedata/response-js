import {
  ARMED_TABS_STORAGE_KEY,
  WEB_REQUEST_URLS,
  appendCapturedEvent,
  capturePendingResponseEvent,
  captureStorageKey,
  completeResponseEvent,
  isPendingResponseEvent,
  isResponseEventRequest,
  pendingStorageKey,
  readArmedTabIds,
  readCapturedEvents,
  type PendingResponseEvent,
} from "./inspect";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requestFilter = { urls: WEB_REQUEST_URLS };
const armedTabIds = new Set<number>();
const closedTabIds = new Set<number>();
const pendingRequests = new Map<string, PendingResponseEvent>();
const beforeRequestTasks = new Map<string, Promise<void>>();
const tabWriteQueues = new Map<number, Promise<void>>();

let hydrateArmedTabsPromise: Promise<void> | undefined;

const hydrateArmedTabs = (): Promise<void> => {
  if (!hydrateArmedTabsPromise) {
    hydrateArmedTabsPromise = chrome.storage.session
      .get(ARMED_TABS_STORAGE_KEY)
      .then((stored) => {
        for (const tabId of readArmedTabIds(stored[ARMED_TABS_STORAGE_KEY])) {
          armedTabIds.add(tabId);
        }
      })
      .catch((error: unknown) => {
        console.error("Response Inspector could not restore armed tabs.", error);
      });
  }

  return hydrateArmedTabsPromise;
};

const persistArmedTabs = (): Promise<void> =>
  chrome.storage.session.set({
    [ARMED_TABS_STORAGE_KEY]: [...armedTabIds].sort((left, right) => left - right),
  });

const armTab = async (tabId: number): Promise<void> => {
  await hydrateArmedTabs();
  closedTabIds.delete(tabId);
  armedTabIds.add(tabId);
  await persistArmedTabs();
};

const getCapturedEvents = async (tabId: number) => {
  const key = captureStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return readCapturedEvents(stored[key]);
};

const appendCapture = (
  tabId: number,
  event: ReturnType<typeof completeResponseEvent>,
): Promise<void> => {
  if (closedTabIds.has(tabId)) {
    return Promise.resolve();
  }

  const previousWrite = tabWriteQueues.get(tabId) ?? Promise.resolve();
  const storeCapture = async (): Promise<void> => {
    if (closedTabIds.has(tabId)) {
      return;
    }

    const key = captureStorageKey(tabId);
    const stored = await chrome.storage.session.get(key);
    if (closedTabIds.has(tabId)) {
      return;
    }

    await chrome.storage.session.set({
      [key]: appendCapturedEvent(stored[key], event),
    });
  };
  const write = previousWrite.then(storeCapture, storeCapture);

  tabWriteQueues.set(tabId, write);
  void write.then(
    () => {
      if (tabWriteQueues.get(tabId) === write) {
        tabWriteQueues.delete(tabId);
      }
    },
    (error: unknown) => {
      console.error("Response Inspector could not save a capture.", error);
      if (tabWriteQueues.get(tabId) === write) {
        tabWriteQueues.delete(tabId);
      }
    },
  );

  return write;
};

const rememberPendingRequest = async (details: unknown): Promise<void> => {
  if (!isRecord(details) || !isResponseEventRequest(details)) {
    return;
  }

  await hydrateArmedTabs();
  if (
    typeof details.tabId !== "number" ||
    closedTabIds.has(details.tabId) ||
    !armedTabIds.has(details.tabId)
  ) {
    return;
  }

  const pending = capturePendingResponseEvent(details);
  if (!pending) {
    return;
  }

  pendingRequests.set(pending.requestId, pending);
  await chrome.storage.session.set({
    [pendingStorageKey(pending.requestId)]: pending,
  });
};

const takePendingRequest = async (
  requestId: string,
): Promise<PendingResponseEvent | undefined> => {
  const key = pendingStorageKey(requestId);
  let pending = pendingRequests.get(requestId);

  if (!pending) {
    const stored = await chrome.storage.session.get(key);
    if (isPendingResponseEvent(stored[key])) {
      pending = stored[key];
    }
  }

  pendingRequests.delete(requestId);
  await chrome.storage.session.remove(key);
  return pending;
};

const finishRequest = async (
  details: unknown,
  networkError?: string,
): Promise<void> => {
  if (!isRecord(details) || typeof details.requestId !== "string") {
    return;
  }

  await beforeRequestTasks.get(details.requestId)?.catch(() => undefined);
  const pending = await takePendingRequest(details.requestId);
  if (!pending || closedTabIds.has(pending.tabId)) {
    return;
  }

  await appendCapture(
    pending.tabId,
    completeResponseEvent(pending, details, networkError),
  );
};

const reportBackgroundError = (error: unknown): void => {
  console.error("Response Inspector background task failed.", error);
};

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isRecord(details) || typeof details.requestId !== "string") {
      return;
    }

    const task = rememberPendingRequest(details);
    beforeRequestTasks.set(details.requestId, task);
    void task.then(
      () => {
        if (beforeRequestTasks.get(details.requestId as string) === task) {
          beforeRequestTasks.delete(details.requestId as string);
        }
      },
      (error: unknown) => {
        reportBackgroundError(error);
        if (beforeRequestTasks.get(details.requestId as string) === task) {
          beforeRequestTasks.delete(details.requestId as string);
        }
      },
    );
  },
  requestFilter,
  ["requestBody"],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    void finishRequest(details).catch(reportBackgroundError);
  },
  requestFilter,
  ["responseHeaders"],
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const error =
      isRecord(details) && typeof details.error === "string"
        ? details.error
        : "Network request failed";
    void finishRequest(details, error).catch(reportBackgroundError);
  },
  requestFilter,
);

const readTabId = (message: UnknownRecord): number | undefined =>
  typeof message.tabId === "number" &&
  Number.isInteger(message.tabId) &&
  message.tabId >= 0
    ? message.tabId
    : undefined;

const handleMessage = async (message: unknown): Promise<UnknownRecord> => {
  if (!isRecord(message) || typeof message.type !== "string") {
    return { error: "Invalid extension message.", ok: false };
  }

  const tabId = readTabId(message);
  if (tabId === undefined) {
    return { error: "No active browser tab was found.", ok: false };
  }

  if (message.type === "arm-tab") {
    await armTab(tabId);
    return { events: await getCapturedEvents(tabId), ok: true };
  }

  if (message.type === "reload-tab") {
    await armTab(tabId);
    await chrome.tabs.reload(tabId);
    return { ok: true };
  }

  if (message.type === "clear-tab") {
    await tabWriteQueues.get(tabId)?.catch(() => undefined);
    await chrome.storage.session.remove(captureStorageKey(tabId));
    return { ok: true };
  }

  return { error: "Unknown extension message.", ok: false };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(
    sendResponse,
    (error: unknown) => {
      sendResponse({
        error: error instanceof Error ? error.message : "Extension task failed.",
        ok: false,
      });
    },
  );
  return true;
});

const removeTabState = async (tabId: number): Promise<void> => {
  closedTabIds.add(tabId);
  await hydrateArmedTabs();
  armedTabIds.delete(tabId);

  await Promise.allSettled(beforeRequestTasks.values());
  await tabWriteQueues.get(tabId)?.catch(() => undefined);
  for (const [requestId, pending] of pendingRequests) {
    if (pending.tabId === tabId) {
      pendingRequests.delete(requestId);
    }
  }

  const stored = await chrome.storage.session.get(null);
  const pendingKeys = Object.entries(stored)
    .filter(([, value]) => isPendingResponseEvent(value) && value.tabId === tabId)
    .map(([key]) => key);

  await Promise.all([
    persistArmedTabs(),
    chrome.storage.session.remove([captureStorageKey(tabId), ...pendingKeys]),
  ]);
};

chrome.tabs.onRemoved.addListener((tabId) => {
  closedTabIds.add(tabId);
  void removeTabState(tabId).catch(reportBackgroundError);
});

void hydrateArmedTabs();
