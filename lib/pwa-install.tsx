"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  startTransition,
} from "react";

// Non-standard browser API — not in the TypeScript DOM lib
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PWAInstallContextValue {
  /** True when the browser has fired beforeinstallprompt (Chrome / Edge / Android) */
  canInstall: boolean;
  /** True when running on iOS Safari — requires manual share-sheet flow */
  isIos: boolean;
  /** True when already running as an installed PWA */
  isInstalled: boolean;
  /** Trigger the native install prompt (no-op if canInstall is false) */
  triggerInstall(): Promise<void>;
}

const PWAInstallContext = createContext<PWAInstallContextValue>({
  canInstall: false,
  isIos: false,
  isInstalled: false,
  triggerInstall: async () => {},
});

function readIsInstalled() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function readIsIos() {
  if (typeof window === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function PWAInstallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Start false on both server and client to avoid hydration mismatch.
  // startTransition updates to real browser values after hydration.
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    startTransition(() => {
      setIsInstalled(readIsInstalled());
      setIsIos(readIsIos());
    });
  }, []);

  useEffect(() => {
    // Already installed or iOS — no point listening for beforeinstallprompt
    if (isInstalled || isIos) return;

    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, [isInstalled, isIos]);

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  return (
    <PWAInstallContext.Provider
      value={{
        canInstall: !!deferredPrompt,
        isIos,
        isInstalled,
        triggerInstall,
      }}
    >
      {children}
    </PWAInstallContext.Provider>
  );
}

export function usePWAInstall() {
  return useContext(PWAInstallContext);
}
