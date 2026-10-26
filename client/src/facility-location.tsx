import { useEffect, useRef, useState } from "react";
import { facilityLocation, type FacilityPoint } from "@shared/location";
import { apiRequest } from "./lib/queryClient";
import { CatchmentWindow } from "./catchment";
import { SectionHeading } from "./components/clinical-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Hit = FacilityPoint & { name: string; health: boolean };
export function FacilityLocationPicker({ facility, point, confirmed, onChange, onConfirm }: { facility: string; point: FacilityPoint; confirmed: boolean; onChange: (point: FacilityPoint) => void; onConfirm: (value: boolean) => void }) {
  const [hits, setHits] = useState<Hit[] | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [map, setMap] = useState(false);
  const [draft, setDraft] = useState({ lat: "", lon: "" });
  const serial = useRef(0);
  const valid = facilityLocation.safeParse(point).success;
  useEffect(() => { serial.current++; setHits(null); setMessage(""); setBusy(false); return () => { serial.current++; }; }, [facility]);
  const choose = (value: FacilityPoint) => { onConfirm(false); onChange(value); setHits(null); setMap(true); setMessage("Check the pin on the catchment map, then confirm it is the referring facility."); };
  const find = async () => { const id = ++serial.current; setBusy(true); setMessage(""); try { const response = await apiRequest("GET", `/api/geocode?q=${encodeURIComponent(facility)}`); const found = await response.json(); if (id === serial.current) setHits(found); } catch { if (id === serial.current) setMessage("Facility search failed. Try again, choose a point on the map or enter facility coordinates."); } finally { if (id === serial.current) setBusy(false); } };
  const locate = () => {
    if (!navigator.geolocation) return setMessage("Location is unavailable. Find the facility, choose it on the map or enter coordinates.");
    const id = ++serial.current; setBusy(true); setMessage("Finding your location...");
    navigator.geolocation.getCurrentPosition(position => { if (id !== serial.current) return; choose({ lat: position.coords.latitude.toFixed(6), lon: position.coords.longitude.toFixed(6) }); setBusy(false); }, () => { if (id !== serial.current) return; setBusy(false); setMessage("Location could not be shared. Find the facility, choose it on the map or enter coordinates."); }, { timeout: 10000, maximumAge: 0, enableHighAccuracy: true });
  };
  return <Card className="space-y-4 p-5 sm:p-6"><SectionHeading>Facility location *</SectionHeading><p className="text-sm text-muted-foreground">A confirmed facility pin is required to check the catchment area. Use your phone location only when you are at the referring facility.</p>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || facility.trim().length < 3} onClick={find}>{busy ? "Locating..." : "Find facility"}</Button><Button type="button" variant="outline" disabled={busy} onClick={locate}>Use my location at the facility</Button><Button type="button" variant="outline" onClick={() => setMap(true)}>Choose on map</Button></div>
    {hits?.length === 0 && <p role="status" className="text-sm">No facility found. Try a more specific facility name, choose its point on the map or enter coordinates.</p>}
    {hits && hits.length > 0 && <ul className="space-y-2">{hits.map((hit, i) => <li key={i}><Button type="button" variant="outline" className="h-auto min-h-12 w-full whitespace-normal text-left justify-start" onClick={() => choose({ lat: hit.lat, lon: hit.lon })}>{hit.name}</Button></li>)}</ul>}
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">Enter facility coordinates</summary><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="facility-lat">Latitude</Label><Input id="facility-lat" value={draft.lat} onChange={event => setDraft(value => ({ ...value, lat: event.target.value }))} placeholder="e.g. -26.26"/></div><div><Label htmlFor="facility-lon">Longitude</Label><Input id="facility-lon" value={draft.lon} onChange={event => setDraft(value => ({ ...value, lon: event.target.value }))} placeholder="e.g. 27.94"/></div></div><Button type="button" variant="outline" className="mt-3" onClick={() => { const result = facilityLocation.safeParse(draft); if (result.success) choose(result.data); else setMessage("Enter valid latitude and longitude for the facility."); }}>Use facility coordinates</Button></details>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {valid && <div className="space-y-3 rounded-lg border bg-accent/40 p-4"><p className="text-sm">Facility pin: {point.lat}, {point.lon}</p><Button type="button" variant="outline" onClick={() => setMap(true)}>Check facility catchment</Button><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-primary" checked={confirmed} onChange={event => onConfirm(event.target.checked)}/><span>I confirm this pin is the referring facility *</span></label></div>}
    <CatchmentWindow open={map} onClose={() => setMap(false)} point={valid ? point : undefined} onSelect={choose}/>
  </Card>;
}
