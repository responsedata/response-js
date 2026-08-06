# @responsedata/browser

The framework-independent browser SDK for Response traffic analytics.

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

The SDK assigns one random, sessionStorage-derived browser session ID per
Response client. With working `sessionStorage`, it survives reloads and
client-side navigation; an in-memory fallback lasts for the current SDK load.
New tabs normally start a new session, though opener-created or duplicated tabs
can inherit a copied ID. These are visit groupings rather than guaranteed tab
or person identities. Session IDs are created only after privacy and
configuration checks pass.

The SDK reports `navigator.webdriver` and the presence of known automation
globals or document attributes as diagnostic booleans. Response stores each
valid page view and classifies its request context on the server when presenting
analytics. The SDK does not collect matching global names, console contents,
page contents, or a browser fingerprint, and it never renders collector-driven
UI.

Only visits that execute the browser SDK can be observed. Fetch-only crawlers,
training crawlers, and other bots that do not run page JavaScript require a
server or edge integration for coverage.
