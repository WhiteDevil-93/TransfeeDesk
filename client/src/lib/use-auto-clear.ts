import { useEffect } from "react";

/** Clears a sensitive value (temporary password, follow-up code) after a while so it does not linger on a shared screen. */
export function useAutoClear(value: string | null, clear: () => void, ms = 120_000) {
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(clear, ms);
    return () => clearTimeout(timer);
  }, [value]);
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
