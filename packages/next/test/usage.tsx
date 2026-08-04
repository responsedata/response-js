import { ResponseAnalytics } from "@responsedata/nextjs";

export function RootLayoutIntegration({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ResponseAnalytics
          clientId="rsp_0123456789abcdefghijklmnopqrstuv"
        />
      </body>
    </html>
  );
}
