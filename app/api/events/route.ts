import { NextResponse } from "next/server";
import { executeQuery, EVENTS_QUERY } from "@/lib/graphql";
import type { EventSummary } from "@/lib/types";

interface RawEvent {
  id: string;
  get_content_type_key: number;
  name: string;
  venue: string | null;
  starts: string;
  status: string;
  region: string;
  get_full_rule_display: string;
  get_full_level_display: string;
}

interface RawEventsData {
  events: RawEvent[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  // Default date range: 3 months back to 3 months forward
  const now = new Date();
  const after = new Date(now);
  after.setMonth(after.getMonth() - 3);
  const before = new Date(now);
  before.setMonth(before.getMonth() + 3);

  const variables: Record<string, string> = {
    starts_after: after.toISOString().slice(0, 10),
    starts_before: before.toISOString().slice(0, 10),
  };
  if (q) variables.search = q;

  let data: RawEventsData;
  try {
    data = await executeQuery<RawEventsData>(EVENTS_QUERY, variables);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const events: EventSummary[] = data.events
    // Only include match nodes (ct=22), not series (ct=43)
    .filter((e) => e.get_content_type_key === 22)
    // Sort by start date descending (upcoming/most-recent first)
    .sort((a, b) => new Date(b.starts).getTime() - new Date(a.starts).getTime())
    .map((e) => ({
      id: parseInt(e.id, 10),
      content_type: e.get_content_type_key,
      name: e.name,
      venue: e.venue || null,
      date: e.starts,
      status: e.status,
      region: e.region,
      discipline: e.get_full_rule_display,
      level: e.get_full_level_display,
    }));

  return NextResponse.json(events);
}
