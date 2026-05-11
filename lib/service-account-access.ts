// Server-only — never import from client components.
//
// Sync routine for the service-account access audit catalog.
//
// Builds the union of three SSI authorization signals into a single durable
// catalog in the AppDatabase. Each sync:
//   1. Fetches the bot's clubs / organizer_clubs / organization_members from
//      `me { ... }` and per-match roles from `events(has_role: true)`.
//   2. Upserts a row per grant, bumping `last_verified_at` to the sync
//      timestamp and clearing any previous `revoked_at`.
//   3. Sweeps every active row whose `last_verified_at` predates this sync
//      and marks them revoked. The "had access between X and Y" history
//      remains queryable for audit.
//
// The function is dependency-injected so unit tests can drive it with mock
// fetchers + an in-memory DB stub. The live fetcher (`buildLiveFetcher`)
// wraps `lib/graphql.executeQuery` and is the only place that touches the
// network. Cron / admin-route plumbing lives elsewhere.

import { executeQuery } from "@/lib/graphql";
import type { AppDatabase } from "@/lib/db";
import type { ServiceAccountAccessUpsert } from "@/lib/types";

export interface OrganizationRef {
  id: string;
  name: string;
  shortName: string | null;
  orgType: string | null;
}

export interface MembershipRecord {
  organization: OrganizationRef;
  memberType: string | null;
  status: string | null;
  memberStartDate: string | null;
  memberEndDate: string | null;
  isMembershipValid: boolean;
}

export interface MatchRoleRecord {
  ssiId: string;
  ssiContentType: number;
  name: string;
  starts: string | null;
  discipline: string | null;
  visibility: string | null;
  roleNames: string[];
  organizer: OrganizationRef | null;
}

export interface ViewerSnapshot {
  clubs: OrganizationRef[];
  organizerClubs: OrganizationRef[];
  organizationMembers: MembershipRecord[];
}

export interface ServiceAccountAccessFetcher {
  fetchViewer(): Promise<ViewerSnapshot>;
  fetchMatchRoles(): Promise<MatchRoleRecord[]>;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  clubsCount: number;
  organizerClubsCount: number;
  organizationMembersCount: number;
  matchRolesCount: number;
  revokedCount: number;
}

export async function syncServiceAccountAccess(
  db: AppDatabase,
  fetcher: ServiceAccountAccessFetcher,
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const viewer = await fetcher.fetchViewer();
  const matchRoles = await fetcher.fetchMatchRoles();

  // Stamp every upsert in this run with the same timestamp so the
  // post-sync sweep can identify rows that were not touched.
  const upsertAt = new Date().toISOString();

  for (const club of viewer.clubs) {
    await db.upsertServiceAccountAccess(toClubLooseRow(club), upsertAt);
  }
  for (const club of viewer.organizerClubs) {
    await db.upsertServiceAccountAccess(toOrganizerClubRow(club), upsertAt);
  }
  for (const m of viewer.organizationMembers) {
    await db.upsertServiceAccountAccess(toMembershipRow(m), upsertAt);
  }
  for (const m of matchRoles) {
    await db.upsertServiceAccountAccess(toMatchRoleRow(m), upsertAt);
  }

  const revokedCount = await db.markStaleServiceAccountAccessRevoked(
    upsertAt,
    "not_seen_in_sync",
    upsertAt,
  );

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    clubsCount: viewer.clubs.length,
    organizerClubsCount: viewer.organizerClubs.length,
    organizationMembersCount: viewer.organizationMembers.length,
    matchRolesCount: matchRoles.length,
    revokedCount,
  };
}

// ── Row mappers ────────────────────────────────────────────────────────────

function toClubLooseRow(o: OrganizationRef): ServiceAccountAccessUpsert {
  return {
    kind: "club_loose",
    ssiId: o.id,
    ssiContentType: null,
    name: o.name,
    shortName: o.shortName,
    orgType: o.orgType,
    discipline: null,
    roleNames: [],
    memberType: null,
    memberStatus: null,
    memberStartDate: null,
    memberEndDate: null,
    isMembershipValid: null,
    matchVisibility: null,
    matchStarts: null,
  };
}

function toOrganizerClubRow(o: OrganizationRef): ServiceAccountAccessUpsert {
  return {
    kind: "organizer_club",
    ssiId: o.id,
    ssiContentType: null,
    name: o.name,
    shortName: o.shortName,
    orgType: o.orgType,
    discipline: null,
    roleNames: [],
    memberType: null,
    memberStatus: null,
    memberStartDate: null,
    memberEndDate: null,
    isMembershipValid: null,
    matchVisibility: null,
    matchStarts: null,
  };
}

function toMembershipRow(m: MembershipRecord): ServiceAccountAccessUpsert {
  return {
    kind: "organization_member",
    ssiId: m.organization.id,
    ssiContentType: null,
    name: m.organization.name,
    shortName: m.organization.shortName,
    orgType: m.organization.orgType,
    discipline: null,
    roleNames: [],
    memberType: m.memberType,
    memberStatus: m.status,
    memberStartDate: m.memberStartDate,
    memberEndDate: m.memberEndDate,
    isMembershipValid: m.isMembershipValid,
    matchVisibility: null,
    matchStarts: null,
  };
}

