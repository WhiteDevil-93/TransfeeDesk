import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { User } from "@shared/schema";
import { API_BASE, apiRequest, queryClient, session } from "./lib/queryClient";
import { dismissToasts } from "@/hooks/use-toast";
import { browserTokenStore } from "./lib/token-store";
import { releaseDevice } from "./push";

const tokens = browserTokenStore();
tokens.dropLegacy();
const readToken = tokens.read, clearTokens = tokens.clear;
export const workspaceFor = (user: Pick<User, "role">) => user.role === "referrer" ? "/portal" : "/queue";
type AuthState = {
  user: User | null; restoring: boolean; expired: boolean; restoreError: string;
  signIn: (result: { token: string; user: User }) => void;
  signOut: (destination?: string) => Promise<void>;
  refreshUser: () => Promise<void>; retryRestore: () => void;
};
const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider required"); return value; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(() => Boolean(readToken()));
  const [expired, setExpired] = useState(false), [restoreError, setRestoreError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    session.onExpire = () => { clearTokens(); dismissToasts(); setUser(null); setExpired(true); queryClient.clear(); };
    return () => { session.onExpire = undefined; };
  }, []);
  useEffect(() => {
    let active = true;
    const token = readToken();
    if (!token) { setRestoring(false); return; }
    setRestoring(true); setRestoreError(""); session.token = token;
    apiRequest("GET", "/api/me", undefined, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).then(({ user }) => {
      if (active) setUser(user);
    }).catch((error) => {
      if (!active) return;
      if (String(error.message).startsWith("401")) { clearTokens(); session.token = ""; }
      else setRestoreError("We couldn't reconnect to your session. Check your connection and try again, or sign in again.");
    }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [attempt]);
  const signIn: AuthState["signIn"] = ({ token, user }) => {
    clearTokens(); dismissToasts(); session.token = token; queryClient.clear();
    tokens.save(user.role, token);
    setUser(user); setExpired(false); setRestoreError(""); navigate(user.role === "referrer" && /^\/refer\/(MEU|TEU|SEU)$/.test(location) ? location : workspaceFor(user));
  };
  const signOut: AuthState["signOut"] = async (destination = "/") => {
    const token = session.token;
    const released = token ? releaseDevice(token) : Promise.resolve();
    clearTokens(); dismissToasts(); session.token = ""; setUser(null); setExpired(false); setRestoreError(""); setAttempt(x => x + 1); queryClient.clear(); navigate(destination);
    await released;
    if (token) await fetch(`${API_BASE}/api/me/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  };
  const refreshUser = async () => {
    const { user } = await (await apiRequest("GET", "/api/me")).json(); setUser(user);
  };
  return <AuthContext.Provider value={{ user, restoring, expired, restoreError, signIn, signOut, refreshUser, retryRestore: () => setAttempt(x => x + 1) }}>{children}</AuthContext.Provider>;
}
