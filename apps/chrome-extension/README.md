# Response Inspector

Response Inspector is a small Manifest V3 Chrome extension for checking browser
analytics delivery during development. It adds a **Response** panel to Chrome
DevTools and keeps captured page views in memory only while that panel is open.

The panel watches `POST https://www.response.sh/api/events` requests. For local
development it also accepts `/api/events` on `localhost`, `127.0.0.1`, and
`[::1]`, with any port.

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
5. Open DevTools on the site being tested and select **Response**.
6. Keep the panel open and reload the page.

Each row shows the event path, browser SDK version, request time, HTTP status,
and delivery result. Expand a row to view the request payload. **Clear** removes
the current in-memory list.

## Delivery results

- **Stored**: the collector returned `Response-Event-Result: stored`.
- **Not stored**: the collector returned
  `Response-Event-Result: not-stored`.
- **Network error**: Chrome reported no HTTP response.
- **Unverified**: the collector responded without a recognized receipt header.

The extension does not authenticate or read data back from Response. A Stored
receipt confirms the collector accepted and persisted the request; all other
responses remain explicit rather than being treated as successful.

## Development

```sh
pnpm --filter @responsedata/chrome-extension build
pnpm --filter @responsedata/chrome-extension test
```

After rebuilding, use the reload button for Response Inspector on
`chrome://extensions`, then reopen DevTools.
