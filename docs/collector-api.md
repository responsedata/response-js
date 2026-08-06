# Collector API

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

The collector records every valid observation and normally returns `204 No
Content`. Delivery is fire-and-forget: the SDK does not parse the response or
render any collector-controlled interface. Traffic classification happens in
Response from the stored request context and is not decided by the SDK.

## Coverage

The browser SDK observes visits only when the page's JavaScript executes and
the collector request is allowed. That includes automated browsers and agents
that render the instrumented page. It does not observe fetch-only crawlers,
training crawlers, or bots that do not execute the SDK. Complete HTTP-request
coverage requires a future server or edge integration on the instrumented
site.

## Rollout

This contract intentionally does not accept the earlier interaction-capable
payload. Release the browser and Next.js packages under a new version and
upload the matching rolling CDN asset before deploying the strict collector.
The Response application must then update its exact `@responsedata/nextjs`
dependency and lockfile to that release. Older npm integrations must upgrade;
their legacy payloads receive `400 Bad Request` after the collector changes.
