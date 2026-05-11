#!/usr/bin/env tsx
/**
 * Estimate monthly running costs for SSI Scoreboard.
 *
 * Pulls usage from Cloudflare GraphQL Analytics, the Upstash REST API,
 * and (optionally) local Claude Code session logs, then writes
 * app/about/running-costs.json which the /about page renders.
 *
 * Usage:
 *   pnpm costs                  # print table + write JSON
 *   pnpm costs --period 30      # window in days (default 30)
 *   pnpm costs --dry-run        # print only, don't touch JSON
 *   pnpm costs --skip-cc        # skip Claude Code dev-cost estimate
 *
 * Required env (only what each provider actually uses):
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   (Analytics:Read scope)
 *   UPSTASH_EMAIL, UPSTASH_API_KEY                (Upstash Management API)
 *   DOMAIN_ANNUAL_EUR                             (optional, defaults to 11)
 *   USD_EUR_RATE                                  (optional FX override;
 *                                                  otherwise ECB rate via
 *                                                  frankfurter.app)
 *
 * Currency: providers all bill in USD, so internal math stays in USD (matches
 * their pricelists). One conversion happens at output time so stdout, the
 * committed JSON, and the /about page all display EUR. The FX rate used is
 * recorded in the JSON.
 *
 * Public infra figures land in the committed JSON. The Claude Code dev cost
 * is printed to stdout only — it is your tooling spend, not the cost of
 * running the app, and we don't want to mislead readers of /about.
 */

import { writeFileSync, readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// ---------- pricing (USD, public list prices — bump on rate changes) ----------

const PRICES = {
  cloudflare: {
    // Workers Paid plan
    workersBase: 5.0,
    workersIncludedReqM: 10,
    workersOverReqPerM: 0.3,
    workersIncludedCpuMsM: 30,
    workersOverCpuPerM: 0.02,
    // D1
    d1IncludedReadsB: 25,
    d1OverReadPerB: 1.0,            // $1 per billion reads = $0.001/M
    d1IncludedWritesM: 50,
    d1OverWritePerM: 1.0,
    d1IncludedStorageGB: 5,
    d1OverStoragePerGB: 0.75,
    // R2
    r2IncludedStorageGB: 10,
    r2OverStoragePerGB: 0.015,
    r2IncludedClassAM: 1,
    r2OverClassAPerM: 4.5,
    r2IncludedClassBM: 10,
    r2OverClassBPerM: 0.36,
    // Workers AI — generic neuron rate
    aiPer1kNeurons: 0.011,
  },
  upstash: {
    per100kCommands: 0.2,
    storageGB: 0.25,
  },
  // Anthropic public per-Mtok rates (input / output / cache-write / cache-read)
  anthropic: {
    "claude-opus-4-7": { in: 15.0, out: 75.0, cw: 18.75, cr: 1.5 },
    "claude-opus-4-6": { in: 15.0, out: 75.0, cw: 18.75, cr: 1.5 },
    "claude-sonnet-4-6": { in: 3.0, out: 15.0, cw: 3.75, cr: 0.3 },
    "claude-haiku-4-5": { in: 1.0, out: 5.0, cw: 1.25, cr: 0.1 },
  } as Record<string, { in: number; out: number; cw: number; cr: number }>,
  domain: {
    // EUR because that is what the registrar bills the user. Converted to
    // USD internally so the rest of the script can sum in one currency.
    annualEur: Number(process.env.DOMAIN_ANNUAL_EUR ?? "11"),
  },
} as const;

const FX_FALLBACK_USD_EUR = 0.92;

async function getUsdToEur(): Promise<number> {
  const override = Number(process.env.USD_EUR_RATE);
  if (Number.isFinite(override) && override > 0) return override;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR", {
      signal: AbortSignal.timeout(5000),
    });
    const j = (await res.json()) as { rates?: { EUR?: number } };
    const r = j.rates?.EUR;
    if (typeof r === "number" && r > 0) return r;
  } catch {
    // fall through to static fallback
  }
  return FX_FALLBACK_USD_EUR;
}

// ---------- types ----------

type CostLine = {
  label: string;
  usage?: string;
  cost_usd: number;
  note?: string;
};

type ProviderReport = {
  provider: string;
  lines: CostLine[];
  total_usd: number;
  error?: string;
};

