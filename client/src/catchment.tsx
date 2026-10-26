import { lazy, Suspense, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { FacilityPoint } from "@shared/location";
const View = lazy(() => import("./catchment-view"));
export function CatchmentWindow({ open, onClose, point, onSelect }: { open: boolean; onClose: () => void; point?: FacilityPoint; onSelect?: (point: FacilityPoint) => void }) {
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent className="flex max-h-[92dvh] max-w-5xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b p-5 pr-14"><DialogTitle>Facility catchment</DialogTitle><DialogDescription className="sr-only">Drainage map and assigned referral centres for the selected facility.</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto p-4"><Suspense fallback={<p role="status">Loading map...</p>}><View point={point} onSelect={onSelect}/></Suspense></div></DialogContent></Dialog>;
}
export function CatchmentPage() {
  const [point, setPoint] = useState<FacilityPoint>();
  return <div className="space-y-4"><h1 className="text-xl font-semibold">EMS catchments</h1><Suspense fallback={<p role="status">Loading map...</p>}><View point={point} onSelect={setPoint}/></Suspense></div>;
}
