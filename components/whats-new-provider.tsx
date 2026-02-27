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
  const [open, setOpen] = useState(false);
  const latest = RELEASES[0] ?? null;

  // Auto-show once per release id.
  // setState is placed inside a setTimeout callback to satisfy react-hooks/set-state-in-effect
  // and to avoid a flash during hydration.
  useEffect(() => {
    if (!latest) return;
    const timer = setTimeout(() => {
      const seen = localStorage.getItem(LS_KEY);
      if (seen !== latest.id) {
        setOpen(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [latest]);

  function handleOpenChange(next: boolean) {
    if (!next && latest) {
      localStorage.setItem(LS_KEY, latest.id);
    }
    setOpen(next);
  }

  return (
    <WhatsNewContext.Provider value={{ open, setOpen }}>
      {children}
      {latest && (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
                {latest.title ?? "What's new"}
              </DialogTitle>
              <DialogDescription>{latest.date}</DialogDescription>
            </DialogHeader>
            <div className="max-h-[55vh] overflow-y-auto space-y-4 pr-1">
              {latest.sections.map((section) => (
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