// ---------- CLI parsing ----------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const PERIOD_DAYS = Math.max(1, Number(opt("--period", "30")));
const DRY_RUN = flag("--dry-run");
const SKIP_CC = flag("--skip-cc");

const periodEnd = new Date();
const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS * 86400 * 1000);

// ---------- helpers ----------

const fmtBig = (n: number) => n.toLocaleString("en-US");

function overage(used: number, included: number): number {
  return Math.max(0, used - included);
}

// ---------- Cloudflare provider ----------
//
// Four independent GraphQL calls to https://api.cloudflare.com/client/v4/graphql,
// one per data source (workers, D1, R2 ops, R2 storage). A bad field name in
// one source can't poison the others. Workers AI usage is not currently
// queried — the public GraphQL Analytics schema doesn't expose a stable AI
// inference table; revisit when one exists. Account-scoped, so both prod and
// staging workers / DBs / buckets surface in the per-dimension breakdown.

async function cfQuery<T>(
  token: string,
  accountId: string,
  table: string,
  selection: string,
): Promise<{ data: T[]; error?: string }> {
  const query = /* GraphQL */ `
    query ($accountTag: String!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          rows: ${table}(
            filter: { datetime_geq: $start, datetime_leq: $end }
            limit: 200
          ) ${selection}
        }
      }
    }
  `;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          start: periodStart.toISOString(),
          end: periodEnd.toISOString(),
        },
      }),
    });
    const payload = (await res.json()) as {
      data?: { viewer?: { accounts?: Array<{ rows?: T[] }> } };
      errors?: Array<{ message: string }>;
    };
    if (payload.errors?.length) {
      return { data: [], error: payload.errors.map((e) => e.message).join("; ") };
    }
    return { data: payload.data?.viewer?.accounts?.[0]?.rows ?? [] };
  } catch (e) {
    return { data: [], error: (e as Error).message };
  }
}

