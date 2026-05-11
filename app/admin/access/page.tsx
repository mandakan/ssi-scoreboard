// Service-account access audit overview.
//
// Auth: ?token=<CACHE_PURGE_SECRET> (or ADMIN_DASHBOARD_TOKEN) in the URL,
// same shared-secret pattern as /admin/health. Surfaces every club, org
// membership, and per-match role the service account holds, plus the
// served-vs-uncached split powered by match_data_cache.last_accessed_at.

import Link from "next/link";

import db from "@/lib/db-impl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ServiceAccountAccessRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

interface MatchCacheStatus {
  storedAt: string | null;
  lastAccessedAt: string | null;
}

type MatchRow = ServiceAccountAccessRow & { cacheStatus: MatchCacheStatus };

export default async function AdminAccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const provided = params.token;
  const dashboardToken = process.env.ADMIN_DASHBOARD_TOKEN;
  const adminToken = process.env.CACHE_PURGE_SECRET;
  const valid = Boolean(
    provided &&
      ((dashboardToken && provided === dashboardToken) ||
        (adminToken && provided === adminToken)),
  );
  if (!valid) {
    return (
      <main className="mx-auto max-w-md p-4">
        <Card>
          <CardHeader>
            <CardTitle>Unauthorized</CardTitle>
            <CardDescription>
              Append <code>?token=…</code> to the URL.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const rows = await db.listServiceAccountAccess({ includeRevoked: true });
  const cacheEntries = await db.listMatchCacheEntries({ keyType: "match" });
  const cacheStatusByRef = new Map<string, MatchCacheStatus>();
  for (const e of cacheEntries) {
    cacheStatusByRef.set(`${e.ct}:${e.matchId}`, {
      storedAt: e.storedAt,
      lastAccessedAt: e.lastAccessedAt,
    });
  }

  const clubs = rows.filter((r) => r.kind === "club_loose");
  const organizerClubs = rows.filter((r) => r.kind === "organizer_club");
  const memberships = rows.filter((r) => r.kind === "organization_member");
  const matches: MatchRow[] = rows
    .filter((r) => r.kind === "match_role")
    .map((r) => ({
      ...r,
      cacheStatus: cacheStatusByRef.get(`${r.ssiContentType}:${r.ssiId}`) ?? {
        storedAt: null,
        lastAccessedAt: null,
      },
    }));

  // Server Component with `dynamic = "force-dynamic"`: a per-request impure
  // read of the wall clock is intentional — each render computes the cutoff
  // relative to the moment the page was requested.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const matchesServedLast30Days = matches.filter(
    (m) => m.cacheStatus.lastAccessedAt != null && m.cacheStatus.lastAccessedAt >= thirtyDaysAgo,
  ).length;
  const matchesCached = matches.filter((m) => m.cacheStatus.storedAt != null).length;
  const totalActive = rows.filter((r) => r.revokedAt == null).length;
  const totalRevoked = rows.length - totalActive;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3 pb-24">
      <header className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-semibold">Service account access</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
          <CardDescription>
            {totalActive} active grants
            {totalRevoked > 0 ? `, ${totalRevoked} revoked` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Authorized matches" value={matches.filter((m) => m.revokedAt == null).length} />
          <Stat label="Cached locally" value={matchesCached} />
          <Stat label="Served in last 30 days" value={matchesServedLast30Days} />
          <Stat label="Clubs (loose + organizer)" value={clubs.length + organizerClubs.length} />
        </CardContent>
      </Card>

      <ClubsCard
        title="Clubs"
        description={`${clubs.length + organizerClubs.length} associations`}
        loose={clubs}
        organizer={organizerClubs}
      />

      <MembershipsCard rows={memberships} />

      <MatchesCard rows={matches} />

      <footer className="px-1 pt-2 text-xs text-muted-foreground">
        Refresh via{" "}
        <code>POST /api/admin/access/refresh</code> with bearer token, or wait
        for the daily cron.
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function ClubsCard({
  title,
  description,
  loose,
  organizer,
}: {
  title: string;
  description: string;
  loose: ServiceAccountAccessRow[];
  organizer: ServiceAccountAccessRow[];
}) {
  const all = [
    ...organizer.map((r) => ({ row: r, role: "organizer" as const })),
    ...loose.map((r) => ({ row: r, role: "loose" as const })),
  ];
  if (all.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No club associations.</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {all.map(({ row, role }) => (
          <AccessRow
            key={`${row.kind}-${row.id}`}
            row={row}
            badge={role === "organizer" ? "Organizer" : "Loose"}
            href={`https://shootnscoreit.com/organization/${row.ssiId}/`}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function MembershipsCard({ rows }: { rows: ServiceAccountAccessRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization memberships</CardTitle>
          <CardDescription>No formal memberships.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization memberships</CardTitle>
        <CardDescription>{rows.length} membership records</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-1">
            <AccessRow
              row={row}
              badge={row.memberStatus ?? row.memberType ?? "member"}
              href={`https://shootnscoreit.com/organization/${row.ssiId}/`}
            />
            <div className="text-xs text-muted-foreground">
              {row.memberType ?? "member"}
              {row.memberStartDate ? ` · since ${row.memberStartDate.slice(0, 10)}` : ""}
              {row.memberEndDate ? ` · expires ${row.memberEndDate.slice(0, 10)}` : ""}
              {row.isMembershipValid === false ? " · invalid" : ""}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MatchesCard({ rows }: { rows: MatchRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authorized matches</CardTitle>
          <CardDescription>No per-match roles.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Authorized matches</CardTitle>
        <CardDescription>
          {rows.filter((r) => r.revokedAt == null).length} active /{" "}
          {rows.length} total
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {rows.map((row) => {
          const cached = row.cacheStatus.storedAt != null;
          const lastSeen = row.cacheStatus.lastAccessedAt;
          const matchHref = `https://shootnscoreit.com/event/${row.ssiContentType}/${row.ssiId}/`;
          return (
            <div key={row.id} className="flex flex-col gap-1">
              <AccessRow
                row={row}
                badge={row.roleNames[0] ?? "role"}
                href={matchHref}
              />
              <div className="text-xs text-muted-foreground">
                {row.discipline ?? "?"}
                {row.matchVisibility ? ` · vis=${row.matchVisibility}` : ""}
                {row.matchStarts ? ` · ${row.matchStarts.slice(0, 10)}` : ""}
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {cached ? (
                  <Badge variant="secondary">Cached</Badge>
                ) : (
                  <Badge variant="outline">Not cached</Badge>
                )}
                {lastSeen ? (
                  <span className="text-muted-foreground">
                    Last served {lastSeen.slice(0, 16).replace("T", " ")} UTC
                  </span>
                ) : cached ? (
                  <span className="text-muted-foreground">Never served via app</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AccessRow({
  row,
  badge,
  href,
}: {
  row: ServiceAccountAccessRow;
  badge: string;
  href: string;
}) {
  const revoked = row.revokedAt != null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`font-medium hover:underline ${revoked ? "text-muted-foreground line-through" : ""}`}
        >
          {row.name || `#${row.ssiId}`}
        </Link>
        <Badge variant={revoked ? "outline" : "default"} className="shrink-0">
          {badge}
        </Badge>
      </div>
      {revoked ? (
        <div className="text-xs text-destructive">
          Revoked {row.revokedAt?.slice(0, 16).replace("T", " ")} UTC
          {row.revokedReason ? ` · ${row.revokedReason}` : ""}
        </div>
      ) : null}
    </div>
  );
}
