# @responsedata/nextjs

The Next.js integration for Response agent analytics. It tracks the initial
page and App Router client-side pathname changes.

```sh
npm install @responsedata/nextjs
```

Add the component to your root layout:

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

The client ID is public, write-only routing information. Configure the site’s
exact origin and enable collection in Response before installing the component.
For a local collector, pass
`collectorEndpoint="http://localhost:3000/api/events"`. Remote collectors must
use HTTPS.
