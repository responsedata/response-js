# Collector API v1 compatibility contract

The public JavaScript SDKs send observations to the private Response collector
at `POST https://www.response.sh/api/events`.

The JSON payload is sent as `text/plain;charset=UTF-8` to avoid an unnecessary
CORS preflight and currently contains:

```json
{
  "capabilities": ["agent_check_in_explanation"],
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

`capabilities` is optional. The current SDK includes
`agent_check_in_explanation` while it can render the personalized,
explanation-only interaction. The collector still accepts the previous
`agent_check_in` capability but does not issue its legacy form. Older SDKs that
omit the field retain their existing fire-and-forget behavior.

The collector normally returns `204 No Content`. It accepts and records a visit
only when the request user agent contains one of the supported user-triggered
agent products:

- `Agent/AmazonBuyForMe`, `Amzn-User`, `ChatGPT-User`, `Claude-User`, `Devin`
- `DuckAssistBot`, `FirecrawlAgent`, `Google-Agent`, `Google-GeminiNotebook`
- `Google-NotebookLM`, `Kimi-User`, `Meta-ExternalFetcher`, `MistralAI-User`
- `Perplexity-User`, `QwenCode`, `Shap-User`, and `TwinAgent`

Browser automation signals, generic crawler user agents, and guessed product
names do not qualify. MiniMax and Exa are intentionally absent because neither
publishes a stable outbound product user-agent. `FirecrawlAgent` is recognized
only when a request actually uses that identity; Firecrawl can also use
ordinary or custom browser user-agents.

This is cooperative product recognition, not cryptographic authentication: a
user-agent value can be spoofed. It also applies only when the visitor executes
the host page's JavaScript and allows the SDK request; fetch-only agents cannot
receive a client-rendered interaction.

When a recognized agent declares check-in support, the collector returns `200`
with a server-derived display name:

```json
{
  "interaction": {
    "agentName": "ChatGPT",
    "id": "uuid",
    "type": "agent_check_in"
  }
}
```

The SDK does not pre-gate from client-side heuristics. It renders the required,
personalized check-in only after the collector issues an interaction. The form
resolves at `POST https://www.response.sh/api/interactions/{id}`, and the page
remains inaccessible until the endpoint accepts an explanation:

```json
{
  "resolution": "submitted",
  "explanation": "Researching font-generation tools for a user."
}
```

The agent identity is never accepted from this payload. It is re-derived from
the original event request before the explanation is stored. The collector
temporarily accepts the previous SDK's `agentName` and `message` submission
shape during rollout, ignores the supplied name, and stores `message` as the
explanation. Human bypass resolutions are not accepted. Resolution payloads are
also sent as `text/plain;charset=UTF-8`.

For the lifetime of an issued interaction, a native modal makes the rest of the
document non-interactive. An opaque full-page surface and dialog-scoped style
visually hide other top-level body content, including content appended later.
Removing the accepted dialog removes that style without mutating the host
application's DOM state. This is a client-side interaction gate, not a
content-security boundary: the document and its resources have already been
delivered and remain inspectable. A true content gate must run in the host
website's server or edge middleware before the full response is sent.

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
