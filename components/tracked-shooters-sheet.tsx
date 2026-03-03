"use client";

import { X, User } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";

interface TrackedShootersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TrackedShootersSheet({
  open,
  onOpenChange,
}: TrackedShootersSheetProps) {
  const { identity, clearIdentity } = useMyIdentity();
  const { tracked, remove } = useTrackedShooters();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-xl">
        <SheetHeader className="pb-2">
          <SheetTitle>My shooters</SheetTitle>
          <SheetDescription>
            Tracked competitors are auto-selected when you visit their matches.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4 space-y-5">
          {/* Identity section */}
          <section aria-labelledby="identity-heading">
            <h3
              id="identity-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            >
              Your identity
            </h3>
            {identity ? (
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <User className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{identity.name}</p>
                  {identity.license && (
                    <p className="text-xs text-muted-foreground truncate">
                      {identity.license}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearIdentity}
                  className="shrink-0 p-2 rounded hover:bg-destructive/10 hover:text-destructive transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  aria-label={`Clear identity: ${identity.name}`}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not set. Tap the{" "}
                <User className="inline w-3.5 h-3.5" aria-hidden="true" />{" "}
                icon next to your name in the competitor picker to claim your identity.
              </p>
            )}
          </section>

          {/* Tracked list section */}
          <section aria-labelledby="tracked-heading">
            <h3
              id="tracked-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            >
              Tracked competitors ({tracked.length})
            </h3>
            {tracked.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tracked competitors. Tap the star icon next to a competitor in the picker to track them.
              </p>
            ) : (
              <ul className="space-y-1" aria-label="Tracked competitors">
                {tracked.map((t) => (
                  <li
                    key={t.shooterId}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      {(t.division ?? t.club) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {[t.division, t.club].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(t.shooterId)}
                      className="shrink-0 p-2 rounded hover:bg-destructive/10 hover:text-destructive transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      aria-label={`Remove ${t.name} from tracked`}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(identity || tracked.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearIdentity();
                tracked.forEach((t) => remove(t.shooterId));
              }}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              Clear all
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
