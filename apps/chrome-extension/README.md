# Response Inspector

Response Inspector is a small Manifest V3 Chrome extension for checking browser
analytics delivery during development. Click it in the Chrome toolbar to arm
the current tab, reload the page, and inspect the Response requests from the
same toolbar popup.

The extension watches `POST https://www.response.sh/api/events` requests. For
local development it also accepts `/api/events` over HTTP or HTTPS on
`localhost`, `127.0.0.1`, and `[::1]`, with any port.

## Build and load locally

From the `response-js` repository root:

```sh
pnpm install
pnpm --filter @responsedata/chrome-extension build
```

Then:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/chrome-extension/dist`.
5. Open the site being tested and click **Response Inspector** in Chrome's
   Extensions menu. Pin it for easier access if desired.
6. Choose **Reload & capture**.
7. Reopen the popup after the page reloads to see its requests.

Opening the popup arms only the current tab. Capturing continues while the
popup is closed, subject to Chrome's temporary `activeTab` access. The popup
keeps the newest 100 requests for each armed tab in `chrome.storage.session`.
The captures are removed when the tab closes and are never written to
persistent local storage.

Each row shows the event path, browser SDK version, request time, HTTP status,
and delivery result. Expand a row to view the raw request payload. **Clear**
removes the current tab's captured requests.

## Delivery results

- **Stored**: the collector returned a 2xx status and
  `Response-Event-Result: stored`.
- **Not stored**: the collector returned
  `Response-Event-Result: not-stored`.
- **Network error**: Chrome reported no HTTP response.
- **Unverified**: the collector responded without a recognized receipt, or a
  non-2xx response claimed the event was stored.

The extension does not authenticate or read data back from Response. A Stored
receipt confirms the collector accepted and persisted the request; all other
responses remain explicit rather than being treated as successful.

## Permissions

- `activeTab` grants temporary access only after the user opens the popup.
- `webRequest` reads the request body and collector result without blocking or
  modifying either one.
- `storage` keeps per-tab captures for the current browser session.
- Host access is limited to the production Response event endpoint and local
  loopback hosts. There is no `<all_urls>` access, content script, page
  injection, or debugger permission.

## Development

```sh
pnpm --filter @responsedata/chrome-extension build
pnpm --filter @responsedata/chrome-extension test
```

After rebuilding, use the reload button for Response Inspector on
`chrome://extensions`, then reopen the toolbar popup.
