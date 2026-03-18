"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareDrawer } from "@/components/share-drawer";

interface ShareEventLinkProps {
  ct: string;
  id: string;
  matchName?: string;
}

/**
 * Copies the /event/{ct}/{id} proxy link — shows a nice OG preview in
 * social media but redirects visitors to ShootNScoreIt.
 */
export function ShareEventLink({ ct, id, matchName }: ShareEventLinkProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <ShareDrawer
      title="Share link to ShootNScoreIt"
      description="This link shows a rich preview in Slack, Discord, and social media — then takes visitors directly to the match on ShootNScoreIt."
      sharePath={`/event/${ct}/${id}`}
      ogImageUrl={`${origin}/api/og/match/${ct}/${id}`}
      ogImageAlt={`Preview of how ${matchName ?? "this match"} will appear in social media`}
      shareTitle={matchName}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label="Share SSI event link"
          title="Share link to SSI with rich preview"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="hidden sm:inline">SSI link</span>
        </Button>
      }
    />
  );
}