async function cloudflareProvider(): Promise<ProviderReport> {
  const lines: CostLine[] = [];
  const errors: string[] = [];
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return {
      provider: "Cloudflare",
      lines: [
        {
          label: "Hosting (Cloudflare)",
          cost_usd: PRICES.cloudflare.workersBase,
          note: "base only — CLOUDFLARE_API_TOKEN/ACCOUNT_ID not set",
        },
      ],
      total_usd: PRICES.cloudflare.workersBase,
      error: "missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID",
    };
  }

  // Workers ----------------------------------------------------------------
  type WorkerRow = {
    dimensions: { scriptName: string };
    sum: { requests: number; subrequests?: number; errors?: number };
    quantiles?: { cpuTimeP50?: number };
  };
  const workersRes = await cfQuery<WorkerRow>(
    token,
    accountId,
    "workersInvocationsAdaptive",
    `{
      dimensions { scriptName }
      sum { requests subrequests errors }
      quantiles { cpuTimeP50 }
    }`,
  );
  if (workersRes.error) errors.push(`workers: ${workersRes.error}`);

  let totalRequests = 0;
  let totalCpuMs = 0;
  const workerBreakdown: string[] = [];
  for (const w of workersRes.data) {
    const req = w.sum.requests ?? 0;
    // P50 CPU x requests is a rough proxy for total CPU time (Analytics
    // exposes percentiles, not a sum). Treat as estimate, not invoice.
    const cpuMs = (w.quantiles?.cpuTimeP50 ?? 0) * req;
    totalRequests += req;
    totalCpuMs += cpuMs;
    workerBreakdown.push(`${w.dimensions.scriptName}: ${fmtBig(req)} req`);
  }
  const reqOverM = overage(totalRequests / 1_000_000, PRICES.cloudflare.workersIncludedReqM);
  const cpuOverM = overage(totalCpuMs / 1_000_000, PRICES.cloudflare.workersIncludedCpuMsM);
  const workersCost =
    PRICES.cloudflare.workersBase +
    reqOverM * PRICES.cloudflare.workersOverReqPerM +
    cpuOverM * PRICES.cloudflare.workersOverCpuPerM;
  lines.push({
    label: "Workers (Paid plan + requests/CPU)",
    usage: workerBreakdown.length ? workerBreakdown.join(", ") : workersRes.error ? "n/a" : "no traffic",
    cost_usd: workersCost,
    note: reqOverM === 0 && cpuOverM === 0 ? "below included quota" : undefined,
  });

  // D1 --------------------------------------------------------------------
  type D1Row = {
    dimensions: { databaseId: string };
    sum: { readQueries: number; writeQueries: number; rowsRead?: number; rowsWritten?: number };
  };
  const d1Res = await cfQuery<D1Row>(
    token,
    accountId,
    "d1AnalyticsAdaptiveGroups",
    `{
      dimensions { databaseId }
      sum { readQueries writeQueries rowsRead rowsWritten }
    }`,
  );
  if (d1Res.error) errors.push(`d1: ${d1Res.error}`);

  let totalReads = 0;
  let totalWrites = 0;
  for (const d of d1Res.data) {
    totalReads += d.sum.rowsRead ?? d.sum.readQueries ?? 0;
    totalWrites += d.sum.rowsWritten ?? d.sum.writeQueries ?? 0;
  }
  const readOverB = overage(totalReads / 1e9, PRICES.cloudflare.d1IncludedReadsB);
  const writeOverM = overage(totalWrites / 1_000_000, PRICES.cloudflare.d1IncludedWritesM);
  const d1Cost =
    readOverB * PRICES.cloudflare.d1OverReadPerB +
    writeOverM * PRICES.cloudflare.d1OverWritePerM;
  if (totalReads > 0 || totalWrites > 0) {
    lines.push({
      label: "D1 (reads + writes, both DBs)",
      usage: `${fmtBig(totalReads)} reads, ${fmtBig(totalWrites)} writes`,
      cost_usd: d1Cost,
      note: d1Cost === 0 ? "below included quota" : undefined,
    });
  }

  // R2 ops ----------------------------------------------------------------
  type R2OpRow = {
    dimensions: { bucketName: string; actionType: string };
    sum: { requests: number };
  };
  const r2OpsRes = await cfQuery<R2OpRow>(
    token,
    accountId,
    "r2OperationsAdaptiveGroups",
    `{
      dimensions { bucketName actionType }
      sum { requests }
    }`,
  );
  if (r2OpsRes.error) errors.push(`r2 ops: ${r2OpsRes.error}`);

  let classA = 0;
  let classB = 0;
  for (const op of r2OpsRes.data) {
    // Action types: ListBuckets/PutObject/DeleteObject = Class A,
    // GetObject/HeadObject = Class B. Conservative split: anything not
    // explicitly read-shaped counts as Class A.
    const isClassB = /Get|Head/.test(op.dimensions.actionType);
    if (isClassB) classB += op.sum.requests ?? 0;
    else classA += op.sum.requests ?? 0;
  }

  // R2 storage ------------------------------------------------------------
  type R2StorageRow = {
    dimensions: { bucketName: string };
    max: { payloadSize?: number; metadataSize?: number };
  };
  const r2StorageRes = await cfQuery<R2StorageRow>(
    token,
    accountId,
    "r2StorageAdaptiveGroups",
    `{
      dimensions { bucketName }
      max { payloadSize metadataSize }
    }`,
  );
  if (r2StorageRes.error) errors.push(`r2 storage: ${r2StorageRes.error}`);

  let r2StorageBytes = 0;
  for (const s of r2StorageRes.data) {
    r2StorageBytes += (s.max.payloadSize ?? 0) + (s.max.metadataSize ?? 0);
  }
  const r2Gb = r2StorageBytes / 1024 ** 3;
  const r2StorageOver = overage(r2Gb, PRICES.cloudflare.r2IncludedStorageGB);
  const classAOver = overage(classA / 1_000_000, PRICES.cloudflare.r2IncludedClassAM);
  const classBOver = overage(classB / 1_000_000, PRICES.cloudflare.r2IncludedClassBM);
  const r2Cost =
    r2StorageOver * PRICES.cloudflare.r2OverStoragePerGB +
    classAOver * PRICES.cloudflare.r2OverClassAPerM +
    classBOver * PRICES.cloudflare.r2OverClassBPerM;
  if (r2StorageBytes > 0 || classA + classB > 0) {
    lines.push({
      label: "R2 (telemetry buckets)",
      usage: `${r2Gb.toFixed(2)} GB stored, ${fmtBig(classA + classB)} ops`,
      cost_usd: r2Cost,
      note: r2Cost === 0 ? "below included quota" : undefined,
    });
  }

  const total = lines.reduce((s, l) => s + l.cost_usd, 0);
  return {
    provider: "Cloudflare",
    lines,
    total_usd: total,
    error: errors.length ? errors.join(" · ") : undefined,
  };
}

