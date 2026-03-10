import type { Metadata } from "next";
import { SyncPageClient } from "./sync-page-client";

export const metadata: Metadata = {
  title: "Sync devices — SSI Scoreboard",
  description: "Transfer your settings and tracked shooters between devices.",
};

export default function SyncPage() {
  return <SyncPageClient />;
}
