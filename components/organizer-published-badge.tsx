"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import type { Visibility } from "@/lib/types";

interface OrganizerPublishedBadgeProps {
  visibility: Visibility;
}

export function OrganizerPublishedBadge({ visibility }: OrganizerPublishedBadgeProps) {
  if (visibility.class !== "organizer-published") return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center"
          aria-label="Published by organizer -- learn more"
        >
          <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/80">
            <Megaphone className="w-3 h-3" aria-hidden="true" />
            Published by organizer
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="text-sm">
        <PopoverHeader>
          <PopoverTitle>Published by organizer</PopoverTitle>
          <PopoverDescription>
            This match isn{"’"}t fully public on ShootNScoreIt. We can show
            it here because the organizer invited our service account as Staff.
          </PopoverDescription>
        </PopoverHeader>
        {visibility.displayName && (
          <p className="mt-2 text-muted-foreground text-xs">
            SSI visibility: <em>{visibility.displayName}</em>
          </p>
        )}
        <Link
          href="/about/organizer-published"
          className="mt-3 inline-block text-primary hover:underline"
        >
          How does this work?
        </Link>
      </PopoverContent>
    </Popover>
  );
}
