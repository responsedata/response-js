type ChromeStorageChange = {
  newValue?: unknown;
  oldValue?: unknown;
};

type ChromeWebRequestFilter = {
  urls: string[];
};

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    onChanged: {
      addListener(
        callback: (
          changes: Record<string, ChromeStorageChange>,
          areaName: string,
        ) => void,
      ): void;
    };
    session: {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      remove(keys: string | string[]): Promise<void>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    onRemoved: {
      addListener(callback: (tabId: number) => void): void;
    };
    query(queryInfo: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<Array<{ id?: number }>>;
    reload(tabId: number): Promise<void>;
  };
  webRequest: {
    onBeforeRequest: {
      addListener(
        callback: (details: unknown) => void,
        filter: ChromeWebRequestFilter,
        extraInfoSpec: string[],
      ): void;
    };
    onCompleted: {
      addListener(
        callback: (details: unknown) => void,
        filter: ChromeWebRequestFilter,
        extraInfoSpec: string[],
      ): void;
    };
    onErrorOccurred: {
      addListener(
        callback: (details: unknown) => void,
        filter: ChromeWebRequestFilter,
      ): void;
    };
  };
};
