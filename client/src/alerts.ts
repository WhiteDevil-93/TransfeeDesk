let ctx: AudioContext | null = null;
export function unlockAudio() { try { ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)(); ctx.resume(); } catch {} }
function tone(freq: number, start: number, dur: number, vol = 0.25) {
  if (!ctx) return; const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = "square"; o.frequency.value = freq; g.gain.setValueAtTime(vol, ctx.currentTime + start); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
}
export const sounds = {
  alarm() { for (let i = 0; i < 3; i++) { tone(988, i * 0.5, 0.22); tone(740, i * 0.5 + 0.25, 0.22); } },
  chime() { tone(660, 0, 0.18, 0.15); tone(880, 0.2, 0.25, 0.15); },
  reminder() { tone(523, 0, 0.15, 0.12); tone(523, 0.25, 0.15, 0.12); },
};
export function canNotify() { return typeof Notification !== "undefined"; }
export async function askNotify() { if (canNotify() && Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} } }
export function notify(title: string, body: string, tag: string, urgent = false) {
  if (!canNotify() || Notification.permission !== "granted") return;
  try { new Notification(title, { body, tag, requireInteraction: urgent } as any); } catch {}
}
export type AlertSettings = { p1: number; p2: number; p3: number; repeat: number; escalate: number; sound: boolean };
export const defaultSettings: AlertSettings = { p1: 5, p2: 30, p3: 120, repeat: 5, escalate: 10, sound: true };
