self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const icon = new URL("icon-192.png", self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(d.title || "BaraBridge", {
    body: d.body || "Open BaraBridge to see what needs attention.",
    tag: d.tag || "barabridge",
    renotify: true,
    requireInteraction: !!d.urgent,
    icon,
    badge: icon,
    data: { url: d.url || "/#/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/#/", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => "focus" in w);
    if (!open) return self.clients.openWindow(url);
    return open.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
  }));
});
