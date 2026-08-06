# Collector API v1 compatibility contract

The public JavaScript SDKs send observations to the private Response collector
at `POST https://www.response.sh/api/events`.

The JSON payload is sent as `text/plain;charset=UTF-8` to avoid an unnecessary
CORS preflight and currently contains:

```json
{
  "capabilities": ["agent_check_in"],
  "clientId": "rsp_...",
  "eventId": "uuid",
  "path": "/page",
  "referrerOrigin": "https://example.com",
  "sdkVersion": "0.1.0",
  "signals": {
    "automationArtifactsDetected": false,
    "webdriver": true
  },
  "version": 1
}
```

`referrerOrigin` may be `null`. Query parameters, fragments, page contents,
form values, cookies, and local-storage identifiers are not sent.
`automationArtifactsDetected` reports the presence of known automation globals
or document attributes without sending their names.

Previously released SDKs may also send the optional boolean
`cdpRuntimeDetected`. The collector accepts that legacy field for version 1
compatibility but discards it and does not use it for classification.

`capabilities` is optional. The current SDK includes `agent_check_in` while it
can render an interaction. Older SDKs omit the field and retain their existing
fire-and-forget behavior.

The collector normally returns `204 No Content`. When an automated visit should
check in and the SDK declares support, it returns `200` with:

```json
{
  "interaction": {
    "id": "uuid",
    "type": "agent_check_in"
  }
}
```

When client-side automation evidence is already available, the SDK immediately
renders a required pending modal while the collector evaluates the request. It
replaces that modal with the fixed check-in form when the collector returns an
interaction, or removes it when the request is declined. The form resolves at
`POST https://www.response.sh/api/interactions/{id}`. The page remains
inaccessible until that endpoint accepts either resolution. A submitted
check-in is:

```json
{
  "resolution": "submitted",
  "agentName": "ChatGPT",
  "message": "Researching font-generation tools for a user."
}
```

The explicit human escape hatch sends `{ "resolution": "human_bypass" }`.
Resolution payloads are also sent as `text/plain;charset=UTF-8`.

## Compatibility policy

- The private collector must continue accepting valid version 1 requests from
  previously released SDKs.
- New optional request fields may be added without changing the protocol
  version only after the collector's allowlist accepts them. Existing SDKs may
  continue omitting those fields, and existing fields must not change meaning.
- A required field or semantic change needs a new protocol version. Deploy the
  collector so it accepts both versions before publishing an SDK that sends the
  new version.
- Collector delivery remains asynchronous unless the server issues a supported
  interaction. Unknown interaction types do not affect the host page. Once an
  agent check-in is issued, failed resolution delivery keeps the modal open so
  the visitor can retry instead of granting access without a recorded result.
- Private application UI, database, and internal API changes do not require an
  SDK release unless they alter this collector contract.

This backend-first sequence prevents separate repositories and deployments
from requiring an atomic release.
