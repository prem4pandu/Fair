/// <reference lib="webworker" />
/* eslint-disable no-undef */

// FairBite does not embed a Firebase project or provider credential in a
// public worker. Web push stays disabled until reviewed provider configuration
// and a configured background-message worker are available.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const redirectUrl = event.notification.data?.redirectUrl;
  if (!redirectUrl) return;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        const target = new URL(redirectUrl, self.location.origin);
        if (target.origin !== self.location.origin) return undefined;
        const existing = list.find((client) => client.url === target.href);
        return existing?.focus() ?? clients.openWindow?.(target.href);
      }),
  );
});
