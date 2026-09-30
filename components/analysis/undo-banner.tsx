"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UndoBannerProps {
  message: string;
  onUndo: () => void;
  className?: string;
}

/** Status banner offering to undo the last bulk selection change. */
export function UndoBanner({ message, onUndo, className = "" }: UndoBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm animate-fade-in ${className}`}
    >
      <span className="text-muted-foreground truncate">{message}</span>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={onUndo}
        aria-label="Undo last selection change"
      >
        <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
        Undo
      </Button>
    </div>
  );
}
