/* Booklo service worker (spec 2026-09-05 §3.8): shows a Web Push payload
   and opens its url on tap. No caching, no offline — the worker exists so
   the browser has somewhere to deliver a push while no tab is open. Bump
   SW_VERSION when this file changes so installed copies refresh. */
const SW_VERSION = 1;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Booklo";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    data: { url: data.url || "/bookings" },
    icon: "/manifest-icon?size=192",
    badge: "/manifest-icon?size=96",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/bookings", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      if (open) return open.navigate(url).then((c) => (c ? c.focus() : undefined));
      return self.clients.openWindow(url);
    }),
  );
});

void SW_VERSION;
