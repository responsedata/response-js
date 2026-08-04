"use client";

import { trackPageView } from "@responsedata/browser";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export type ResponseAnalyticsProps = {
  clientId: string;
  enabled?: boolean;
  endpoint?: string;
};

/**
 * Tracks the initial page and subsequent client-side pathname changes.
 */
export function ResponseAnalytics({
  clientId,
  enabled = true,
  endpoint,
}: ResponseAnalyticsProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (enabled && pathname) {
      trackPageView({ clientId, endpoint, path: pathname });
    }
  }, [clientId, enabled, endpoint, pathname]);

  return null;
}
