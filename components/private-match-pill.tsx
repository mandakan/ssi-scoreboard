import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Visibility } from "@/lib/types";

/**
 * Compact "Private" pill rendered next to non-public matches in list-card
 * surfaces (home page Live now, event search results). Purely visual --
 * clicking still opens the match page, which carries the full explainer
 * when the match isn't viewable. Keep it small so the card layout doesn't
 * change shape between public and private matches.
 */
export function PrivateMatchPill({
  visibility,
  className,
}: {
  visibility: Visibility | null | undefined;
  className?: string;
}) {
  if (!visibility || visibility.class !== "organizer-published") return null;
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] py-0 px-1.5 font-medium ${className ?? ""}`}
      aria-label="Private match -- details may be restricted"
    >
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
      Private
    </Badge>
  );
}
