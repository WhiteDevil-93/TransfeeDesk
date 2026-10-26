import { Link } from "wouter";
import type { ReactNode } from "react";
import { Check, ArrowLeft, ShieldCheck } from "lucide-react";

export function AudienceSwitch({ audience }: { audience: "staff" | "referrer" }) {
  return <nav aria-label="Choose your workspace" className="bb-audience-switch">
    <Link href="/portal" aria-current={audience === "referrer" ? "page" : undefined}>Referring clinician</Link>
    <Link href="/login" aria-current={audience === "staff" ? "page" : undefined}>Receiving team</Link>
  </nav>;
}

export function BackHome() {
  return <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4"/>Back to Home</Link>;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="bb-section-heading">{children}</h2>;
}

export function StepProgress({ labels, current, onBack }: { labels: string[]; current: number; onBack: (index: number) => void }) {
  return <ol className="bb-stepper" aria-label="Form progress">{labels.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} className={index <= current ? "text-primary" : "text-muted-foreground"}>
    <button type="button" disabled={index > current} onClick={() => onBack(index)} aria-label={`Step ${index + 1}: ${label}`} className="flex min-h-11 w-full flex-col items-center gap-2 text-xs font-semibold sm:text-sm">
      <span className={`grid h-8 w-8 place-items-center rounded-full border-2 ${index < current ? "border-primary bg-primary text-primary-foreground" : index === current ? "border-primary bg-card" : "border-border bg-card"}`}>{index < current ? <Check className="h-4 w-4"/> : index + 1}</span>{label}
    </button>
  </li>)}</ol>;
}

export function AccountNotice({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><p>{children}</p></div>;
}

export function PriorityPill({ priority }: { priority: string }) {
  const variants: Record<string, string> = { P1: "border-red-200 bg-red-50 text-red-800", P2: "border-amber-200 bg-amber-50 text-amber-900", P3: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${variants[priority] || "border-border bg-muted"}`}>{priority} · {priority === "P1" ? "Emergency" : priority === "P2" ? "Urgent" : "Routine"}</span>;
}
