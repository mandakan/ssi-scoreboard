// Client-safe API helpers — these call our own Next.js Route Handlers,
// NOT the SSI API directly (which has no CORS headers).

import type {
  CompareMode,
  MatchResponse,
  CompareResponse,
  EventSummary,
  PopularMatch,
  CoachingTipResponse,
  CoachingAvailability,
  ShooterDashboardResponse,
} from "@/lib/types";

export async function fetchMatch(ct: string, id: string): Promise<MatchResponse> {
  const res = await fetch(`/api/match/${ct}/${id}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Match fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchEvents(
  q: string,
  starts_after?: string,
  starts_before?: string,
  firearms?: string,
  country?: string,
  minLevel?: string,
): Promise<EventSummary[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (starts_after) params.set("starts_after", starts_after);
  if (starts_before) params.set("starts_before", starts_before);
  if (firearms && firearms !== "all") params.set("firearms", firearms);
  if (country && country !== "all") params.set("country", country);
  if (minLevel && minLevel !== "all") params.set("minLevel", minLevel);
  const res = await fetch(`/api/events?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Events fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchPopularMatches(): Promise<PopularMatch[]> {
  const res = await fetch("/api/popular-matches");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchCompare(
  ct: string,
  id: string,
  competitorIds: number[],
  mode: CompareMode = "coaching",
): Promise<CompareResponse> {
  if (competitorIds.length === 0) {
    throw new Error("No competitor IDs provided");
  }
  const params = new URLSearchParams({
    ct,
    id,
    competitor_ids: competitorIds.join(","),
    mode,
  });
  const res = await fetch(`/api/compare?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Compare fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchCoachingAvailability(): Promise<CoachingAvailability> {
  const res = await fetch("/api/coaching/availability");
  if (!res.ok) return { available: false };
  return res.json();
}

export async function fetchShooterDashboard(
  shooterId: number,
): Promise<ShooterDashboardResponse> {
  const res = await fetch(`/api/shooter/${shooterId}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shooter dashboard fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchCoachingTip(
  ct: string,
  id: string,
  competitorId: number,
  mode: "coach" | "roast" = "coach",
): Promise<CoachingTipResponse> {
  const url = `/api/coaching/${ct}/${id}/${competitorId}${mode === "roast" ? "?mode=roast" : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
