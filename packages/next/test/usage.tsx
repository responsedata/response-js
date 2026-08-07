import { ResponseAnalytics } from "@responsedata/nextjs";
import { createResponseProxy } from "@responsedata/nextjs/server";

export const proxy = createResponseProxy({
  collectorEndpoint: "http://localhost:3000/api/requests",
  token: "rsp_server_0123456789abcdefghijklmnopqrstuv",
});

export function RootLayoutIntegration({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ResponseAnalytics
          clientId="rsp_0123456789abcdefghijklmnopqrstuv"
          collectorEndpoint="http://localhost:3000/api/events"
        />
      </body>
    </html>
  );
}