// ---------- Upstash provider ----------
//
// The Management API at api.upstash.com lists every database under the
// account. We sum across all — prod + staging Redis instances appear as
// separate DBs, which gives us the per-env breakdown for free.

async function upstashProvider(): Promise<ProviderReport> {
  const email = process.env.UPSTASH_EMAIL;
  const apiKey = process.env.UPSTASH_API_KEY;
  if (!email || !apiKey) {
    return {
      provider: "Upstash",
      lines: [{ label: "Redis (Upstash)", cost_usd: 0, note: "skipped — UPSTASH_EMAIL/UPSTASH_API_KEY not set" }],
      total_usd: 0,
      error: "missing UPSTASH_EMAIL or UPSTASH_API_KEY",
    };
  }

  const auth = "Basic " + Buffer.from(`${email}:${apiKey}`).toString("base64");

  type Db = { database_id: string; database_name: string; db_disk_threshold?: number };
  let dbs: Db[];
  try {
    const res = await fetch("https://api.upstash.com/v2/redis/databases", {
      headers: { Authorization: auth },
    });
    dbs = (await res.json()) as Db[];
  } catch (e) {
    return {
      provider: "Upstash",
      lines: [{ label: "Redis (Upstash)", cost_usd: 0 }],
      total_usd: 0,
      error: `fetch failed: ${(e as Error).message}`,
    };
  }

  if (!Array.isArray(dbs)) {
    return {
      provider: "Upstash",
      lines: [{ label: "Redis (Upstash)", cost_usd: 0 }],
      total_usd: 0,
      error: `unexpected response: ${JSON.stringify(dbs).slice(0, 200)}`,
    };
  }

  type Stats = {
    daily_billing?: { x: string; y: number }[];
    monthly_billing?: number;
    total_monthly_billing?: number;
  };
  const lines: CostLine[] = [];
  let total = 0;
  for (const db of dbs) {
    try {
      const res = await fetch(
        `https://api.upstash.com/v2/redis/stats/${db.database_id}?period=30d`,
        { headers: { Authorization: auth } },
      );
      const stats = (await res.json()) as Stats;
      // The stats endpoint returns the rolling monthly bill if Upstash has
      // computed it. Fall back to the daily series if not.
      const billed =
        stats.total_monthly_billing ??
        stats.monthly_billing ??
        (stats.daily_billing?.reduce((s, p) => s + (p.y ?? 0), 0) ?? 0);
      lines.push({
        label: `Redis (${db.database_name})`,
        cost_usd: billed,
      });
      total += billed;
    } catch (e) {
      lines.push({
        label: `Redis (${db.database_name})`,
        cost_usd: 0,
        note: `stats unavailable: ${(e as Error).message}`,
      });
    }
  }
  return { provider: "Upstash", lines, total_usd: total };
}

// ---------- Domain provider ----------

function domainProvider(usdToEur: number): ProviderReport {
  const monthlyEur = PRICES.domain.annualEur / 12;
  const monthlyUsd = monthlyEur / usdToEur;
  return {
    provider: "Domain",
    lines: [
      {
        label: "Domain registration",
        cost_usd: monthlyUsd,
        note: `€${PRICES.domain.annualEur.toFixed(0)}/yr ÷ 12`,
      },
    ],
    total_usd: monthlyUsd,
  };
}

// ---------- Claude Code provider (stdout only) ----------
//
// Walks ~/.claude/projects/<this-project>/**/*.jsonl, parses assistant
// messages, sums usage tokens by model over the window, and applies public
// per-Mtok rates. Bracketed model suffixes (e.g. "claude-opus-4-7[1m]") are
// stripped before pricing lookup.

