"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMatch, fetchCompare, fetchEvents, fetchPopularMatches } from "@/lib/api";
import type { MatchResponse, CompareResponse, EventSummary, PopularMatch } from "@/lib/types";

export function useMatchQuery(ct: string, id: string) {
  return useQuery<MatchResponse, Error>({
    queryKey: ["match", ct, id],
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
  competitorIds: number[]
) {
  return useQuery<CompareResponse, Error>({
    queryKey: ["compare", ct, id, competitorIds],
    queryFn: () => fetchCompare(ct, id, competitorIds),
    staleTime: 30_000, // 30 seconds — aligned with server cache TTL
    refetchInterval: 30_000, // poll every 30s while mounted
    enabled: Boolean(ct && id && competitorIds.length > 0),
  });
}
