# @responsedata/server

The framework-independent server core for Response traffic analytics. It
normalizes and delivers privacy-limited request observations for framework
adapters such as `@responsedata/nextjs`.

Most applications should install a framework integration instead of using this
package directly. Adapter authors pass a request-like object with a URL,
method, and header reader:

```ts
import {
  isPageRequestCandidate,
  trackServerRequest,
} from "@responsedata/server";

if (isPageRequestCandidate(request)) {
  const delivery = trackServerRequest({
    request,
    source: "nextjs",
  });

  if (delivery) {
    await delivery;
  }
}
```

`isPageRequestCandidate` applies framework-independent request signals. It
accepts GET and HEAD requests, document navigations, and requests that omit
browser-only headers so direct crawlers remain observable. It rejects common
static assets, prefetches and prerenders, browser subresource requests, and
requests that accept only JSON. Framework adapters compose this helper with
their routing rules; `trackServerRequest` itself remains a normalization and
delivery primitive and does not apply page classification automatically.

The private token defaults to the server-only `RESPONSE_SERVER_ID` environment
variable. The core accepts only GET and HEAD requests, removes query strings
and fragments, reduces referrers to origins, and sends only an explicit
allowlist of bounded headers. When the original request exposes Cloudflare
metadata, it also sends bounded bot-management, coarse location, ASN, and
transport evidence. On Vercel, it sends the platform's coarse city, region,
country, continent, and timezone headers. It never sends bodies, cookies,
authorization headers, coordinates, postal codes, or IP addresses. Delivery
always fails open.

The Response collector must recognize the adapter's `source` value. End-user
applications should use a published framework adapter so this value and the
request lifecycle are handled correctly.
