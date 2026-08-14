const MOBILE_BETA_VERSION = "pwa-v0.1";

export function registerMobileBetaServiceWorker() {
  document.documentElement.dataset.mobileBeta = MOBILE_BETA_VERSION;

  if (!("serviceWorker" in navigator)) {
    document.documentElement.dataset.serviceWorker = "unsupported";
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        document.documentElement.dataset.serviceWorker = "ready";
      })
      .catch(() => {
        document.documentElement.dataset.serviceWorker = "unavailable";
      });
  }, { once: true });
}
