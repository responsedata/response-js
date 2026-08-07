# @responsedata/nextjs

The Next.js integration for Response traffic analytics. It can observe incoming
server requests and rendered browser page views. Each integration is optional
and has its own import path.

The server entry delegates its framework-independent privacy and delivery
logic to `@responsedata/server`, which is installed automatically as a package
dependency. Applications still install only `@responsedata/nextjs`.

```sh
npm install @responsedata/nextjs
```

## Server requests

Create a private server token in Response and add it to your environment:

```sh
RESPONSE_SERVER_ID=YOUR_PRIVATE_SERVER_ID
```

Then add a Next.js Proxy beside the `app` or `pages` directory. Use `proxy.ts`
at the project root, or `src/proxy.ts` when that directory is under `src`:

```ts
// proxy.ts (Next.js 16+)
import { createResponseProxy } from "@responsedata/nextjs/server";

export const proxy = createResponseProxy();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

For Next.js 14 or 15, put `middleware.ts` in the same location and export it as
`middleware` instead of `proxy`.

Delivery runs through Next.js `waitUntil`, so it does not delay or alter the
site response. The integration records queryless GET and HEAD paths, the
original visitor user agent and referrer origin, and a small allowlist of safe
browser headers. It automatically reads Vercel's coarse geolocation headers.
It never sends query strings, bodies, cookies, authorization headers,
coordinates, postal codes, or IP addresses. Common frontend assets (scripts,
styles, images, fonts, and media), Next.js internal requests, and prefetches are
ignored.

OpenNext Cloudflare reconstructs the `NextRequest` without its Workers-only
`cf` property. To include the original request's Cloudflare bot-management,
network, location, and transport evidence, supply it from the request context:

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createResponseProxy } from "@responsedata/nextjs/server";

export const middleware = createResponseProxy({
  getCloudflareProperties: () => getCloudflareContext().cf,
});
```

`RESPONSE_SERVER_ID` is private and must never use the `NEXT_PUBLIC_` prefix. For a
local collector, pass an override:

```ts
export const proxy = createResponseProxy({
  collectorEndpoint: "http://localhost:3000/api/requests",
});
```

If the application already has a Proxy, call the Response handler from it:

```ts
import { createResponseProxy } from "@responsedata/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const responseProxy = createResponseProxy();

export function proxy(request: NextRequest, event: NextFetchEvent) {
  responseProxy(request, event);
  // Keep the application's existing proxy logic here.
}
```

## Browser page views

Add the client component to your root layout:

```tsx
import { ResponseAnalytics } from "@responsedata/nextjs";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ResponseAnalytics clientId="YOUR_PUBLIC_CLIENT_ID" />
      </body>
    </html>
  );
}
```

The client ID is public, write-only routing information and is separate from
the private server token. Configure the site's exact origin and enable
collection in Response before installing the component. For a local collector,
pass `collectorEndpoint="http://localhost:3000/api/events"`. Remote collectors
must use HTTPS.
