"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMatch, fetchCompare, fetchEvents, fetchPopularMatches, fetchCoachingAvailability, fetchCoachingTip, fetchShooterDashboard, fetchShooterSearch } from "@/lib/api";
import type { CompareMode, MatchResponse, CompareResponse, EventSummary, PopularMatch, CoachingTipResponse, CoachingAvailability, ShooterDashboardResponse, ShooterSearchResult, MatchWeatherData } from "@/lib/types";
import { matchQueryKey, compareQueryKey, coachingAvailabilityKey, coachingTipQueryKey } from "@/lib/query-keys";

// Re-export so existing imports from lib/queries keep working.
export { matchQueryKey, compareQueryKey };

export function useMatchQuery(ct: string, id: string) {
  return useQuery<MatchResponse, Error>({
    queryKey: matchQueryKey(ct, id),
    queryFn: () => fetchMatch(ct, id),
    staleTime: 30_000, // 30 seconds — matches server freshness window for live matches
    // Keep prior data in the client cache for 30 minutes so back-navigation
    // and tab-return show data instantly while a background refetch resolves,
    // instead of triggering a fresh skeleton load.
    gcTime: 1_800_000,
    // Poll while the match is active (scoring in progress and results not yet
    // published). The server's stale-while-revalidate path makes these polls
    // cheap — they almost always resolve from Redis without blocking on the
    // upstream GraphQL API.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const isComplete =
        data.results_status === "all" ||
        data.match_status === "cp" ||
        data.scoring_completed >= 95;
      return isComplete ? false : 30_000;
    },
    enabled: Boolean(ct && id),
  });
}

export function useEventsQuery(
  q: string,
  starts_after?: string,
  starts_before?: string,
  firearms?: string,
  country?: string,
  minLevel?: string,
) {
  return useQuery<EventSummary[], Error>({
    queryKey: ["events", q, starts_after, starts_before, firearms, country, minLevel],
    queryFn: () => fetchEvents(q, starts_after, starts_before, firearms, country, minLevel),
    staleTime: 300_000, // 5 minutes — well inside 1h server cache TTL
  });
}

export function usePopularMatchesQuery() {
  return useQuery<PopularMatch[], Error>({
    queryKey: ["popular-matches"],
    queryFn: fetchPopularMatches,
    staleTime: 300_000, // 5 minutes
  });
}

export function useCompareQuery(
  ct: string,
  id: string,
  competitorIds: number[],
  mode: CompareMode = "coaching",
) {
  return useQuery<CompareResponse, Error>({
    queryKey: compareQueryKey(ct, id, competitorIds, mode),
    queryFn: () => fetchCompare(ct, id, competitorIds, mode),
    staleTime: mode === "live" ? 30_000 : 300_000,
    refetchInterval: mode === "live" ? 30_000 : false,
    enabled: Boolean(ct && id && competitorIds.length > 0),
  });
}

export function useCoachingAvailability() {
  return useQuery<CoachingAvailability, Error>({
    queryKey: coachingAvailabilityKey(),
    queryFn: fetchCoachingAvailability,
    staleTime: 300_000, // 5 minutes
  });
}

export function useShooterDashboardQuery(shooterId: number | null) {
  return useQuery<ShooterDashboardResponse, Error>({
    queryKey: ["shooter-dashboard", shooterId],
    queryFn: () => fetchShooterDashboard(shooterId!),
    // staleTime: 0 — always refetch on mount so newly indexed matches appear
    // immediately after visiting a match. The server caches the computed result,
    // so refetches are cheap (usually a single Redis read).
    staleTime: 0,
    enabled: shooterId != null && shooterId > 0,
  });
}

export function useShooterSearchQuery(query: string, limit = 20, enabled = true) {
  return useQuery<ShooterSearchResult[], Error>({
    queryKey: ["shooter-search", query, limit],
    queryFn: () => fetchShooterSearch(query, limit),
    staleTime: 60_000,
    enabled,
  });
}

export function usePreMatchBriefQuery(
  ct: string,
  id: string,
  shooterId: number | null,
  enabled: boolean,
) {
  return useQuery<CoachingTipResponse, Error>({
    queryKey: ["pre-match-brief", ct, id, shooterId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (shooterId != null) params.set("shooterId", String(shooterId));
      const res = await fetch(`/api/pre-match/brief/${ct}/${id}?${params}`);
      if (!res.ok) throw new Error("Brief unavailable");
      return res.json() as Promise<CoachingTipResponse>;
    },
    enabled,
    staleTime: 1_800_000, // 30 minutes — mirrors server cache TTL
    retry: false,
  });
}

export function usePreMatchWeatherQuery(
  lat: number | null,
  lng: number | null,
  date: string | null,
  venue: string | null,
  region: string | null,
) {
  return useQuery<MatchWeatherData, Error>({
    queryKey: ["pre-match-weather", lat?.toFixed(4), lng?.toFixed(4), date, venue, region],
    queryFn: async () => {
      const params = new URLSearchParams({ date: date!.slice(0, 10) });
      if (lat != null) params.set("lat", String(lat));
      if (lng != null) params.set("lng", String(lng));
      if (venue) params.set("venue", venue);
      if (region) params.set("region", region);
      const res = await fetch(`/api/pre-match/weather?${params}`);
      if (!res.ok) throw new Error("Weather unavailable");
      return res.json() as Promise<MatchWeatherData>;
    },
    // Fetch when we have either GPS coords or a venue name to geocode.
    enabled: date != null && (lat != null && lng != null || venue != null),
    staleTime: 3_600_000, // 1 hour — mirrors server revalidate
    retry: false,
  });
}

export function useCoachingTipQuery(
  ct: string,
  id: string,
  competitorId: number,
  mode: "coach" | "roast" = "coach",
) {
  return useQuery<CoachingTipResponse, Error>({
    queryKey: coachingTipQueryKey(ct, id, competitorId, mode),
    queryFn: () => fetchCoachingTip(ct, id, competitorId, mode),
    enabled: false, // manual trigger only — user opens popover
    staleTime: Infinity, // tips for completed matches never go stale
    retry: false,
  });
}
