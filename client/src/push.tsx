import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE, apiRequest } from "./lib/queryClient";

export type PushTarget = { kind: "account" } | { kind: "portal"; token: string };
const PORTAL_HEADER = "x-portal-token";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";

const keyBytes = (key: string) => {
  const raw = atob((key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const registration = () => navigator.serviceWorker.getRegistration();
export async function deviceSubscription() {
  if (!pushSupported()) return null;
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const send = (method: "POST" | "DELETE", target: PushTarget, body: unknown) =>
  target.kind === "account"
    ? apiRequest(method, "/api/push/subscribe", body)
    : apiRequest(method, "/api/portal/push", body, { headers: { [PORTAL_HEADER]: target.token } });

export async function enablePush(target: PushTarget) {
  if (!pushSupported()) throw new Error("This browser cannot receive push notifications. On an iPhone, add BaraBridge to the Home Screen first.");
  const config = await (await fetch(`${API_BASE}/api/push/key`)).json();
  if (!config.enabled || !config.publicKey) throw new Error("Push notifications are not switched on for this server yet. Ask the administrator.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them for this site in the browser or phone settings, then try again.");
  const reg = await registration();
  if (!reg) throw new Error("The app is still starting. Reload the page and try again.");
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) as BufferSource })
    .catch((e: any) => { throw new Error(`This device could not register for push (${e?.message || "refused"}). Check that notifications are allowed for this site and that the device can reach its push service, then try again.`); });
  await send("POST", target, { subscription: subscription.toJSON() });
}

export async function disablePush(target: PushTarget) {
  const subscription = await deviceSubscription();
  if (!subscription) return;
  await send("DELETE", target, { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe();
}

// Signing out must stop alerts on a shared device. Runs before the session token is dropped.
export async function releaseDevice(token: string) {
  try {
    const subscription = await deviceSubscription();
    if (!subscription) return;
    await fetch(`${API_BASE}/api/push/subscribe`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
    await subscription.unsubscribe();
  } catch { /* the sign-out itself must not fail */ }
}

const reason = (e: any) => { try { return JSON.parse(String(e.message).replace(/^\d+:\s*/, "")).message; } catch { return e?.message || "Could not change push notifications."; } };

export function PushToggle({ target, label = "Push notifications" }: { target: PushTarget; label?: string }) {
  const [on, setOn] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => { let alive = true; deviceSubscription().then(s => alive && setOn(!!s)).catch(() => alive && setOn(false)); return () => { alive = false; }; }, []);
  async function toggle() {
    setBusy(true); setErr("");
    try { if (on) { await disablePush(target); setOn(false); } else { await enablePush(target); setOn(true); } }
    catch (e) { setErr(reason(e)); } finally { setBusy(false); }
  }
  if (!pushSupported()) return <p className="text-xs text-muted-foreground">{label} are not available in this browser. On an iPhone, add BaraBridge to the Home Screen first.</p>;
  return <div className="min-w-0 max-w-full space-y-1">
    <Button type="button" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" variant={on ? "outline" : "default"} disabled={busy || on === null} onClick={toggle} data-testid="button-push-toggle">
      {on ? <BellOff className="h-4 w-4 mr-1" /> : <Bell className="h-4 w-4 mr-1" />}{busy ? "Working..." : on ? `Turn off ${label.toLowerCase()} on this device` : `Turn on ${label.toLowerCase()}`}</Button>
    {on && <p role="status" className="text-xs text-muted-foreground">{label} are on for this device, including when the app is closed.</p>}
    {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
  </div>;
}
