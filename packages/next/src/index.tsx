"use client";

import { trackPageView } from "@responsedata/browser";
import { usePathname } from "next/navigation.js";
import { useEffect } from "react";

export type ResponseAnalyticsProps = {
  clientId: string;
  enabled?: boolean;
};

/**
 * Tracks the initial page and subsequent client-side pathname changes.
 */
export function ResponseAnalytics({
  clientId,
  enabled = true,
}: ResponseAnalyticsProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (enabled && pathname) {
      trackPageView({ clientId, path: pathname });
    }
  }, [clientId, enabled, pathname]);

  return null;
}
