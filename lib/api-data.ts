/**
 * Direct data-fetching functions for use inside the Cloudflare Worker.
 *
 * Cloudflare Workers cannot make HTTP subrequests to the same Cloudflare Pages
 * domain — such calls time out with 522 because there is no separate TCP origin
 * behind the edge.  Instead of going out over the network and back, we call the
 * Next.js App Router route handlers directly as TypeScript functions.  The
 * handlers see a synthetic Request built from the same URL / params they would
 * receive via HTTP, so all existing logic (GraphQL fetch, Redis cache, TTL
 * management, response shaping) runs unchanged.
 *
 * This module is imported only by app/api/mcp/route.ts (the Cloudflare HTTP
 * MCP endpoint).  The stdio server (mcp/src/index.ts) continues to call the
 * live HTTP API via its configured baseUrl, so it never imports this file.
 */

// NOTE: brackets in import paths are literal filesystem characters used by
// Next.js for dynamic route segments — TypeScript resolves them as file paths.
import { GET as eventsGET } from "@/app/api/events/route";
import { GET as matchGET } from "@/app/api/match/[ct]/[id]/route";
import { GET as compareGET } from "@/app/api/compare/route";
import { GET as popularGET } from "@/app/api/popular-matches/route";
import { GET as shooterGET } from "@/app/api/shooter/[shooterId]/route";
import { GET as shooterSearchGET } from "@/app/api/shooter/search/route";
import type { EventSummary, MatchResponse, CompareResponse, PopularMatch, ShooterDashboardResponse, ShooterSearchResult } from "./types";

async function extractJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new Error(
      typeof (body as Record<string, unknown>).error === "string"
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export async function searchEvents(params: {
  query?: string;
  min_level?: "all" | "l2plus" | "l3plus" | "l4plus";
  country?: string;
  starts_after?: string;
  starts_before?: string;
}): Promise<EventSummary[]> {
  const p = new URLSearchParams();
  if (params.query) p.set("q", params.query);
  if (params.min_level) p.set("minLevel", params.min_level);
  if (params.country) p.set("country", params.country);
  if (params.starts_after) p.set("starts_after", params.starts_after);
  if (params.starts_before) p.set("starts_before", params.starts_before);
  const res = await eventsGET(new Request(`http://localhost/api/events?${p}`));
  return extractJson<EventSummary[]>(res);
}

export async function getMatch(ct: string, id: string): Promise<MatchResponse> {
  const res = await matchGET(
    new Request(`http://localhost/api/match/${ct}/${id}`),
    { params: Promise.resolve({ ct, id }) },
  );
  return extractJson<MatchResponse>(res);
}

export async function compareCompetitors(
  ct: string,
  id: string,
  competitorIds: number[],
): Promise<CompareResponse> {
  const p = new URLSearchParams();
  p.set("ct", ct);
  p.set("id", id);
  p.set("competitor_ids", competitorIds.join(","));
  p.set("mode", "coaching");
  const res = await compareGET(new Request(`http://localhost/api/compare?${p}`));
  return extractJson<CompareResponse>(res);
}

export async function getPopularMatches(): Promise<PopularMatch[]> {
  const res = await popularGET();
  return extractJson<PopularMatch[]>(res);
}

export async function searchShooterProfiles(params: {
  query: string;
  limit?: number;
}): Promise<ShooterSearchResult[]> {
  const p = new URLSearchParams({ q: params.query });
  if (params.limit) p.set("limit", String(params.limit));
  const res = await shooterSearchGET(new Request(`http://localhost/api/shooter/search?${p}`));
  return extractJson<ShooterSearchResult[]>(res);
}

export async function getShooterDashboard(shooterId: number): Promise<ShooterDashboardResponse> {
  const res = await shooterGET(
    new Request(`http://localhost/api/shooter/${shooterId}`),
    { params: Promise.resolve({ shooterId: String(shooterId) }) },
  );
  return extractJson<ShooterDashboardResponse>(res);
}
