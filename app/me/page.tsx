"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Crosshair } from "lucide-react";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";

/**
 * /me — convenience alias for the shooter dashboard.
 *
 * If the user has set their identity, redirects to /shooter/{shooterId}.
 * Otherwise shows a prompt explaining how to set identity.
 */
export default function MePage() {
  const router = useRouter();
  const { identity } = useMyIdentity();

  useEffect(() => {
    if (identity) {
      router.replace(`/shooter/${identity.shooterId}`);
    }
  }, [identity, router]);

  // While redirecting, show nothing (identity is set, redirect in progress).
  if (identity) {
    return null;
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <Crosshair className="w-12 h-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">No identity set</h1>
      </div>
      <p className="text-muted-foreground max-w-sm">
        To see your personal stats, open any match you competed in and tap the{" "}
        <span className="font-medium text-foreground">person icon</span> next to
        your name in the competitor picker.
      </p>
      <p className="text-muted-foreground max-w-sm text-sm">
        Your identity is saved locally on your device and auto-selects you in
        every match you&apos;ve competed in.
      </p>
    </main>
  );
}
