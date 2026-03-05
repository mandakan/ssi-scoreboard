"use client";

import { useState } from "react";
import { Users, ChevronRight } from "lucide-react";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";

export function MyShootersButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "w-full flex items-center gap-2.5 rounded-lg border px-4 py-3",
          "text-sm text-muted-foreground transition-colors",
          "hover:text-foreground hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ].join(" ")}
      >
        <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">My shooters</span>
        <span className="ml-auto text-xs text-muted-foreground/60">
          Track · Search · Stats
        </span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>

      <TrackedShootersSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
