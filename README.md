# Response JavaScript SDKs

The open-source JavaScript SDKs for Response agent analytics. This repository
publishes `@responsedata/browser` and `@responsedata/nextjs` from one shared
TypeScript implementation and builds the hosted browser script used by
response.sh.

## Packages

- [`@responsedata/browser`](packages/browser) is the framework-independent
  browser SDK.
- [`@responsedata/nextjs`](packages/next) adds initial-page and client-side
  route tracking for Next.js.
- [`@responsedata/browser-cdn`](packages/cdn) is a private workspace that builds
  the rolling and versioned hosted scripts; it is not published to npm.

## Installation

For Next.js applications:

```sh
npm install @responsedata/nextjs
```

```tsx
import { ResponseAnalytics } from "@responsedata/nextjs";

<ResponseAnalytics clientId="YOUR_PUBLIC_CLIENT_ID" />
```

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
  src="https://www.response.sh/sdk/browser.js"
  data-client-id="YOUR_PUBLIC_CLIENT_ID">
</script>
```

See the individual package READMEs for API and privacy details.

## Development

```sh
pnpm install
pnpm test
```

`pnpm sdk:build` creates both npm package outputs and the CDN files under
`packages/cdn/dist`. When this repository and the private `response` repository
are sibling directories, update the app's committed hosted assets with:

```sh
pnpm sdk:build
pnpm --dir ../response sdk:sync
```

## Publishing

The two public packages and private CDN workspace stay on the same version.
For a release:

```sh
pnpm sdk:version patch
pnpm sdk:test
pnpm sdk:publish:dry-run
```

Commit the source and version changes together. A push to `main` automatically
runs `.github/workflows/publish-sdk.yml`. The workflow publishes packages in
workspace dependency order and rejects SDK source changes without a matching
version bump.

The first release must be bootstrapped by an npm owner of the `@responsedata`
scope:

```sh
npm login
pnpm sdk:publish
```

Then configure `publish-sdk.yml` as the trusted GitHub Actions publisher for
both npm packages with:

- Organization or user: `responsedata`
- Repository: `response-js`
- Workflow filename: `publish-sdk.yml`
- Allowed action: `npm publish`

The workflow uses short-lived OIDC credentials and does not require an
`NPM_TOKEN` secret.

## License

MIT
