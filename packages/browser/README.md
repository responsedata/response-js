# @responsedata/browser

The framework-independent browser SDK for Response agent analytics.

```sh
npm install @responsedata/browser
```

```ts
import { trackPageView } from "@responsedata/browser";

trackPageView({
  clientId: "YOUR_PUBLIC_CLIENT_ID",
});
```

`trackPageView` strips query strings and fragments, sends no credentials, and
honors Global Privacy Control and Do Not Track. Importing the package is safe
during server rendering; browser globals are accessed only when the function is
called. Custom collectors must use HTTPS, except for loopback development
addresses.

The SDK reports `navigator.webdriver` and the presence of known automation
globals or document attributes as diagnostic booleans. They are not used to
decide whether to show an interaction, and the SDK does not collect matching
names, console contents, page contents, or a browser fingerprint.

When Response recognizes one of its supported self-identifying,
user-triggered agent products, the SDK displays a required native modal using
the server-derived agent name. The agent must briefly explain why it is
visiting before the modal unlocks the page. There is no editable identity field
or human bypass. If delivery fails, the modal stays open and offers a retry. A
completed interaction is not shown again in the same browser tab.

While the server-issued interaction is active, the SDK uses a native modal
dialog to make the rest of the document non-interactive. An opaque full-page
surface and a dialog-scoped stylesheet hide all other top-level body content,
including content appended later. Removing the dialog removes the stylesheet,
so the SDK does not mutate or reconstruct the host application's DOM state.

User-agent recognition is cooperative rather than cryptographic, and this
client-rendered interaction can reach only agents that execute the page's
JavaScript. It cannot prevent HTML, data, or assets from being downloaded or
inspected before the collector responds. Withholding content requires a
server-side or edge-middleware gate on the instrumented website.

## Local interaction preview

From the repository root, run:

```sh
pnpm preview:interaction
```

Then open `http://127.0.0.1:4173`. The preview uses the real browser SDK with
local mock responses and never writes to the Response server. Edit
`packages/browser/src/index.ts` and reload the page to see the latest UI. After
submitting the form, use **Show agent check-in** to open it again.
