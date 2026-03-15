// AI data processing consent — localStorage-backed.
// Users must consent before any data is sent to an LLM provider.

const STORAGE_KEY = "ssi-ai-consent";

export type AIConsentState = "granted" | "denied" | "unknown";

export function getAIConsent(): AIConsentState {
  if (typeof window === "undefined") return "unknown";
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === "granted" || val === "denied") return val;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function setAIConsent(state: "granted" | "denied"): void {
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* ignore storage errors */
  }
}

export function clearAIConsent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage errors */
  }
}
