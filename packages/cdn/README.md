# Response browser SDK

The Response browser SDK sends one small page observation to the Response
collector. The collector decides whether the observation looks automated and
stores only detected automation.

## Next.js

Install the framework integration:

```sh
npm install @responsedata/nextjs
```

Add the component once to the root layout:

```tsx
import { ResponseAnalytics } from "@responsedata/nextjs";

<ResponseAnalytics clientId="YOUR_PUBLIC_CLIENT_ID" />
```

The component tracks the initial page and subsequent client-side pathname
changes.

## Bundled browser apps

React, Vue, Svelte, and other bundled applications can use the typed browser
package directly:

```sh
npm install @responsedata/browser
```

```ts
import { trackPageView } from "@responsedata/browser";

trackPageView({
  clientId: "YOUR_PUBLIC_CLIENT_ID",
});
```

## HTML and CMS sites

Add the hosted script to every page you want to observe:

```html
<script
  defer
  src="https://www.response.sh/sdk/browser.js"
  data-client-id="YOUR_PUBLIC_CLIENT_ID">
</script>
```

The rolling URL receives updates automatically. After a release, applications
that require a pinned asset can use the versioned form
`https://www.response.sh/sdk/0.1.0/browser.js`.

The client ID is public, write-only routing information rather than a secret.
Each project has one active client ID, and rotating it immediately invalidates
the previous SDK snippet. The collector also requires the page’s exact origin to
appear in the project’s allowed-origin settings and requires data collection to
be enabled.

## Data sent

- Public client and event IDs
- Page path without query parameters or fragments
- Referrer origin
- The browser's `navigator.webdriver` value
- SDK version

The collector derives the User-Agent from the event request. The SDK does not
send cookies, local-storage identifiers, page contents, form values, pointer or
keyboard activity.

Path segments themselves are not redacted in this MVP. Sites should not place
personal data, secrets, or access tokens in URL paths.

## Behavior

- One observation is sent when the script executes.
- Delivery uses an asynchronous request with no credentials.
- Collection failures never affect the host page.
- Global Privacy Control and Do Not Track are honored.
- The hosted script sends once when it executes. Framework integrations can
  track client-side route changes.

Sites with a Content Security Policy must allow `https://www.response.sh` in
both `script-src` and `connect-src`.

The shared TypeScript implementation lives in `packages/browser`. The Next.js
component, browser npm package, rolling CDN script, and versioned CDN script are
all built from that same implementation.

## Building and publishing

This private workspace builds the hosted CDN artifacts under `dist`; it is not
published to npm. Follow the build, app-sync, versioning, and npm publishing
instructions in the repository README.
