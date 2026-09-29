import { MatchGate } from "@/components/match-gate";
import GridPageClient from "./grid-page-client";

interface PageProps {
  params: Promise<{ ct: string; id: string }>;
}

// Legacy ?competitors= links are redirected in middleware.ts, before this page
// or the layout's metadata run, so no match data is loaded for them.
export default async function GridPage({ params }: PageProps) {
  const { ct, id } = await params;
  // Task 7 moves MatchGate into the shell and deletes this wrapper.
  return (
    <div className="h-[calc(100dvh-3.5rem)]">
      <MatchGate ct={ct} id={id}>
        <GridPageClient />
      </MatchGate>
    </div>
  );
}
