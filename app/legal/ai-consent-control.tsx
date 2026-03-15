"use client";

import { useAIConsent } from "@/hooks/use-ai-consent";

export function AIConsentControl() {
  const { consent, deny } = useAIConsent();

  if (consent !== "granted") return null;

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <h3 className="font-medium text-sm">AI data processing consent</h3>
      <p className="text-sm text-muted-foreground">
        You have accepted AI data processing. You can withdraw your consent
        below. This will require you to re-confirm before any future AI
        coaching requests.
      </p>
      <button
        onClick={deny}
        className="text-sm font-medium text-destructive hover:text-destructive/80 underline underline-offset-4 transition-colors"
      >
        Withdraw AI consent
      </button>
    </div>
  );
}
