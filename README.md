# Response JavaScript SDKs

Open-source JavaScript SDKs and hosted browser script for Response agent
analytics. The private Response application is maintained in a separate
repository; this repository communicates with it only through the versioned
collector contract.

## Repository layout

- [`packages/browser`](packages/browser) publishes `@responsedata/browser`.
- [`packages/next`](packages/next) publishes `@responsedata/nextjs`.
- [`apps/cdn`](apps/cdn) builds and deploys the hosted browser script. It is an
  application workspace, not an npm package.
- [`docs/collector-api-v1.md`](docs/collector-api-v1.md) defines the stable API
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

`pnpm build` creates both npm package outputs and the CDN file under
`apps/cdn/dist`. No sibling checkout of the private Response application is
required.

## Releasing

The two public npm packages stay on the same version, and the CDN derives its
version from `@responsedata/browser`. Prepare and validate a patch release with:

```sh
pnpm sdk:version patch
pnpm test
pnpm sdk:publish:dry-run
pnpm cdn:deploy:dry-run
git add .
git commit -m "Release Response JS v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

Use the version written by `pnpm sdk:version` in the commit message and tag.
The tag triggers [the release workflow](.github/workflows/publish-sdk.yml),
which verifies the tag, tests all workspaces, publishes missing npm versions,
then uploads immutable and rolling CDN objects.

Before the first automated release, configure npm trusted publishing and the
Cloudflare R2 bucket by following [`apps/cdn/README.md`](apps/cdn/README.md).

## License

MIT
