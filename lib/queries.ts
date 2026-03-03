"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMatch, fetchCompare, fetchEvents, fetchPopularMatches, fetchCoachingAvailability, fetchCoachingTip, fetchShooterDashboard } from "@/lib/api";
import type { CompareMode, MatchResponse, CompareResponse, EventSummary, PopularMatch, CoachingTipResponse, CoachingAvailability, ShooterDashboardResponse } from "@/lib/types";
import { matchQueryKey, compareQueryKey, coachingAvailabilityKey, coachingTipQueryKey } from "@/lib/query-keys";

// Re-export so existing imports from lib/queries keep working.
export { matchQueryKey, compareQueryKey };

export function useMatchQuery(ct: string, id: string) {
  return useQuery<MatchResponse, Error>({
    queryKey: matchQueryKey(ct, id),
    queryFn: () => fetchMatch(ct, id),
    staleTime: 30_000, // 30 seconds
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
    staleTime: 300_000, // 5 minutes — matches server cache TTL
    enabled: shooterId != null && shooterId > 0,
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
