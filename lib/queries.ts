"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMatch, fetchCompare, fetchEvents } from "@/lib/api";
import type { MatchResponse, CompareResponse, EventSummary } from "@/lib/types";

export function useMatchQuery(ct: string, id: string) {
  return useQuery<MatchResponse, Error>({
    queryKey: ["match", ct, id],
    queryFn: () => fetchMatch(ct, id),
    staleTime: 30_000, // 30 seconds
    enabled: Boolean(ct && id),
  });
}

export function useEventsQuery(q: string) {
  return useQuery<EventSummary[], Error>({
    queryKey: ["events", q],
    queryFn: () => fetchEvents(q),
    staleTime: 60_000, // 1 minute
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
    staleTime: 15_000, // 15 seconds
    refetchInterval: 30_000, // poll every 30s while mounted
    enabled: Boolean(ct && id && competitorIds.length > 0),
  });
}
