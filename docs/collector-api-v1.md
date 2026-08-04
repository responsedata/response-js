# Collector API v1 compatibility contract

The public JavaScript SDKs send observations to the private Response collector
at `POST https://www.response.sh/api/events`.

The JSON payload is sent as `text/plain;charset=UTF-8` to avoid an unnecessary
CORS preflight and currently contains:

```json
{
  "clientId": "rsp_...",
  "eventId": "uuid",
  "path": "/page",
  "referrerOrigin": "https://example.com",
  "sdkVersion": "0.1.0",
  "signals": {
    "webdriver": true
  },
  "version": 1
}
```

`referrerOrigin` may be `null`. Query parameters, fragments, page contents,
form values, cookies, and local-storage identifiers are not sent.

## Compatibility policy

- The private collector must continue accepting valid version 1 requests from
  previously released SDKs.
- New optional request fields may be added without changing the protocol
  version only after the collector's allowlist accepts them. Existing SDKs may
  continue omitting those fields, and existing fields must not change meaning.
- A required field or semantic change needs a new protocol version. Deploy the
  collector so it accepts both versions before publishing an SDK that sends the
  new version.
- Collector responses are not part of the browser API; SDK delivery remains
  asynchronous and failures must not affect the host page.
- Private application UI, database, and internal API changes do not require an
  SDK release unless they alter this collector contract.

This backend-first sequence prevents separate repositories and deployments
from requiring an atomic release.
