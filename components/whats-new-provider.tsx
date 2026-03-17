"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RELEASES } from "@/lib/releases";
import type { Release } from "@/lib/types";

const LS_KEY = "whats-new-seen-id";

interface WhatsNewContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const WhatsNewContext = createContext<WhatsNewContextValue>({
  open: false,
  setOpen: () => {},
});

export function useWhatsNew() {
  return useContext(WhatsNewContext);
}

export function WhatsNewProvider({ children }: { children: React.ReactNode }) {
  const [openState, setOpenState] = useState(false);
  const [releasesToShow, setReleasesToShow] = useState<Release[]>([]);
  const latest = RELEASES[0] ?? null;

  // Auto-show once per release id, displaying all releases missed since last visit.
  useEffect(() => {
    if (!latest) return;
    const timer = setTimeout(() => {
      const seen = localStorage.getItem(LS_KEY);
      if (seen !== latest.id) {
        const seenIndex = RELEASES.findIndex((r) => r.id === seen);
        // seenIndex === -1 means first visit or stale id — show only latest to avoid overwhelming.
        const missed =
          seenIndex >= 1 ? RELEASES.slice(0, seenIndex) : [latest];
        setReleasesToShow(missed);
        // Blur any focused element before opening the dialog so Radix's
        // aria-hidden on the page root doesn't conflict with active focus.
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setOpenState(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [latest]);

  function handleClose() {
    if (latest) {
      localStorage.setItem(LS_KEY, latest.id);
    }
    setOpenState(false);
    setReleasesToShow([]);
  }

  function handleDialogOpenChange(next: boolean) {
    if (!next) handleClose();
  }

  // Exposed via context. Footer calls setOpen(true) to manually show latest.
  function setOpen(next: boolean) {
    if (next) {
      setReleasesToShow(latest ? [latest] : []);
      setOpenState(true);
    } else {
      handleClose();
    }
  }

  const isSingle = releasesToShow.length === 1;
  const firstRelease = releasesToShow[0];

  return (
    <WhatsNewContext.Provider value={{ open: openState, setOpen }}>
      {children}
      {latest && (
        <Dialog open={openState} onOpenChange={handleDialogOpenChange}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
                {isSingle ? (firstRelease?.title ?? "What's new") : "What's new"}
              </DialogTitle>
              <DialogDescription>
                {isSingle
                  ? firstRelease?.date
                  : `${releasesToShow.length} updates since your last visit`}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[55vh] overflow-y-auto space-y-4 pr-1">
              {isSingle
                ? firstRelease?.sections.map((section) => (
                    <section
                      key={section.heading}
                      aria-labelledby={`wn-section-${section.heading}`}
                    >
                      <h3
                        id={`wn-section-${section.heading}`}
                        className="text-sm font-semibold mb-1"
                      >
                        {section.heading}
                      </h3>
                      <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
                        {section.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ))
                : releasesToShow.map((release) => (
                    <div key={release.id} className="space-y-3">
                      <div className="flex items-baseline gap-2 border-b border-border pb-1">
                        <span className="text-sm font-semibold">
                          {release.title ?? "Update"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {release.date}
                        </span>
                      </div>
                      {release.sections.map((section) => (
                        <section
                          key={section.heading}
                          aria-labelledby={`wn-section-${release.id}-${section.heading}`}
                        >
                          <h3
                            id={`wn-section-${release.id}-${section.heading}`}
                            className="text-sm font-semibold mb-1"
                          >
                            {section.heading}
                          </h3>
                          <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
                            {section.items.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  ))}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button className="w-full sm:w-auto">Got it</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </WhatsNewContext.Provider>
  );
}
