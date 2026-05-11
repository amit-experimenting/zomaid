import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// Slice 5 — Web Push event handlers.
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let payload: { title: string; body: string; data?: { taskId?: string; occurrenceId?: string } };
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.data?.occurrenceId ?? "task",
      data: payload.data ?? {},
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of allClients) {
        if (c.url.includes("/tasks")) {
          (c as WindowClient).focus();
          return;
        }
      }
      await self.clients.openWindow("/tasks");
    })(),
  );
});
