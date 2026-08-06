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

The SDK reports `navigator.webdriver` and a small console-serialization probe
for browser instrumentation. The probe sends only a boolean; it does not collect
console contents, page contents, or a browser fingerprint.

When Response identifies likely automated traffic, the SDK displays a required
native modal asking for the agent or service name and its reason for visiting.
The rest of the page remains inaccessible until Response accepts either the
agent check-in or the explicit human bypass. If delivery fails, the modal stays
open and offers a retry. A completed interaction is not shown again in the same
browser tab.

## Local interaction preview

From the repository root, run:

```sh
pnpm preview:interaction
```

Then open `http://127.0.0.1:4173`. The preview uses the real browser SDK with
local mock responses and never writes to the Response server. Edit
`packages/browser/src/index.ts` and reload the page to see the latest UI. After
submitting or bypassing the form, use **Show agent check-in** to open it again.
