#!/usr/bin/env tsx
/**
 * Drift-detection between the live SSI GraphQL schema and our local snapshot.
 *
 * WHY: With the incremental scorecard delta path (#362) we no longer just cache
 * SSI responses opaquely — we mirror the IpscScoreCardNode / IpscCompetitorNode
 * shape and apply upstream changes incrementally. If SSI silently adds, removes,
 * or renames a field on one of these types, the cached snapshot can drift in
 * subtle, hard-to-debug ways. This script catches drift early, before users do.
 *
 * USAGE:
 *   pnpm tsx scripts/check-ssi-schema.ts                  # report drift, exit 1 if any
 *   pnpm tsx scripts/check-ssi-schema.ts --update         # accept current schema as the new snapshot
 *   pnpm tsx scripts/check-ssi-schema.ts --json           # machine-readable output for CI
 *
 * The snapshot file (scripts/ssi-schema-snapshot.json) is checked into the repo
 * so a `git diff` after running with --update shows exactly what changed.
 *
 * If this script reports drift, see CLAUDE.md → "Delta-merge contract".
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "ssi-schema-snapshot.json");

// Types we depend on. If you start consuming new types from SSI, add them here.
//
// `RootQuery` and `EventInterface` are tracked so the static query validator
// (scripts/validate-ssi-queries.ts) can verify field selections at the top
// level of `event(...)` and `events(...)` — that's where the #367 regression
// hid (`scoring_completed` selected on EventInterface instead of IpscMatchNode).
const TRACKED_TYPES = [
  "RootQuery",
  "EventInterface",
  "IpscMatchNode",
  "IpscStageNode",
  "IpscScoreCardNode",
  "IpscCompetitorNode",
  "IpscSquadNode",
] as const;

interface FieldArg {
  name: string;
  type: string;
}

interface FieldEntry {
  name: string;
  type: string;
  args: FieldArg[];
}

type Snapshot = Record<string, FieldEntry[]>;

interface RawType {
  name: string | null;
  kind: string;
  ofType?: RawType | null;
}

function typeRef(t: RawType): string {
  if (t.kind === "NON_NULL" && t.ofType) return `${typeRef(t.ofType)}!`;
  if (t.kind === "LIST" && t.ofType) return `[${typeRef(t.ofType)}]`;
  return t.name ?? t.kind;
}

async function introspectType(typeName: string, endpoint: string, token: string): Promise<FieldEntry[]> {
  // Five levels of `ofType` lets us name types like `[ChronoCardNode!]!`
  // (NON_NULL → LIST → NON_NULL → ChronoCardNode), which the previous
  // three-level walk reduced to the placeholder `[NON_NULL]!`.
  const query = `{ __type(name: "${typeName}") { fields { name type { name kind ofType { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } args { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } } } }`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${token}`, "x-api-key": token },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SSI HTTP ${r.status}`);
  const json = (await r.json()) as { data?: { __type?: { fields?: { name: string; type: RawType; args: { name: string; type: RawType }[] }[] | null } | null } };
  const fields = json.data?.__type?.fields ?? [];
  return fields
    .map((f): FieldEntry => ({
      name: f.name,
      type: typeRef(f.type),
      args: (f.args ?? []).map((a): FieldArg => ({ name: a.name, type: typeRef(a.type) })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface FieldDiff {
  added: FieldEntry[];
  removed: FieldEntry[];
  changed: { name: string; before: FieldEntry; after: FieldEntry }[];
}

function diffFields(before: FieldEntry[], after: FieldEntry[]): FieldDiff {
  const beforeByName = new Map(before.map((f) => [f.name, f]));
  const afterByName = new Map(after.map((f) => [f.name, f]));
  const added: FieldEntry[] = [];
  const removed: FieldEntry[] = [];
  const changed: { name: string; before: FieldEntry; after: FieldEntry }[] = [];
  for (const [name, fAfter] of afterByName) {
    const fBefore = beforeByName.get(name);
    if (!fBefore) { added.push(fAfter); continue; }
    if (JSON.stringify(fBefore) !== JSON.stringify(fAfter)) {
      changed.push({ name, before: fBefore, after: fAfter });
    }
  }
  for (const [name, fBefore] of beforeByName) {
    if (!afterByName.has(name)) removed.push(fBefore);
  }
  return { added, removed, changed };
}

function loadSnapshot(): Snapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
}

function saveSnapshot(s: Snapshot): void {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(s, null, 2) + "\n", "utf8");
}

async function main() {
  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) {
    console.error("[check-ssi-schema] SSI_API_KEY not set");
    process.exit(2);
  }
  const endpoint = "https://shootnscoreit.com/graphql/";
  const update = process.argv.includes("--update");
  const jsonMode = process.argv.includes("--json");

  const live: Snapshot = {};
  for (const t of TRACKED_TYPES) {
    live[t] = await introspectType(t, endpoint, apiKey);
  }

  const previous = loadSnapshot();
  if (update || !previous) {
    saveSnapshot(live);
    if (!previous) {
      console.log(`[check-ssi-schema] wrote initial snapshot to ${SNAPSHOT_PATH}`);
    } else {
      console.log(`[check-ssi-schema] snapshot updated`);
    }
    return;
  }

  let drifted = false;
  const report: Record<string, FieldDiff> = {};
  for (const t of TRACKED_TYPES) {
    const d = diffFields(previous[t] ?? [], live[t] ?? []);
    if (d.added.length || d.removed.length || d.changed.length) {
      drifted = true;
      report[t] = d;
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(drifted ? 1 : 0);
  }

  if (!drifted) {
    console.log("[check-ssi-schema] no drift — schema matches snapshot");
    return;
  }

  for (const [t, d] of Object.entries(report)) {
    console.log(`\n=== ${t} ===`);
    for (const f of d.added) console.log(`  + ${f.name}: ${f.type}`);
    for (const f of d.removed) console.log(`  - ${f.name}: ${f.type}`);
    for (const c of d.changed) console.log(`  ~ ${c.name}: ${c.before.type} -> ${c.after.type}`);
  }
  console.log("\n[check-ssi-schema] drift detected. See CLAUDE.md -> 'Delta-merge contract' for what to update.");
  console.log("[check-ssi-schema] After updating queries / types / schema version, run `pnpm tsx scripts/check-ssi-schema.ts --update` to accept.");
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-ssi-schema] failed:", err);
  process.exit(2);
});
