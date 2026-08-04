import { trackPageView } from "../../../packages/browser/src/index";

try {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) {
    trackPageView({
      clientId: script.dataset.clientId?.trim() ?? "",
    });
  }
} catch {
  // Invalid installation or browser limitations fail closed.
}
