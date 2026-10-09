/* eslint-disable no-undef */

// Credential-free worker. Registration is gated by
// NEXT_PUBLIC_WEB_PUSH_ENABLED and background delivery remains blocked until
// the provider-specific worker is generated from reviewed configuration.
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
