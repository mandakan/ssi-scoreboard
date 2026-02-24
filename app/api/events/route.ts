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

  // Query params: q (search), starts_after, starts_before (ISO dates),
  // firearms (default "hg"), country (ISO 3166-1 alpha-3, e.g. "SWE").
  // Caller may override the date window; fall back to ±3 months from today.
  const now = new Date();
  const defaultAfter = new Date(now);
  defaultAfter.setMonth(defaultAfter.getMonth() - 3);
  const defaultBefore = new Date(now);
  defaultBefore.setMonth(defaultBefore.getMonth() + 3);

  const country = searchParams.get("country");

  const variables: Record<string, string> = {
    starts_after:
      searchParams.get("starts_after") ??
      defaultAfter.toISOString().slice(0, 10),
    starts_before:
      searchParams.get("starts_before") ??
      defaultBefore.toISOString().slice(0, 10),
    firearms: searchParams.get("firearms") ?? "hg",
  };
  if (q) variables.search = q;

  let data: RawEventsData;
  try {
    data = await executeQuery<RawEventsData>(EVENTS_QUERY, variables, 3600);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const events: EventSummary[] = data.events
    // Only include match nodes (ct=22), not series (ct=43)
    .filter((e) => e.get_content_type_key === 22)
    // Filter by country/region if specified
    .filter((e) => !country || e.region.toUpperCase() === country.toUpperCase())
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
