import { MatchGate } from "@/components/match-gate";
import InfoPageClient from "./info-page-client";

export default async function InfoPage({ params }: { params: Promise<{ ct: string; id: string }> }) {
  const { ct, id } = await params;
  // Task 7 moves MatchGate into the shell and deletes this wrapper.
  return (
    <MatchGate ct={ct} id={id}>
      <InfoPageClient />
    </MatchGate>
  );
}
