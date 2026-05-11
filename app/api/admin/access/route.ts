// GET /api/admin/access
// Requires: Authorization: Bearer <CACHE_PURGE_SECRET>
//
// Returns the service-account access catalog (clubs / organizer clubs /
// organization memberships / per-match roles) with each match_role row
// enriched by cache status from `match_data_cache`. Powers the
// /admin/access UI; designed to be served as the SSR data source.

import { NextResponse } from "next/server";
import db from "@/lib/db-impl";
import type { ServiceAccountAccessRow } from "@/lib/types";

interface MatchCacheStatus {
  storedAt: string | null;
  lastAccessedAt: string | null;
}

export interface AccessOverviewResponse {
  clubs: ServiceAccountAccessRow[];
  organizerClubs: ServiceAccountAccessRow[];
  organizationMembers: ServiceAccountAccessRow[];
  matchRoles: Array<ServiceAccountAccessRow & { cacheStatus: MatchCacheStatus }>;
  summary: {
    totalActive: number;
    totalRevoked: number;
    matchesAuthorized: number;
    matchesCached: number;
    matchesServedLast30Days: number;
  };
}

export async function GET(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.listServiceAccountAccess({ includeRevoked: true });

  const clubs = rows.filter((r) => r.kind === "club_loose");
  const organizerClubs = rows.filter((r) => r.kind === "organizer_club");
  const organizationMembers = rows.filter((r) => r.kind === "organization_member");
  const matchRoleRows = rows.filter((r) => r.kind === "match_role");

  // Join with match_data_cache to surface "actually served" status. Single
  // pass over the cache table — much cheaper than N queries.
  const cacheEntries = await db.listMatchCacheEntries({ keyType: "match" });
  const cacheStatusByRef = new Map<string, MatchCacheStatus>();
  for (const e of cacheEntries) {
    cacheStatusByRef.set(`${e.ct}:${e.matchId}`, {
      storedAt: e.storedAt,
      lastAccessedAt: e.lastAccessedAt,
    });
  }

  const matchRoles = matchRoleRows.map((r) => {
    const cacheStatus = cacheStatusByRef.get(`${r.ssiContentType}:${r.ssiId}`) ?? {
      storedAt: null,
      lastAccessedAt: null,
    };
    return { ...r, cacheStatus };
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const matchesServedLast30Days = matchRoles.filter(
    (r) => r.cacheStatus.lastAccessedAt != null && r.cacheStatus.lastAccessedAt >= thirtyDaysAgo,
  ).length;

  const totalActive = rows.filter((r) => r.revokedAt == null).length;
  const totalRevoked = rows.length - totalActive;
  const matchesCached = matchRoles.filter((r) => r.cacheStatus.storedAt != null).length;

  const body: AccessOverviewResponse = {
    clubs,
    organizerClubs,
    organizationMembers,
    matchRoles,
    summary: {
      totalActive,
      totalRevoked,
      matchesAuthorized: matchRoles.filter((r) => r.revokedAt == null).length,
      matchesCached,
      matchesServedLast30Days,
    },
  };

  return NextResponse.json(body);
}
