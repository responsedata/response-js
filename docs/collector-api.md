# Collector API

Response has separate collector contracts for public browser observations and
authenticated server requests. Both resolve to the same Response project, but
they use different credentials and remain separate observations.

## Browser page views

The public JavaScript SDKs send page-view observations to the private Response
collector at `POST https://www.response.sh/api/events`.

The JSON payload is sent as `text/plain;charset=UTF-8` to avoid an unnecessary
CORS preflight and contains:

```json
{
  "clientId": "rsp_...",
  "eventId": "uuid",
  "sessionId": "uuid",
  "path": "/page",
  "referrerOrigin": "https://example.com",
  "sdkVersion": "1.2.3",
  "signals": {
    "automationArtifactsDetected": false,
    "webdriver": true
  }
}
```

`eventId` identifies one page view. `sessionId` groups page views into a
sessionStorage-derived browser session for the same Response client. With
working `sessionStorage`, reloads and client-side navigations keep the session;
the in-memory fallback lasts only for the current SDK load. New tabs normally
start a new session, but browsers can copy session storage into opener-created
or duplicated tabs. These IDs are useful visit groupings, not guaranteed tab
identities, people, or cross-device unique visitors. `sdkVersion` is filled in
with the installed SDK package version.

The SDK creates no session ID when collection is blocked by Global Privacy
Control, Do Not Track, invalid configuration, or an invalid path. It also
suppresses a repeated call for the same client and path within one second.

`referrerOrigin` may be `null`. Query parameters, fragments, page contents,
form values, cookies, and persistent cross-tab identifiers are not sent.
`automationArtifactsDetected` reports the presence of known automation globals
or document attributes without sending their names.

The collector normally returns `204 No Content` and includes a
`Response-Event-Result` response header. `stored` means this request inserted
the event; `not-stored` means it was deterministically rejected or ignored. An
indeterminate collector failure returns an error status without a result
header. Delivery remains fire-and-forget: the SDK does not parse the response
or render any collector-controlled interface. Response Inspector uses this
receipt to report storage without changing SDK behavior. Traffic classification
happens in Response from the stored request context and is not decided by the
SDK.

## Server requests

The Next.js server entry selects page-like requests and delegates normalized
delivery to the framework-independent `@responsedata/server` core. The core
sends observations to `POST https://www.response.sh/api/requests` with the
project's private server token:

```http
Authorization: Bearer rsp_server_...
Content-Type: application/json
```

The JSON payload contains:

```json
{
  "requestId": "uuid",
  "requestAt": "2026-08-06T20:10:00.000Z",
  "host": "docs.example.com",
  "method": "GET",
  "path": "/docs/install",
  "referrerOrigin": "https://search.example",
  "sdkVersion": "1.2.3",
  "source": "nextjs",
  "userAgent": "ExampleBot/1.0",
  "network": {
    "asn": 16509,
    "city": "Seattle",
    "country": "US",
    "organization": "Amazon.com, Inc.",
    "regionCode": "WA",
    "source": "cloudflare"
  },
  "headers": {
    "acceptLanguage": "en-US",
    "secChUa": "...",
    "secChUaMobile": "?0",
    "secChUaPlatform": "macOS",
    "secFetchDest": "document",
    "secFetchMode": "navigate",
    "secFetchSite": "cross-site"
  }
}
```

The server token authenticates and identifies the project, so the payload does
not repeat a client or project ID. `sdkVersion` identifies the installed server
core version, while `source` identifies the framework adapter. `referrerOrigin`
may be `null`, and optional safe header properties are omitted when absent.
When available on the original incoming request, the payload also includes
bounded `cloudflare`, `network`, and `transport` objects. These preserve coarse
geolocation, ASN/organization, bot-management, TLS, protocol, and connection
evidence without retaining the visitor IP. The collector deliberately does not
use Cloudflare metadata from the later SDK-to-collector POST because that
describes the reporting application server, not the original visitor.

Query strings, fragments, request bodies, cookies, authorization values,
coordinates, postal codes, and IP addresses are never included. Delivery is
scheduled with the Next.js request lifecycle and always fails open.

## Coverage

The browser SDK observes visits only when the page's JavaScript executes and
the collector request is allowed. That includes automated browsers and agents
that render the instrumented page. It does not observe fetch-only crawlers,
training crawlers, or bots that do not execute the SDK.

The Next.js server integration observes page-like GET and HEAD requests that
reach the application's Proxy, including fetch-only crawlers. It excludes
common frontend assets such as scripts, styles, images, fonts, and media, along
with API routes, browser fetch/XHR subrequests, JSON-only requests,
framework-internal requests, and prefetches. Requests without browser-only
headers remain eligible so direct crawlers are preserved, as are text discovery
resources such as robots files, sitemaps, and `llms.txt`. Requests served or
blocked before Next.js are outside its coverage. Server requests and browser
page views are reported separately and are not added together as visits.

## Rollout

Release the browser, server core, and Next.js packages under a new version and
upload the matching rolling CDN asset before deploying collector changes that
depend on a new SDK contract. The Response application must then update its
exact `@responsedata/nextjs` dependency and lockfile to that release; the server
core is installed transitively.
