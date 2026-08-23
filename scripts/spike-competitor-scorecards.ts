#!/usr/bin/env tsx
/**
 * Spike: does SSI expose a per-competitor scorecard path we can use instead of
 * the whole-field per-stage fan-out?
 *
 * READ ONLY. Introspects and probes:
 *   - RootQuery.competitor_scorecards(content_type, id, updated_after)
 *   - RootQuery.competitor_scorecards_count(content_type, id)
 *   - IpscCompetitorNode.scorecards(updated_after) / scorecards_count /
 *     latest_scorecard_update
 *   - whether N competitors can be batched via GraphQL aliases in one request
 *
 * Usage: pnpm tsx scripts/spike-competitor-scorecards.ts [ct] [matchId]
 * Throwaway -- delete once the answer is recorded.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ENDPOINT = "https://shootnscoreit.com/graphql/";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));

const API_KEY = process.env.SSI_API_KEY ?? "";
const EMAIL = process.env.SSI_SERVICE_EMAIL ?? "";
const PASSWORD = process.env.SSI_SERVICE_PASSWORD ?? "";

if (!API_KEY) {
  console.error("Missing SSI_API_KEY in .env.local");
  process.exit(1);
}

interface GqlResult<T> {
  data?: T;
  errors?: { message: string }[];
}

let jwt: string | null = null;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<GqlResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
  };
  if (jwt) headers["Authorization"] = `JWT ${jwt}`;
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const text = await r.text();
  try {
    return JSON.parse(text) as GqlResult<T>;
  } catch {
    return { errors: [{ message: `HTTP ${r.status}: ${text.slice(0, 300)}` }] };
  }
}

async function loginForJwt(): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    console.log("No service credentials -- running with api key only");
    return;
  }
  const res = await gql<{ token_auth?: { success?: boolean; token?: { token?: string } | null } }>(
    "mutation Login($email: String!, $pwd: String!) { token_auth(email: $email, password: $pwd) { success token { token } } }",
    { email: EMAIL, pwd: PASSWORD },
  );
  if (res.errors?.length) {
    console.log("login errors:", res.errors.map((e) => e.message).join("; "));
    return;
  }
  jwt = res.data?.token_auth?.token?.token ?? null;
  console.log(jwt ? "Authenticated as service account" : "Login returned no token");
}

const out: string[] = [];
function say(s: string) {
  console.log(s);
  out.push(s);
}

async function main() {
  await loginForJwt();

  const ct = process.argv[2] ?? "22";
  let matchId = process.argv[3] ?? null;

  // ── 0. Find a match with scorecards if none supplied ──────────────────────
  if (!matchId) {
    const res = await gql<{ events: { id: string; name: string; starts: string }[] }>(
      `query { events(levels: "2,3,4,5", starts_before: "${new Date().toISOString().slice(0, 10)}") { id name starts } }`,
    );
    if (res.errors?.length) {
      say(`## FATAL: events query failed\n\n${res.errors.map((e) => e.message).join("; ")}`);
      finish();
      return;
    }
    const events = res.data?.events ?? [];
    const recent = events.sort((a, b) => (a.starts < b.starts ? 1 : -1))[0];
    matchId = recent?.id ?? null;
    say(`Auto-picked match ${matchId} (${recent?.name}, ${recent?.starts})`);
  }

  if (!matchId) {
    say("## FATAL: no match id available");
    finish();
    return;
  }

  // ── 1. Grab a competitor id + its content type ────────────────────────────
  const compRes = await gql<{
    event: {
      name: string;
      stages_count: number;
      competitors_count: number;
      competitors_approved_w_wo_results_not_dnf: {
        id: string;
        get_content_type_key: number;
        first_name: string;
        last_name: string;
      }[];
    };
  }>(
    `query($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) {
        name
        ... on IpscMatchNode {
          stages_count
          competitors_count
          competitors_approved_w_wo_results_not_dnf {
            id
            get_content_type_key
            ... on IpscCompetitorNode { first_name last_name }
          }
        }
      }
    }`,
    { ct: parseInt(ct, 10), id: matchId },
  );

  if (compRes.errors?.length) {
    say(`## FATAL: match query failed\n\n${compRes.errors.map((e) => e.message).join("; ")}`);
    finish();
    return;
  }

  const ev = compRes.data?.event;
  const comps = ev?.competitors_approved_w_wo_results_not_dnf ?? [];
  say(`\n## Match: ${ev?.name} (${ev?.competitors_count} competitors, ${ev?.stages_count} stages)`);
  if (comps.length === 0) {
    say("No competitors -- pick a different match");
    finish();
    return;
  }
  const compCt = comps[0].get_content_type_key;
  say(`Competitor content_type = ${compCt}`);

  const sample = comps.slice(0, 5);
  say(`Sample competitors: ${sample.map((c) => `${c.id} (${c.first_name} ${c.last_name})`).join(", ")}`);

  // ── 2. RootQuery.competitor_scorecards ────────────────────────────────────
  say(`\n## Probe A -- RootQuery.competitor_scorecards(content_type, id, updated_after)`);
  const a = await gql<{ competitor_scorecards: unknown[] }>(
    `query($ct: Int!, $id: String!, $after: String!) {
      competitor_scorecards(content_type: $ct, id: $id, updated_after: $after) {
        ... on IpscScoreCardNode {
          created
          points
          hitfactor
          time
          disqualified
          zeroed
          stage_not_fired
          incomplete
          ascore bscore cscore dscore miss penalty procedural
          stage { id number name ... on IpscStageNode { max_points } }
          competitor { id }
        }
      }
    }`,
    { ct: compCt, id: sample[0].id, after: "1970-01-01T00:00:00Z" },
  );
  if (a.errors?.length) {
    say(`ERRORS: ${a.errors.map((e) => e.message).join("; ")}`);
  } else {
    const cards = a.data?.competitor_scorecards ?? [];
    say(`OK -- ${cards.length} scorecards returned`);
    say("```json\n" + JSON.stringify(cards.slice(0, 2), null, 2) + "\n```");
  }

  // ── 3. RootQuery.competitor_scorecards_count ──────────────────────────────
  say(`\n## Probe B -- RootQuery.competitor_scorecards_count(content_type, id)`);
  const b = await gql<{ competitor_scorecards_count: number }>(
    `query($ct: Int!, $id: String!) { competitor_scorecards_count(content_type: $ct, id: $id) }`,
    { ct: compCt, id: sample[0].id },
  );
  say(b.errors?.length
    ? `ERRORS: ${b.errors.map((e) => e.message).join("; ")}`
    : `OK -- count = ${b.data?.competitor_scorecards_count}`);

  // ── 4. Nested IpscCompetitorNode.scorecards via event ──────────────────────
  say(`\n## Probe C -- event { competitors { scorecards, scorecards_count, latest_scorecard_update } }`);
  const c = await gql<Record<string, unknown>>(
    `query($ct: Int!, $id: String!, $after: String!) {
      event(content_type: $ct, id: $id) {
        ... on IpscMatchNode {
          competitors_approved_w_wo_results_not_dnf {
            id
            ... on IpscCompetitorNode {
              first_name
              scorecards_count
              latest_scorecard_update
              scorecards(updated_after: $after) {
                ... on IpscScoreCardNode {
                  points hitfactor time
                  stage { id number }
                }
              }
            }
          }
        }
      }
    }`,
    { ct: parseInt(ct, 10), id: matchId, after: "1970-01-01T00:00:00Z" },
  );
  if (c.errors?.length) {
    say(`ERRORS: ${c.errors.map((e) => e.message).join("; ")}`);
  } else {
    const json = JSON.stringify(c.data);
    say(`OK -- payload ${json.length} bytes for the whole field`);
    say("```json\n" + json.slice(0, 1200) + "\n```");
  }

  // ── 5. Alias batching: N competitors in ONE request ───────────────────────
  say(`\n## Probe D -- alias batching, ${sample.length} competitors in one request`);
  const aliases = sample
    .map(
      (cp, i) => `c${i}: competitor_scorecards(content_type: $ct, id: "${cp.id}", updated_after: $after) {
        ... on IpscScoreCardNode { points hitfactor time stage { id number } }
      }`,
    )
    .join("\n");
  const tD0 = Date.now();
  const d = await gql<Record<string, unknown[]>>(
    `query($ct: Int!, $after: String!) {\n${aliases}\n}`,
    { ct: compCt, after: "1970-01-01T00:00:00Z" },
  );
  const tD1 = Date.now();
  if (d.errors?.length) {
    say(`ERRORS: ${d.errors.map((e) => e.message).join("; ")}`);
  } else {
    const json = JSON.stringify(d.data);
    const counts = Object.entries(d.data ?? {}).map(([k, v]) => `${k}=${v.length}`).join(" ");
    say(`OK in ${tD1 - tD0}ms -- ${json.length} bytes, ${counts}`);
  }

  // ── 6. Cost baseline: what ONE full-stage pull costs today ────────────────
  say(`\n## Baseline -- one full-stage scorecards pull (what we do today)`);
  const stagesRes = await gql<{ event: { stages: { id: string; number: number }[] } }>(
    `query($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) { ... on IpscMatchNode { stages { id number } } }
    }`,
    { ct: parseInt(ct, 10), id: matchId },
  );
  const stage0 = stagesRes.data?.event?.stages?.[0];
  if (stage0) {
    const tS0 = Date.now();
    const s = await gql<{ stage: { scorecards: unknown[] } }>(
      `query($ct: Int!, $id: String!) {
        stage(content_type: $ct, id: $id) {
          id number name
          ... on IpscStageNode {
            max_points
            scorecards {
              ... on IpscScoreCardNode {
                created points hitfactor time disqualified zeroed stage_not_fired incomplete
                ascore bscore cscore dscore miss penalty procedural
                competitor { id ... on IpscCompetitorNode { first_name last_name number club get_division_display } }
              }
            }
          }
        }
      }`,
      { ct: 24, id: stage0.id },
    );
    const tS1 = Date.now();
    if (s.errors?.length) {
      say(`ERRORS: ${s.errors.map((e) => e.message).join("; ")}`);
    } else {
      const n = s.data?.stage?.scorecards?.length ?? 0;
      say(`stage ${stage0.number}: ${n} scorecards, ${JSON.stringify(s.data).length} bytes, ${tS1 - tS0}ms`);
      say(`-> whole match today = ~${(ev?.stages_count ?? 0)} such pulls per changed cycle`);
    }
  }

  finish();
}

function finish() {
  const dir = join(homedir(), ".claude-tmp");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "spike-competitor-scorecards.md");
  writeFileSync(path, out.join("\n") + "\n");
  console.log(`\nReport written to ${path}`);
}

main().catch((e) => {
  console.error(e);
  finish();
  process.exit(1);
});
