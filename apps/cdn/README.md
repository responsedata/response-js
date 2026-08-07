# Response CDN application

This non-publishable workspace produces the browser script served from
`cdn.response.sh`. The same source and version are used by the npm packages.
The script passively sends page views with a per-client,
sessionStorage-derived browser session ID. It does not parse collector
responses or render UI on the host page.

## Asset policy

- `/browser.js` is the convenient rolling URL. It has a short browser cache.
- `/<version>/browser.js` is immutable and retained for rollback and pinned
  installations.
- Both assets are uploaded from the same build artifact.
- The script always sends events to `https://www.response.sh/api/events`; the
  collector is not customer-configurable and is not derived from the CDN
  hostname.

## One-time Cloudflare setup

1. In the Cloudflare dashboard, enable **R2 Object Storage** for the account
   that owns `response.sh`.
2. Create a bucket named `response-js-cdn`. The equivalent CLI command is
   `pnpm exec wrangler r2 bucket create response-js-cdn` after authenticating
   Wrangler.
3. Open the bucket, choose **Settings**, then **Custom Domains**, and connect
   `cdn.response.sh`. Use this flow instead of manually creating a CNAME so
   Cloudflare can bind the bucket and provision TLS correctly.
4. From Cloudflare's **Account API Tokens** page, create a custom API token
   scoped to this account with **Workers R2 Storage: Edit** permission (shown as
   **Write** in some newer interfaces). Use the Cloudflare API token value, not
   the S3-style access key and secret from **Manage R2 API Tokens**.
5. In the public `responsedata/response-js` GitHub repository, add an Actions
   secret named `CLOUDFLARE_API_TOKEN`. The non-secret account ID is committed
   in the repository's `wrangler.jsonc`.
6. Configure `publish-sdk.yml` as the npm trusted publisher for
   `@responsedata/browser`, `@responsedata/server`, and `@responsedata/nextjs`.
   Trust is configured separately for each package. For a new package, the
   authenticated release bootstrap described in the root README publishes it
   once and adds this setting; npm requires the package to exist first.

The upload script writes `Content-Type` and `Cache-Control` metadata on each R2
object. Classic cross-origin `<script>` tags do not require an R2 CORS policy.
Add one later only if browsers will fetch these objects through JavaScript or
ES module imports.

Official references:

- [Public R2 buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Upload R2 objects with Wrangler](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Wrangler authentication in GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

## Local validation

```sh
pnpm cdn:test
pnpm cdn:upload:dry-run
```

To upload the assets manually after Cloudflare credentials are exported:

```sh
pnpm cdn:upload
```

Normal production releases should use a `vX.Y.Z` Git tag so npm and CDN
artifacts are published together by GitHub Actions.