function toMatchRoleRow(m: MatchRoleRecord): ServiceAccountAccessUpsert {
  // Match rows reuse the org-shaped name/short_name columns for the host
  // organization where one is known. Keeps the catalog joinable to
  // `service_account_access` rows of kind=club_* without a second table.
  return {
    kind: "match_role",
    ssiId: m.ssiId,
    ssiContentType: m.ssiContentType,
    name: m.name,
    shortName: m.organizer?.name ?? null,
    orgType: m.organizer?.orgType ?? null,
    discipline: m.discipline,
    roleNames: m.roleNames,
    memberType: null,
    memberStatus: null,
    memberStartDate: null,
    memberEndDate: null,
    isMembershipValid: null,
    matchVisibility: m.visibility,
    matchStarts: m.starts,
  };
}

// ── Live GraphQL fetcher ───────────────────────────────────────────────────

const VIEWER_QUERY = `
  query ServiceAccountViewer {
    me {
      id
      email
      clubs { id name short_name org_type }
      organizer_clubs { id name short_name org_type }
      organization_members {
        id
        status
        member_type
        member_start_date
        member_end_date
        is_membership_valid
        in_organization { id name short_name org_type }
      }
    }
  }
`;

const HAS_ROLE_EVENTS_QUERY = `
  query ServiceAccountHasRoleEvents {
    events(has_role: true) {
      id
      get_content_type_key
      name
      starts
      get_full_rule_display
      ... on IpscMatchNode {
        visibility
        role_names
        organizer { id name short_name org_type }
      }
    }
  }
`;

interface RawOrganizationRef {
  id?: string | null;
  name?: string | null;
  short_name?: string | null;
  org_type?: string | null;
}

interface RawMembership {
  id?: string | null;
  status?: string | null;
  member_type?: string | null;
  member_start_date?: string | null;
  member_end_date?: string | null;
  is_membership_valid?: boolean | null;
  in_organization?: RawOrganizationRef | null;
}

interface RawViewerResponse {
  me?: {
    clubs?: RawOrganizationRef[] | null;
    organizer_clubs?: RawOrganizationRef[] | null;
    organization_members?: RawMembership[] | null;
  } | null;
}

interface RawEvent {
  id?: string | null;
  get_content_type_key?: number | null;
  name?: string | null;
  starts?: string | null;
  get_full_rule_display?: string | null;
  visibility?: string | null;
  role_names?: string[] | null;
  organizer?: RawOrganizationRef | null;
}

interface RawEventsResponse {
  events?: RawEvent[] | null;
}

function parseOrganizationRef(raw: RawOrganizationRef | null | undefined): OrganizationRef | null {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    name: raw.name ?? "",
    shortName: raw.short_name ?? null,
    orgType: raw.org_type ?? null,
  };
}

export function buildLiveFetcher(): ServiceAccountAccessFetcher {
  return {
    async fetchViewer() {
      const raw = await executeQuery<RawViewerResponse>(VIEWER_QUERY);
      const me = raw.me;
      const clubs: OrganizationRef[] = [];
      const organizerClubs: OrganizationRef[] = [];
      const organizationMembers: MembershipRecord[] = [];

      for (const c of me?.clubs ?? []) {
        const ref = parseOrganizationRef(c);
        if (ref) clubs.push(ref);
      }
      for (const c of me?.organizer_clubs ?? []) {
        const ref = parseOrganizationRef(c);
        if (ref) organizerClubs.push(ref);
      }
      for (const m of me?.organization_members ?? []) {
        const org = parseOrganizationRef(m.in_organization);
        if (!org) continue;
        organizationMembers.push({
          organization: org,
          memberType: m.member_type ?? null,
          status: m.status ?? null,
          memberStartDate: m.member_start_date ?? null,
          memberEndDate: m.member_end_date ?? null,
          isMembershipValid: !!m.is_membership_valid,
        });
      }

      return { clubs, organizerClubs, organizationMembers };
    },

    async fetchMatchRoles() {
      const raw = await executeQuery<RawEventsResponse>(HAS_ROLE_EVENTS_QUERY);
      const out: MatchRoleRecord[] = [];
      for (const ev of raw.events ?? []) {
        if (!ev.id || ev.get_content_type_key == null) continue;
        out.push({
          ssiId: ev.id,
          ssiContentType: ev.get_content_type_key,
          name: ev.name ?? "",
          starts: ev.starts ?? null,
          discipline: ev.get_full_rule_display ?? null,
          visibility: ev.visibility ?? null,
          roleNames: Array.isArray(ev.role_names) ? ev.role_names : [],
          organizer: parseOrganizationRef(ev.organizer),
        });
      }
      return out;
    },
  };
}
