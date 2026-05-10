// Admin health dashboard — a single mobile-friendly page that aggregates
// the last 1h/24h of telemetry from the Pipelines-written Parquet store.
//
// Auth: ?token=<ADMIN_DASHBOARD_TOKEN> in the URL. Bookmark the URL on your
// phone home screen for one-tap access; treat it like a shared secret.

import { headers } from "next/headers";
import Link from "next/link";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import cache from "@/lib/cache-impl";
import {
  buildDashboard,
  type DashboardData,
  type R2Bucket,
} from "@/lib/admin-health";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_KEY = "admin:health:rollup";
const CACHE_TTL_SECONDS = 60;

interface CFEnvWithBucket {
  TELEMETRY_BUCKET?: R2Bucket;
}

interface PageProps {
  searchParams: Promise<{ token?: string; refresh?: string }>;
}

export default async function AdminHealthPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // Two valid tokens:
  //   ADMIN_DASHBOARD_TOKEN — share-only, rotatable independently
  //   CACHE_PURGE_SECRET    — already used for /admin; lets a signed-in admin
  //                           jump straight to /admin/health without juggling secrets
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

  const data = await loadDashboard(params.refresh === "1");
  if (!data) {
    return (
      <main className="mx-auto max-w-md p-4">
        <Card>
          <CardHeader>
            <CardTitle>No telemetry data</CardTitle>
            <CardDescription>
              The TELEMETRY_BUCKET binding is missing or no Parquet files have
              been written yet. Try again in a few minutes.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const generated = new Date(data.generated_at);
  // Keep the bookmark intact across refreshes by passing the (already
  // validated) provided token through — works for both share-token and
  // signed-in admin paths.
  const refreshHref = `/admin/health?token=${encodeURIComponent(
    provided as string,
  )}&refresh=1`;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3 pb-24">
      <header className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-semibold">Health</h1>
        <Link
          href={refreshHref}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Refresh dashboard"
        >
          refresh
        </Link>
      </header>

      <SsiCard label="SSI (last hour)" data={data.ssi_h1} />
      <SsiCard label="SSI (last 24h)" data={data.ssi_h24} />
      <ErrorsCard label="Scoreboard errors (1h)" data={data.app_errors_h1} />
      <ErrorsCard label="Scoreboard errors (24h)" data={data.app_errors_h24} />
      <CacheCard h1={data.cache_h1} h24={data.cache_h24} />
      <UsageCard data={data.usage_today} />
      <TopMatchesCard data={data.top_matches_h24} />
      <RecentErrorsCard data={data.recent_errors} />

      <footer className="px-1 pt-2 text-xs text-muted-foreground">
        Generated {generated.toISOString()} ·{" "}
        {data.events_scanned.toLocaleString()} events ·{" "}
        {data.files_scanned} parquet files
      </footer>
    </main>
  );
}

async function loadDashboard(refresh: boolean): Promise<DashboardData | null> {
  // Touch the request headers so Next treats this as a dynamic render.
  await headers();

  if (!refresh) {
    const cached = await cache.get(CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as DashboardData;
      } catch {
        // fall through
      }
    }
  }

  const { env } = getCloudflareContext() as unknown as { env: CFEnvWithBucket };
  const bucket = env?.TELEMETRY_BUCKET;
  if (!bucket) return null;

  const data = await buildDashboard(bucket);
  await cache.set(CACHE_KEY, JSON.stringify(data), CACHE_TTL_SECONDS);
  return data;
}

function statusTone(ok_pct: number): string {
  if (ok_pct >= 99) return "text-emerald-600 dark:text-emerald-400";
  if (ok_pct >= 95) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function SsiCard({
  label,
  data,
}: {
  label: string;
  data: DashboardData["ssi_h1"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          {data.calls.toLocaleString()} GraphQL calls
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className={`text-3xl font-semibold ${statusTone(data.ok_pct)}`}>
          {data.ok_pct.toFixed(1)}%{" "}
          <span className="text-base font-normal text-muted-foreground">ok</span>
        </div>
        {data.by_op.length > 0 ? (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">op</th>
                  <th className="px-2 text-right font-normal">ok / err</th>
                  <th className="px-2 text-right font-normal">p50</th>
                  <th className="text-right font-normal">p95</th>
                </tr>
              </thead>
              <tbody>
                {data.by_op.map((row) => (
                  <tr key={row.operation}>
                    <td className="py-1 pr-2 font-mono">{row.operation}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {row.ok}
                      {row.err > 0 ? (
                        <span className="text-rose-600 dark:text-rose-400">
                          {" "}
                          / {row.err}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{row.p50_ms}</td>
                    <td className="py-1 text-right tabular-nums">{row.p95_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No calls in window.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorsCard({
  label,
  data,
}: {
  label: string;
  data: DashboardData["app_errors_h1"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          className={`text-3xl font-semibold ${
            data.count === 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {data.count}
        </div>
        {data.by_site.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {data.by_site.map((row) => (
              <li
                key={row.site}
                className="flex items-center justify-between gap-2"
              >
                <span className="font-mono">{row.site}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CacheCard({
  h1,
  h24,
}: {
  h1: DashboardData["cache_h1"];
  h24: DashboardData["cache_h24"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cache hit rate</CardTitle>
        <CardDescription>match-view cache hits</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-around gap-4">
        <CacheStat label="last hour" pct={h1.hit_pct} samples={h1.samples} />
        <CacheStat label="last 24h" pct={h24.hit_pct} samples={h24.samples} />
      </CardContent>
    </Card>
  );
}

function CacheStat({
  label,
  pct,
  samples,
}: {
  label: string;
  pct: number;
  samples: number;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-2xl font-semibold tabular-nums">
        {samples > 0 ? `${pct.toFixed(1)}%` : "—"}
      </div>
      <div className="text-xs text-muted-foreground">
        {label} · n={samples}
      </div>
    </div>
  );
}

function UsageCard({
  data,
}: {
  data: DashboardData["usage_today"];
}) {
  const cells: { label: string; n: number }[] = [
    { label: "match views", n: data.match_views },
    { label: "comparisons", n: data.comparisons },
    { label: "searches", n: data.searches },
    { label: "dashboards", n: data.dashboards },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage today</CardTitle>
        <CardDescription>since 00:00 UTC</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {cells.map((c) => (
            <div key={c.label} className="flex flex-col">
              <span className="text-2xl font-semibold tabular-nums">
                {c.n.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopMatchesCard({
  data,
}: {
  data: DashboardData["top_matches_h24"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top matches (24h)</CardTitle>
        <CardDescription>by cache decisions</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ol className="-mx-2 flex flex-col text-sm">
            {data.map((m, i) => (
              <li key={m.match_id}>
                <Link
                  href={`/match/22/${m.match_id}`}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-md px-2 hover:bg-muted"
                >
                  <span>
                    <span className="text-muted-foreground">#{i + 1}</span>{" "}
                    <span className="font-mono">{m.match_id}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {m.count}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function RecentErrorsCard({
  data,
}: {
  data: DashboardData["recent_errors"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent errors</CardTitle>
        <CardDescription>last 10 in 24h</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {data.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-l-2 border-rose-500/40 pl-2">
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{e.ts.slice(11, 19)}Z</span>
                  <span className="font-mono">{e.site}</span>
                </div>
                {e.errorClass ? (
                  <div className="font-mono text-xs">{e.errorClass}</div>
                ) : null}
                {e.errorMsg ? (
                  <div className="break-words text-xs text-muted-foreground">
                    {e.errorMsg.slice(0, 200)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
