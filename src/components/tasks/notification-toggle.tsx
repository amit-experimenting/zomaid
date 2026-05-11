"use client";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { subscribePush, unsubscribePush } from "@/app/push/actions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function bufToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

type State = "loading" | "off" | "on" | "denied" | "unsupported";

export function NotificationToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    });
  }, []);

  async function enable() {
    setError(null);
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState("denied");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!publicKey) {
          setError("VAPID public key not configured.");
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
        });
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const res = await subscribePush({
          endpoint: json.endpoint ?? sub.endpoint,
          p256dh: json.keys?.p256dh ?? bufToBase64(sub.getKey("p256dh")),
          auth: json.keys?.auth ?? bufToBase64(sub.getKey("auth")),
          userAgent: navigator.userAgent.slice(0, 500),
        });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
        setState("on");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to subscribe");
      }
    });
  }

  async function disable() {
    setError(null);
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    });
  }

  if (state === "loading") return <span className="text-xs text-muted-foreground">…</span>;
  if (state === "unsupported") return <span className="text-xs text-muted-foreground">Push not supported on this device</span>;
  if (state === "denied") return <span className="text-xs text-muted-foreground">Notifications: blocked (enable in site settings)</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Notifications: {state === "on" ? "On (this device)" : "Off"}
      </span>
      {state === "off" ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={enable}>Enable</Button>
      ) : (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={disable}>Disable</Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
