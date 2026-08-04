import { trackPageView } from "../../browser/src/index";

try {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) {
    trackPageView({
      clientId: script.dataset.clientId?.trim() ?? "",
      endpoint: new URL("/api/events", script.src).href,
    });
  }
} catch {
  // Invalid installation or browser limitations fail closed.
}
