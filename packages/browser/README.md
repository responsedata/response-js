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
