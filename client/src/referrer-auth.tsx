import { cloneElement, useId, useLayoutEffect, useState } from "react";
import { Link } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "./auth";
import { apiRequest } from "./lib/queryClient";
import { messageOf } from "./workflows";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountNotice, AudienceSwitch, BackHome, SectionHeading, StepProgress } from "./components/clinical-ui";
import { useToast } from "@/hooks/use-toast";

function Field({ label, children, hint }: any) { const id = useId(); return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{cloneElement(children, { id })}{hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}</div>; }
export function ReferrerAuth() {
  const { signIn, expired } = useAuth(); const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "signup">("login"), [step, setStep] = useState(0);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [mode, step]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [profile, setProfile] = useState({ name: "", email: "", phone: "", specialty: "", profession: "doctor", hpcsa: "", username: "", password: "" });
  const set = (key: string) => (event: any) => { setProfile(value => ({ ...value, [key]: event.target ? event.target.value : event })); setError(""); };
  const login = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { signIn(await (await apiRequest("POST", "/api/login", { username, password }, { signal: AbortSignal.timeout(20000) })).json()); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } };
  const signup = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (step === 0) { setStep(1); return; }
    setBusy(true);
    try {
      const result = await (await apiRequest("POST", "/api/referrer/signup", profile, { signal: AbortSignal.timeout(60000) })).json();
      const authenticated = await (await apiRequest("POST", "/api/login", { username: profile.username, password: profile.password })).json();
      toast({ title: result.autoApproved ? "Verified against HPCSA" : "Account created", description: result.message }); signIn(authenticated);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return <div className="max-w-md mx-auto space-y-4 pb-4"><BackHome/><Card className="p-6 sm:p-8 space-y-6">
    <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-primary">Referring clinicians</p><h1 className="text-2xl font-bold tracking-tight">{mode === "login" ? "Referring clinician portal" : "Create referrer account"}</h1><p className="text-sm leading-relaxed text-muted-foreground">{mode === "login" ? "Send referrals, see clinical advice and follow your patients' transfer progress." : "Set up your profile, then verify your account before sending referrals. Enter the referring facility with each consult."}</p></div>
    {expired && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your session ended. Sign in again to continue.</p>}
    {mode === "login" ? <><AudienceSwitch audience="referrer"/><form onSubmit={login} className="space-y-5"><Field label="Username"><Input value={username} onChange={event => setUsername(event.target.value)} placeholder="Your username" autoComplete="username" required data-testid="input-portal-username"/></Field><Field label="Password"><div className="relative"><Input aria-label="Password" className="pr-12" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required data-testid="input-portal-password"/><button type="button" className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-muted-foreground" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></Field>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button size="lg" className="w-full" disabled={busy} data-testid="button-portal-login">{busy ? "Signing in..." : "Sign in"}</Button></form><div className="border-t pt-5 text-center"><p className="text-sm text-muted-foreground">New referring clinician?</p><Button variant="ghost" className="text-primary font-semibold" onClick={() => { setMode("signup"); setError(""); }}>Create account</Button></div><details className="rounded-lg border bg-muted/40 p-3 text-sm"><summary className="cursor-pointer font-medium">Forgot your password?</summary><p className="pt-3 text-muted-foreground">Contact the BaraBridge administrator to request a password reset.</p></details></> : <>
      <StepProgress labels={["Profile", "Account", "Verify"]} current={step} onBack={setStep}/>
      <form onSubmit={signup} className="space-y-5">
        {step === 0 ? <><SectionHeading>Professional identity</SectionHeading><Field label="Full name *"><Input value={profile.name} onChange={set("name")} minLength={2} maxLength={100} autoComplete="name" required/></Field><Field label="Profession *"><Select value={profile.profession} onValueChange={set("profession")}><SelectTrigger aria-label="Profession"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="doctor">Doctor</SelectItem><SelectItem value="nurse">Nurse</SelectItem><SelectItem value="other">Other professional</SelectItem></SelectContent></Select></Field><Field label="Specialty *"><Input value={profile.specialty} onChange={set("specialty")} maxLength={100} required placeholder="e.g. Emergency Medicine"/></Field><Field label="HPCSA reg no. (optional)" hint="A matching name, number and eligible register status can verify your account automatically."><Input value={profile.hpcsa} onChange={set("hpcsa")} maxLength={30} placeholder="MP 0123456"/></Field><div className="border-t pt-5"><SectionHeading>Contact details</SectionHeading></div><Field label="Email *"><Input type="email" value={profile.email} onChange={set("email")} maxLength={100} required autoComplete="email"/></Field><Field label="Cellphone *"><Input type="tel" value={profile.phone} onChange={set("phone")} minLength={9} maxLength={30} required autoComplete="tel"/></Field></> : <><SectionHeading>Your account</SectionHeading><p className="text-sm text-muted-foreground">Choose credentials that only you use. Staff-card verification follows if an eligible HPCSA match is unavailable.</p><Field label="Username *"><Input value={profile.username} onChange={event => setProfile(value => ({ ...value, username: event.target.value.toLowerCase().replace(/\s/g, "") }))} minLength={3} maxLength={30} required autoComplete="username" placeholder="3–30 letters / numbers"/></Field><Field label="Password *" hint="Use at least 10 characters."><Input type="password" value={profile.password} onChange={set("password")} minLength={10} required autoComplete="new-password"/></Field></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-3">{step > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(0)}>Previous</Button>}<Button type="submit" className="flex-1" size="lg" disabled={busy} data-testid="button-portal-signup">{busy ? "Creating account..." : step === 0 ? "Continue to account" : "Create account"}</Button></div>
      </form><Button variant="ghost" className="w-full" disabled={busy} onClick={() => { setMode("login"); setError(""); }}>Already registered? Sign in</Button>
    </>}
    <p className="text-sm">Receiving staff? <Link href="/login" className="font-semibold text-primary underline underline-offset-4">Go to staff sign-in</Link></p><AccountNotice>Sessions end after 30 minutes of inactivity. Your account only gives access to your own referrals.</AccountNotice>
  </Card></div>;
}