function claudeCodeProvider(): ProviderReport {
  const projectDir = join(homedir(), ".claude", "projects", "-Users-mathias-work-ssi-scoreboard");
  if (!existsSync(projectDir)) {
    return {
      provider: "Claude Code",
      lines: [{ label: "Claude Code (dev)", cost_usd: 0, note: "no session logs found" }],
      total_usd: 0,
    };
  }

  type Usage = {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const byModel = new Map<string, { in: number; out: number; cw: number; cr: number }>();
  const cutoff = periodStart.getTime();

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
      } else if (name.endsWith(".jsonl")) {
        let raw: string;
        try {
          raw = readFileSync(p, "utf8");
        } catch {
          continue;
        }
        for (const line of raw.split("\n")) {
          if (!line) continue;
          let obj: {
            type?: string;
            timestamp?: string;
            message?: { model?: string; usage?: Usage };
          };
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.type !== "assistant") continue;
          const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
          if (!Number.isFinite(ts) || ts < cutoff) continue;
          const model = obj.message?.model ?? "unknown";
          const u = obj.message?.usage ?? {};
          const key = model.replace(/\[.*?\]$/, "");
          const acc = byModel.get(key) ?? { in: 0, out: 0, cw: 0, cr: 0 };
          acc.in += u.input_tokens ?? 0;
          acc.out += u.output_tokens ?? 0;
          acc.cw += u.cache_creation_input_tokens ?? 0;
          acc.cr += u.cache_read_input_tokens ?? 0;
          byModel.set(key, acc);
        }
      }
    }
  }
  walk(projectDir);

  const lines: CostLine[] = [];
  let total = 0;
  for (const [model, tok] of byModel) {
    const rates = PRICES.anthropic[model] ?? PRICES.anthropic["claude-sonnet-4-6"];
    const cost =
      (tok.in / 1e6) * rates.in +
      (tok.out / 1e6) * rates.out +
      (tok.cw / 1e6) * rates.cw +
      (tok.cr / 1e6) * rates.cr;
    total += cost;
    lines.push({
      label: model,
      usage: `${fmtBig(tok.in + tok.cw + tok.cr)} in / ${fmtBig(tok.out)} out`,
      cost_usd: cost,
    });
  }
  return { provider: "Claude Code", lines, total_usd: total };
}

// ---------- main ----------

async function main() {
  const usdToEur = await getUsdToEur();
  const fmt = (usd: number) => `€${(usd * usdToEur).toFixed(2)}`;

  const [cf, upstash, cc] = await Promise.all([
    cloudflareProvider(),
    upstashProvider(),
    Promise.resolve(SKIP_CC ? null : claudeCodeProvider()),
  ]);
  const domain = domainProvider(usdToEur);

  const infra = [cf, upstash, domain];
  const infraTotal = infra.reduce((s, r) => s + r.total_usd, 0);

  // ---------- pretty print ----------
  console.log(
    `\nRunning costs · ${PERIOD_DAYS}d window ending ${periodEnd.toISOString().slice(0, 10)}` +
      `  ·  USD→EUR ${usdToEur.toFixed(4)}\n`,
  );
  for (const r of infra) {
    console.log(`${r.provider}${r.error ? `  ⚠ ${r.error}` : ""}`);
    for (const l of r.lines) {
      const u = l.usage ? `  (${l.usage})` : "";
      const n = l.note ? `  — ${l.note}` : "";
      console.log(`  ${l.label.padEnd(38)} ${fmt(l.cost_usd).padStart(8)}${u}${n}`);
    }
    console.log(`  ${"total".padEnd(38)} ${fmt(r.total_usd).padStart(8)}\n`);
  }
  console.log(`INFRA TOTAL${" ".repeat(31)} ${fmt(infraTotal).padStart(8)}\n`);

  if (cc) {
    console.log(`Claude Code (dev cost, not shown in /about):`);
    for (const l of cc.lines) {
      const u = l.usage ? `  (${l.usage})` : "";
      const n = l.note ? `  — ${l.note}` : "";
      console.log(`  ${l.label.padEnd(38)} ${fmt(l.cost_usd).padStart(8)}${u}${n}`);
    }
    console.log(`  ${"total".padEnd(38)} ${fmt(cc.total_usd).padStart(8)}\n`);
  }

  // ---------- write JSON ----------
  const out = {
    updated: periodEnd.toISOString().slice(0, 10),
    period_days: PERIOD_DAYS,
    currency: "EUR",
    usd_to_eur_rate: Number(usdToEur.toFixed(4)),
    lines: infra.flatMap((r) =>
      r.lines.map((l) => ({
        label: l.label,
        amount: Number((l.cost_usd * usdToEur).toFixed(2)),
        ...(l.note ? { note: l.note } : {}),
      })),
    ),
    total: Number((infraTotal * usdToEur).toFixed(2)),
    notes: infra.flatMap((r) => (r.error ? [`${r.provider}: ${r.error}`] : [])),
  };

  if (DRY_RUN) {
    console.log("(dry-run — not writing JSON)");
    return;
  }

  const jsonPath = resolve(__dirname, "..", "app", "about", "running-costs.json");
  writeFileSync(jsonPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${jsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
