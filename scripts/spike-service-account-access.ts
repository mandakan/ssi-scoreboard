#!/usr/bin/env tsx
/**
 * Spike: discover what SSI exposes for the service account's memberships.
 *
 * READ ONLY. Authenticates as the service account (SSI_SERVICE_EMAIL /
 * SSI_SERVICE_PASSWORD), introspects membership-related types, and runs a
 * handful of probe queries. Writes a markdown report to ~/.claude-tmp/.
 *
 * Usage: pnpm tsx scripts/spike-service-account-access.ts
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ENDPOINT = "https://shootnscoreit.com/graphql/";
const TYPES_TO_INTROSPECT = [
  "ShooterNode",
  "OrganizationNode",
  "OrganizationMemberNode",
  "IpscMatchNode",
];

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

interface RawType { name: string | null; kind: string; ofType?: RawType | null }
function typeRef(t: RawType): string {
  if (t.kind === "NON_NULL" && t.ofType) return `${typeRef(t.ofType)}!`;
  if (t.kind === "LIST" && t.ofType) return `[${typeRef(t.ofType)}]`;
  return t.name ?? t.kind;
}

async function loginForJwt(apiKey: string, email: string, password: string): Promise<string> {
  const query = "mutation Login($email: String!, $pwd: String!) { token_auth(email: $email, password: $pwd) { success errors token { token } } }";
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, variables: { email, pwd: password } }),
  });
  if (!r.ok) throw new Error(`token_auth HTTP ${r.status}`);
  const json = (await r.json()) as {
    data?: { token_auth?: { success?: boolean; errors?: unknown; token?: { token?: string } | null } | null };
    errors?: { message: string }[];
  };
  if (json.errors?.length) throw new Error(`token_auth GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  const tok = json.data?.token_auth?.token?.token;
  if (!tok) throw new Error(`token_auth rejected: ${JSON.stringify(json.data?.token_auth?.errors ?? "unknown")}`);
  return tok;
}

interface FieldEntry {
  name: string;
  type: string;
  args: { name: string; type: string }[];
  isDeprecated: boolean;
}

async function introspectType(typeName: string, apiKey: string, jwt: string): Promise<FieldEntry[]> {
  const query = `{ __type(name: "${typeName}") { fields(includeDeprecated: true) { name isDeprecated type { name kind ofType { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } args { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } } } }`;
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `JWT ${jwt}`, "x-api-key": apiKey },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`introspect ${typeName} HTTP ${r.status}`);
  const json = (await r.json()) as { data?: { __type?: { fields?: { name: string; isDeprecated?: boolean; type: RawType; args: { name: string; type: RawType }[] }[] | null } | null } };
  return (json.data?.__type?.fields ?? [])
    .map((f) => ({
      name: f.name,
      type: typeRef(f.type),
      args: (f.args ?? []).map((a) => ({ name: a.name, type: typeRef(a.type) })),
      isDeprecated: !!f.isDeprecated,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function gql<T>(apiKey: string, jwt: string, query: string, variables?: Record<string, unknown>): Promise<{ data: T | null; errors: { message: string }[] | null }> {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `JWT ${jwt}`, "x-api-key": apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) return { data: null, errors: [{ message: `HTTP ${r.status}` }] };
  const json = (await r.json()) as { data?: T; errors?: { message: string }[] };
  return { data: json.data ?? null, errors: json.errors ?? null };
}

function pickMembershipLikeFields(fields: FieldEntry[]): FieldEntry[] {
  const keywords = ["organization", "club", "membership", "member", "role", "staff", "admin", "invite", "permission"];
  return fields.filter((f) => {
    const name = f.name.toLowerCase();
    return keywords.some((k) => name.includes(k));
  });
}

function fmtFieldList(fields: FieldEntry[]): string {
  if (!fields.length) return "_(no fields matched)_";
  return fields.map((f) => `- \`${f.name}\`: \`${f.type}\`${f.args.length ? ` — args: ${f.args.map((a) => `${a.name}: ${a.type}`).join(", ")}` : ""}${f.isDeprecated ? " *(deprecated)*" : ""}`).join("\n");
}

async function main() {
  loadEnvFile(join(process.cwd(), ".env.local"));
  const apiKey = process.env.SSI_API_KEY;
  const email = process.env.SSI_SERVICE_EMAIL;
  const password = process.env.SSI_SERVICE_PASSWORD;
  if (!apiKey || !email || !password) {
    console.error("Missing SSI_API_KEY / SSI_SERVICE_EMAIL / SSI_SERVICE_PASSWORD in env.");
    process.exit(2);
  }

  console.log("[spike] logging in as service account...");
  const jwt = await loginForJwt(apiKey, email, password);

  const sections: string[] = [];
  sections.push(`# Spike: Service Account Access Discovery\n`);
  sections.push(`Generated: ${new Date().toISOString()}\n`);
  sections.push(`Endpoint: ${ENDPOINT}\n`);
  sections.push(`Service account: ${email}\n`);

  // 1. Introspect membership-related types
  for (const typeName of TYPES_TO_INTROSPECT) {
    console.log(`[spike] introspecting ${typeName}...`);
    try {
      const fields = await introspectType(typeName, apiKey, jwt);
      const matched = pickMembershipLikeFields(fields);
      sections.push(`\n## \`${typeName}\` membership-related fields (${matched.length} of ${fields.length} total)\n`);
      sections.push(fmtFieldList(matched));
      sections.push(`\n<details><summary>All ${fields.length} fields on ${typeName}</summary>\n\n${fmtFieldList(fields)}\n\n</details>`);
    } catch (e) {
      sections.push(`\n## \`${typeName}\` introspection FAILED\n\n\`\`\`\n${String(e)}\n\`\`\``);
    }
  }

  // 2. Probe `me` with minimal common fields
  console.log("[spike] probing me { id email }...");
  const meProbe = await gql<{ me: { id?: string; email?: string } | null }>(apiKey, jwt, `{ me { id email } }`);
  sections.push(`\n## Probe: \`me { id email }\`\n`);
  sections.push("```json\n" + JSON.stringify({ data: meProbe.data, errors: meProbe.errors }, null, 2) + "\n```");

  // 3. Probe events with has_role: true (events where service account has any role)
  console.log("[spike] probing events(has_role: true)...");
  const eventsProbe = await gql<{ events: { id: string; get_content_type_key?: string; name?: string; starts?: string; visibility?: string }[] | null }>(
    apiKey,
    jwt,
    `{
      events(rule: "ip", has_role: true) {
        id
        get_content_type_key
        name
        starts
        ... on IpscMatchNode {
          visibility
          get_visibility_display
          is_current_role_admin
          is_current_role_assistant
          is_current_role_staff
        }
      }
    }`,
  );
  sections.push(`\n## Probe: \`events(rule: "ip", has_role: true)\`\n`);
  const eventsList = Array.isArray(eventsProbe.data?.events) ? eventsProbe.data.events : [];
  sections.push(`Returned ${eventsList.length} events.\n`);
  if (eventsList.length > 0) {
    const sample = eventsList.slice(0, 10);
    sections.push("Sample (first 10):\n\n```json\n" + JSON.stringify(sample, null, 2) + "\n```");
  }
  if (eventsProbe.errors) {
    sections.push("\nErrors:\n\n```json\n" + JSON.stringify(eventsProbe.errors, null, 2) + "\n```");
  }

  // 4. If we got an event, try get_visibility_choices on it (it's an IpscMatchNode field)
  const firstEvent = eventsProbe.data?.events?.[0];
  if (firstEvent?.id && firstEvent.get_content_type_key) {
    // get_content_type_key is the integer key as a string; need to parse
    const ct = parseInt(firstEvent.get_content_type_key, 10);
    console.log(`[spike] probing get_visibility_choices on event ct=${ct} id=${firstEvent.id}...`);
    const choicesProbe = await gql<{ event: { get_visibility_choices?: unknown } | null }>(
      apiKey,
      jwt,
      `query Probe($ct: Int!, $id: String!) {
        event(content_type: $ct, id: $id) {
          ... on IpscMatchNode {
            get_visibility_choices
            get_visibility_display
            visibility
          }
        }
      }`,
      { ct, id: firstEvent.id },
    );
    sections.push(`\n## Probe: \`get_visibility_choices\` on event ct=${ct} id=${firstEvent.id}\n`);
    sections.push("```json\n" + JSON.stringify({ data: choicesProbe.data, errors: choicesProbe.errors }, null, 2) + "\n```");
  } else {
    sections.push(`\n## Probe: \`get_visibility_choices\`\n\n_(skipped — no event returned to use as anchor)_`);
  }

  // 4b. Re-probe get_visibility_choices with proper subfield selection on a known match
  if (firstEvent?.id && firstEvent.get_content_type_key) {
    const ct = parseInt(firstEvent.get_content_type_key, 10);
    console.log(`[spike] probing get_visibility_choices (with subfields) on event ct=${ct} id=${firstEvent.id}...`);
    const choicesProbe2 = await gql<{ event: { get_visibility_choices?: { value: string; text: string }[] } | null }>(
      apiKey,
      jwt,
      `query Probe($ct: Int!, $id: String!) {
        event(content_type: $ct, id: $id) {
          ... on IpscMatchNode {
            visibility
            get_visibility_display
            get_visibility_choices { value text }
          }
        }
      }`,
      { ct, id: firstEvent.id },
    );
    sections.push(`\n## Probe: \`get_visibility_choices { value text }\`\n`);
    sections.push("```json\n" + JSON.stringify({ data: choicesProbe2.data, errors: choicesProbe2.errors }, null, 2) + "\n```");
  }

  // 5. Probe me { clubs, organization_members, organizer_clubs } — the membership audit view
  console.log("[spike] probing me { clubs, organization_members, organizer_clubs }...");
  const meMembersProbe = await gql<unknown>(
    apiKey,
    jwt,
    `{
      me {
        id
        email
        clubs { id name short_name org_type country }
        organizer_clubs { id name short_name }
        organization_members(status: "active") {
          id
          status
          member_type
          officials_roles
          member_start_date
          member_end_date
          is_membership_valid
          in_organization { id name short_name org_type }
        }
      }
    }`,
  );
  sections.push(`\n## Probe: \`me { clubs, organizer_clubs, organization_members }\`\n`);
  sections.push("```json\n" + JSON.stringify({ data: meMembersProbe.data, errors: meMembersProbe.errors }, null, 2) + "\n```");

  // 6. Collect the unique visibility values across all has_role events
  if (eventsList.length > 0) {
    const visibilityCounts = new Map<string, number>();
    const roleCounts = { admin: 0, assistant: 0, staff: 0, none: 0 };
    for (const ev of eventsList as { visibility?: string; is_current_role_admin?: boolean; is_current_role_assistant?: boolean; is_current_role_staff?: boolean }[]) {
      const v = ev.visibility ?? "(missing)";
      visibilityCounts.set(v, (visibilityCounts.get(v) ?? 0) + 1);
      if (ev.is_current_role_admin) roleCounts.admin++;
      else if (ev.is_current_role_assistant) roleCounts.assistant++;
      else if (ev.is_current_role_staff) roleCounts.staff++;
      else roleCounts.none++;
    }
    sections.push(`\n## Aggregate over ${eventsList.length} has_role events\n`);
    sections.push(`**Visibility distribution:**\n`);
    for (const [v, c] of [...visibilityCounts.entries()].sort((a, b) => b[1] - a[1])) {
      sections.push(`- \`${v}\`: ${c}`);
    }
    sections.push(`\n**Role distribution:** admin=${roleCounts.admin}, assistant=${roleCounts.assistant}, staff=${roleCounts.staff}, no-role-flag=${roleCounts.none}`);
  }

  // 7. Inheritance probe: is match-staff implicitly granted by club-staff?
  // Pick a known staff match, fetch its host org, and compare role_names on the
  // match vs is_current_role_* on the host org. If the org has staff role and
  // the match's role_names looks delegated (e.g. inherits from org), hypothesis confirmed.
  if (firstEvent?.id && firstEvent.get_content_type_key) {
    const ct = parseInt(firstEvent.get_content_type_key, 10);
    console.log(`[spike] inheritance probe on match ct=${ct} id=${firstEvent.id}...`);
    const inheritanceProbe = await gql<unknown>(
      apiKey,
      jwt,
      `query Probe($ct: Int!, $id: String!) {
        event(content_type: $ct, id: $id) {
          ... on IpscMatchNode {
            id
            name
            visibility
            role_names
            is_current_role_admin
            is_current_role_assistant
            is_current_role_staff
            organizer {
              id
              name
              short_name
              org_type
              is_current_role_admin
              is_current_role_assistant
              is_current_role_staff
            }
          }
        }
      }`,
      { ct, id: firstEvent.id },
    );
    sections.push(`\n## Probe: inheritance — match \`role_names\` vs host org roles\n`);
    sections.push("```json\n" + JSON.stringify({ data: inheritanceProbe.data, errors: inheritanceProbe.errors }, null, 2) + "\n```");
  }

  // 8. ChoiceNode shape probe — figure out the right subfield for get_visibility_choices
  console.log("[spike] introspecting ChoiceNode...");
  try {
    const choiceFields = await introspectType("ChoiceNode", apiKey, jwt);
    sections.push(`\n## \`ChoiceNode\` fields (full list)\n\n${fmtFieldList(choiceFields)}`);
  } catch (e) {
    sections.push(`\n## \`ChoiceNode\` introspection FAILED\n\n\`\`\`\n${String(e)}\n\`\`\``);
  }

  // 9. me.organization_members without status filter (status: "active" returned [])
  console.log("[spike] probing me.organization_members (no filter)...");
  const orgMembersAll = await gql<unknown>(
    apiKey,
    jwt,
    `{
      me {
        organization_members {
          id
          status
          get_status_display
          member_type
          officials_roles
          is_membership_valid
          in_organization { id name short_name org_type }
        }
      }
    }`,
  );
  sections.push(`\n## Probe: \`me.organization_members\` (no status filter)\n`);
  sections.push("```json\n" + JSON.stringify({ data: orgMembersAll.data, errors: orgMembersAll.errors }, null, 2) + "\n```");

  // 5. Write report
  const outDir = join(homedir(), ".claude-tmp");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `spike-service-account-access-${ts}.md`);
  writeFileSync(outPath, sections.join("\n"), "utf-8");
  console.log(`[spike] wrote report to ${outPath}`);
}

main().catch((err) => {
  console.error("[spike] failed:", err);
  process.exit(1);
});
