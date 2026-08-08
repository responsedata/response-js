# Response JavaScript SDKs

Open-source JavaScript SDKs and hosted browser script for Response traffic
analytics. The private Response application is maintained in a separate
repository; this repository communicates with it through the collector
contract.

## Repository layout

- [`packages/browser`](packages/browser) publishes `@responsedata/browser`.
- [`packages/server`](packages/server) publishes the framework-independent
  `@responsedata/server` core used by server adapters.
- [`packages/next`](packages/next) publishes `@responsedata/nextjs`.
- [`apps/cdn`](apps/cdn) builds and deploys the hosted browser script. It is an
  application workspace, not an npm package.
- [`apps/chrome-extension`](apps/chrome-extension) builds the narrowly scoped
  Response Inspector toolbar popup for Chrome.
- [`docs/collector-api.md`](docs/collector-api.md) defines the API
  boundary between these public SDKs and the private collector.

## Installation

For Next.js applications:

```sh
npm install @responsedata/nextjs
```

```tsx
import { ResponseAnalytics } from "@responsedata/nextjs";

<ResponseAnalytics clientId="YOUR_PUBLIC_CLIENT_ID" />
```

To collect incoming Next.js server requests as well, create a private server
token in Response and add a Proxy beside the `app` or `pages` directory
(`proxy.ts` at the root, or `src/proxy.ts` for a `src` layout):

```sh
RESPONSE_SERVER_ID=YOUR_PRIVATE_SERVER_ID
```

```ts
// proxy.ts
import { createResponseProxy } from "@responsedata/nextjs/server";

export const proxy = createResponseProxy();
```

The browser client ID is safe to expose. The server token belongs to the same
Response project but must remain server-only and must not be passed to browser
code.

For other bundled browser applications:

```sh
npm install @responsedata/browser
```

```ts
import { trackPageView } from "@responsedata/browser";

trackPageView({ clientId: "YOUR_PUBLIC_CLIENT_ID" });
```

For HTML and CMS sites, use the hosted script:

```html
<script
  defer
  src="https://cdn.response.sh/browser.js"
  data-client-id="YOUR_PUBLIC_CLIENT_ID">
</script>
```

Production installations may pin a release such as
`https://cdn.response.sh/0.1.0/browser.js`.

Sites with a Content Security Policy must allow `https://cdn.response.sh` in
`script-src` and `https://www.response.sh` in `connect-src`.

## Development

```sh
pnpm install
pnpm test
```

`pnpm build` creates all three npm package outputs, the CDN file under
`apps/cdn/dist`, and the load-unpacked Chrome extension under
`apps/chrome-extension/dist`. No sibling checkout of the private Response
application is required.

## Releasing

The three public npm packages stay on the same version, and the CDN derives its
version from `@responsedata/browser`. Create a patch release with one command:

```sh
pnpm release
```

Use `pnpm release minor` or `pnpm release major` for those release types. The
command requires a clean `main` synchronized with `origin/main`; it bumps all
npm package versions, runs the tests and CDN upload dry-run, commits, tags, and
atomically pushes the release. The tag triggers
[the release workflow](.github/workflows/publish-sdk.yml), which verifies the
tag, publishes missing npm versions, then uploads immutable and rolling CDN
objects.

Before the first automated release, configure the Cloudflare R2 bucket and
trusted publishing for packages that already exist by following
[`apps/cdn/README.md`](apps/cdn/README.md).

### First release of a new npm package

npm does not allow trusted publishing to be configured until a package exists.
When `pnpm release` finds an approved new package such as
`@responsedata/server`, it therefore publishes only that package once from the
local release tag before pushing the tag. Log in first:

```sh
npm login --auth-type=web --registry https://registry.npmjs.org
pnpm release
```

The command checks npm authentication before changing versions, tests and tags
the exact release, runs a Git push preflight, bootstraps the new package with
public access, and configures `publish-sdk.yml` as its trusted publisher.
Complete npm's 2FA prompt when asked. The release tag is pushed only after
those steps succeed; GitHub Actions then skips the already-published package
version and publishes the remaining packages and CDN assets normally.

This bootstrap requires npm 11.15 or newer. Run
`npm logout --registry https://registry.npmjs.org` afterward if the local
session should not remain available. The one locally bootstrapped version does
not have provenance; later versions receive provenance automatically through
trusted publishing. npm may briefly hold a new package for publish-time scanning;
the release flow recognizes that accepted state, waits for availability, and
does not republish it.

### Local release fallback

Use the local fallback only when a release tag was pushed but the automated
release did not finish. Authenticate interactively so no permanent npm write
token needs to be stored in the repository:

```sh
npm login --auth-type=web --registry https://registry.npmjs.org
pnpm exec wrangler login
pnpm release:publish-local:dry-run v0.1.8
pnpm release:publish-local v0.1.8
```

Pass the release tag that needs to be recovered. The command creates a
temporary detached checkout of that exact tag, uses a frozen install, runs the
complete test suite, publishes only npm package versions that are still
missing, and uploads the matching versioned and rolling CDN assets. It is safe
to rerun after a partial release and refuses to publish an older version over a
newer npm or rolling CDN release. Local emergency npm publishes do not include
the provenance generated by the normal trusted publishing workflow.

Run `npm logout --registry https://registry.npmjs.org` afterward if the npm
session should not remain available on the machine. Wrangler can also use a
temporary `CLOUDFLARE_API_TOKEN` scoped to this account with only R2 write
access instead of an interactive login.

## License

MIT
