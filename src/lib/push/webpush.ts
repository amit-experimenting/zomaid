// Wrapper around the `web-push` library. Validates VAPID env vars up front
// so misconfiguration produces a clear error rather than a silent failure.

import webPush from "web-push";

let configured = false;

function configure(): void {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "VAPID env vars missing: NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT",
    );
  }
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type WebPushResult =
  | { ok: true }
  | { ok: false; gone: boolean; status: number; message: string };

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<WebPushResult> {
  configure();
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    const message = e instanceof Error ? e.message : "send failed";
    // 410 Gone or 404 Not Found → subscription is dead, mark revoked
    const gone = status === 410 || status === 404;
    return { ok: false, gone, status, message };
  }
}
