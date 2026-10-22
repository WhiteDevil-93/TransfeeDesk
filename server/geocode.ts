// Facility lookup via OpenStreetMap Nominatim. Only facility names are sent (no patient data).
type Hit = { name: string; lat: string; lon: string; kind: string; health: boolean };
const cache = new Map<string, { at: number; hits: Hit[] }>();
let chain: Promise<any> = Promise.resolve(); let last = 0;
const HEALTH = new Set(["hospital", "clinic", "doctors", "healthcare", "health_centre", "pharmacy"]);
async function raw(q: string): Promise<Hit[]> {
  const run = async () => {
    const wait = Math.max(0, 1100 - (Date.now() - last)); if (wait) await new Promise(r => setTimeout(r, wait)); last = Date.now();
    const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=za&format=jsonv2&limit=6&addressdetails=0`;
    const r = await fetch(u, { headers: { "User-Agent": "TransferDesk/1.0 (inter-hospital referral tool)", "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    return ((await r.json()) as any[]).map(x => ({ name: x.display_name, lat: Number(x.lat).toFixed(6), lon: Number(x.lon).toFixed(6), kind: x.type, health: HEALTH.has(x.type) || x.category === "healthcare" }));
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}
export async function geocode(q: string): Promise<Hit[]> {
  const key = q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120); if (key.length < 3) return [];
  const c = cache.get(key); if (c && Date.now() - c.at < 7 * 86400e3) return c.hits;
  const base = key.replace(/\b(hospital|hosp|clinic|chc|community health cent(re|er)|district|regional|academic|tertiary|day hospital)\b/g, "").replace(/\s+/g, " ").trim();
  const tries = Array.from(new Set([key, /hospital|clinic|chc/.test(key) ? "" : key + " hospital", base && base !== key ? base + " clinic" : "", base && base !== key ? base : ""].filter(Boolean)));
  const seen = new Set<string>(); const hits: Hit[] = [];
  for (const t of tries) { try { for (const h of await raw(t)) { const k = h.lat + h.lon; if (!seen.has(k)) { seen.add(k); hits.push(h); } } } catch {} if (hits.some(h => h.health)) break; }
  hits.sort((a, b) => Number(b.health) - Number(a.health));
  const out = hits.slice(0, 6); cache.set(key, { at: Date.now(), hits: out }); return out;
}
