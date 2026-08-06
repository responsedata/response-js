"use client";

import { trackPageView } from "@responsedata/browser";
import { usePathname } from "next/navigation.js";
import { useEffect } from "react";

export type ResponseAnalyticsProps = {
  clientId: string;
  collectorEndpoint?: string;
  enabled?: boolean;
};

/**
 * Tracks the initial page and subsequent client-side pathname changes.
 */
export function ResponseAnalytics({
  clientId,
  collectorEndpoint,
  enabled = true,
}: ResponseAnalyticsProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (enabled && pathname) {
      trackPageView({ clientId, collectorEndpoint, path: pathname });
    }
  }, [clientId, collectorEndpoint, enabled, pathname]);

  return null;
}
