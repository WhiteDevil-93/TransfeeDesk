import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { facilityLocation, type CatchmentResult, type FacilityPoint } from "@shared/location";
import { Button } from "@/components/ui/button";

export default function CatchmentView({ point, onSelect }: { point?: FacilityPoint; onSelect?: (point: FacilityPoint) => void }) {
  const host = useRef<HTMLDivElement>(null), map = useRef<L.Map>(), layers = useRef<L.LayerGroup>();
  const select = useRef(onSelect); select.current = onSelect;
  const [tileError, setTileError] = useState(false);
  const valid = facilityLocation.safeParse(point).success;
  const { data, error, isFetching, refetch } = useQuery<CatchmentResult>({ queryKey: [`/api/catchment?lat=${encodeURIComponent(point?.lat || "")}&lon=${encodeURIComponent(point?.lon || "")}`], enabled: valid, staleTime: 3600e3, retry: 1 });
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current).setView(valid ? [Number(point!.lat), Number(point!.lon)] : [-26.2041, 28.0473], 11); map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Drainage: <a href="https://catchments.medricsoftware.co.za/">Medric</a>' }).on("tileerror", () => setTileError(true)).on("tileload", () => setTileError(false)).addTo(m);
    layers.current = L.layerGroup().addTo(m);
    m.on("click", event => select.current?.({ lat: event.latlng.lat.toFixed(6), lon: event.latlng.lng.toFixed(6) }));
    const observer = new ResizeObserver(() => m.invalidateSize()); observer.observe(host.current);
    return () => { observer.disconnect(); m.remove(); map.current = undefined; };
  }, []);
  useEffect(() => {
    const m = map.current, group = layers.current; if (!m || !group) return;
    group.clearLayers(); if (!valid) return;
    const location: [number, number] = [Number(point!.lat), Number(point!.lon)];
    L.circleMarker(location, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1, bubblingMouseEvents: false }).bindTooltip("Facility location").addTo(group);
    if (data?.status === "matched") {
      L.polygon(data.border, { color: data.color, weight: 2, fillOpacity: .18, interactive: false }).addTo(group);
      for (const centre of data.facilities) {
        const label = document.createElement("span"); label.textContent = centre.name;
        L.circleMarker(centre.location, { radius: 7, color: "#fff", weight: 2, fillColor: "#0f766e", fillOpacity: 1, bubblingMouseEvents: false }).bindPopup(label).addTo(group);
      }
      m.fitBounds(L.latLngBounds([location, ...data.border, ...data.facilities.map(centre => centre.location)]), { padding: [20, 20], maxZoom: 14 });
    } else m.setView(location, 13);
  }, [point?.lat, point?.lon, data, valid]);
  return <div className="grid gap-4 lg:grid-cols-[2fr_1fr]" data-testid="catchment-view">
    <div className="relative isolate"><div ref={host} aria-label="Facility drainage map" role="region" className="h-[45vh] min-h-[280px] max-h-[480px] w-full rounded-xl border bg-muted"/>{tileError && <p role="status" className="absolute bottom-8 left-2 z-[1001] rounded bg-card p-2 text-xs shadow">Map tiles could not load. Check your connection.</p>}</div>
    <section aria-label="Referral centres in drainage area" className="space-y-3"><h2 className="font-semibold">Referral centres in this drainage area</h2>
      {!valid ? <p className="text-sm text-muted-foreground">Select the facility point on the map to check its drainage area.</p> : error ? <div role="alert" className="space-y-3"><p className="text-sm">Catchment data could not load.</p><Button type="button" variant="outline" onClick={() => refetch()}>Try again</Button></div> : !data ? <p role="status" className="text-sm">Checking drainage area...</p> : data.status === "outside" ? <p role="status" className="text-sm">This location is outside the published catchment coverage. No referral centres can be confirmed from this map.</p> : <ul className="space-y-2">{data.facilities.map((centre, i) => <li key={`${centre.name}-${i}`}><button type="button" className="min-h-11 w-full rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => map.current?.flyTo(centre.location, 15)}>{centre.name}</button></li>)}</ul>}
      {isFetching && data && <p role="status" className="text-xs text-muted-foreground">Updating drainage area...</p>}
    </section>
  </div>;
}
