import { z } from "zod";
import type { CatchmentResult } from "../shared/location";

const pair = z.tuple([z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180)]);
const regionsSchema = z.array(z.object({ border: z.array(pair).min(3).max(50000), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), facilities: z.array(z.object({ name: z.string().min(1).max(300), location: pair })).max(200) })).min(1).max(200);
export type DrainageRegion = z.infer<typeof regionsSchema>[number];
export const CATCHMENT_SOURCE = "https://catchments.medricsoftware.co.za/intersections.json";
let cached: { at: number; regions: DrainageRegion[] } | undefined;
let pending: Promise<DrainageRegion[]> | undefined;

// Coordinates in the provider's published dataset are [latitude, longitude].
// Include boundary points; never substitute a nearest region outside coverage.
export function pointInRegion(lat: number, lon: number, border: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = border.length - 1; i < border.length; j = i++) {
    const [yi, xi] = border[i], [yj, xj] = border[j];
    const cross = (lon - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && lon >= Math.min(xi, xj) && lon <= Math.max(xi, xj) && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function selectCatchment(regions: DrainageRegion[], lat: number, lon: number): CatchmentResult {
  const region = regions.find(candidate => pointInRegion(lat, lon, candidate.border));
  return region ? { status: "matched", border: region.border, facilities: region.facilities, color: region.color, source: CATCHMENT_SOURCE } : { status: "outside", border: [], facilities: [], color: "#0f766e", source: CATCHMENT_SOURCE };
}

export async function catchmentAt(lat: number, lon: number): Promise<CatchmentResult> {
  if (!cached || Date.now() - cached.at > 6 * 3600e3) {
    pending ||= (async () => {
      const response = await fetch(CATCHMENT_SOURCE, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Catchment provider unavailable"); }
      const reader = response.body?.getReader(); if (!reader) throw new Error("Empty catchment response");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 15_000_000) { await reader.cancel(); throw new Error("Catchment response too large"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const regions = regionsSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      cached = { at: Date.now(), regions }; return regions;
    })().finally(() => { pending = undefined; });
    await pending;
  }
  return selectCatchment(cached!.regions, lat, lon);
}
