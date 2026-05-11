import { describe, it, expect, vi } from "vitest";
import {
  syncServiceAccountAccess,
  type MatchRoleRecord,
  type ServiceAccountAccessFetcher,
  type ViewerSnapshot,
} from "@/lib/service-account-access";
import type { AppDatabase } from "@/lib/db";
import type { ServiceAccountAccessUpsert } from "@/lib/types";

interface UpsertCall {
  row: ServiceAccountAccessUpsert;
  now: string;
}

function createMockDb(initialRevokedCount = 0): {
  db: AppDatabase;
  upsertCalls: UpsertCall[];
  revokeCalls: Array<{ cutoff: string; reason: string; revokedAt: string }>;
} {
  const upsertCalls: UpsertCall[] = [];
  const revokeCalls: Array<{ cutoff: string; reason: string; revokedAt: string }> = [];
  // Cast through unknown — we only stub the methods the sync needs.
  const db = {
    upsertServiceAccountAccess: vi.fn(async (row: ServiceAccountAccessUpsert, now: string) => {
      upsertCalls.push({ row, now });
    }),
    markStaleServiceAccountAccessRevoked: vi.fn(
      async (cutoff: string, reason: string, revokedAt: string) => {
        revokeCalls.push({ cutoff, reason, revokedAt });
        return initialRevokedCount;
      },
    ),
  } as unknown as AppDatabase;
  return { db, upsertCalls, revokeCalls };
}

function createMockFetcher(
  viewer: ViewerSnapshot,
  matchRoles: MatchRoleRecord[],
): ServiceAccountAccessFetcher {
  return {
    fetchViewer: vi.fn().mockResolvedValue(viewer),
    fetchMatchRoles: vi.fn().mockResolvedValue(matchRoles),
  };
}

describe("syncServiceAccountAccess", () => {
  it("upserts one row per club, organizer club, membership, and match role", async () => {
    const { db, upsertCalls, revokeCalls } = createMockDb();
    const fetcher = createMockFetcher(
      {
        clubs: [
          { id: "2", name: "S:t Eskils Skyttar", shortName: null, orgType: "club" },
        ],
        organizerClubs: [
          { id: "11", name: "Bromma PK", shortName: "Bromma", orgType: "club" },
        ],
        organizationMembers: [
          {
            organization: { id: "2", name: "S:t Eskils Skyttar", shortName: null, orgType: "club" },
            memberType: "regular",
            status: "active",
            memberStartDate: "2024-01-01",
            memberEndDate: null,
            isMembershipValid: true,
          },
        ],
      },
      [
        {
          ssiId: "27216",
          ssiContentType: 22,
          name: "S:t Eskils Cupen Hagel 2026 September",
          starts: "2026-09-20T14:00:00+00:00",
          discipline: "IPSC Shotgun",
          visibility: "clb",
          roleNames: ["staff"],
          organizer: { id: "2", name: "S:t Eskils Skyttar", shortName: null, orgType: "club" },
        },
      ],
    );

    const result = await syncServiceAccountAccess(db, fetcher);

    expect(result.clubsCount).toBe(1);
    expect(result.organizerClubsCount).toBe(1);
    expect(result.organizationMembersCount).toBe(1);
    expect(result.matchRolesCount).toBe(1);
    expect(upsertCalls).toHaveLength(4);
    expect(upsertCalls.map((c) => c.row.kind)).toEqual([
      "club_loose",
      "organizer_club",
      "organization_member",
      "match_role",
    ]);
    // Each upsert uses the same `now` value so the revocation sweep can
    // identify stale rows by < cutoff.
    const nows = new Set(upsertCalls.map((c) => c.now));
    expect(nows.size).toBe(1);
    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0].reason).toBe("not_seen_in_sync");
    expect(revokeCalls[0].cutoff).toBe([...nows][0]);
  });

  it("maps club_loose rows with the org's name + short_name", async () => {
    const { db, upsertCalls } = createMockDb();
    const fetcher = createMockFetcher(
      {
        clubs: [{ id: "2", name: "Test Club", shortName: "TC", orgType: "club" }],
        organizerClubs: [],
        organizationMembers: [],
      },
      [],
    );
    await syncServiceAccountAccess(db, fetcher);
    expect(upsertCalls[0].row).toMatchObject({
      kind: "club_loose",
      ssiId: "2",
      name: "Test Club",
      shortName: "TC",
      orgType: "club",
      roleNames: [],
      ssiContentType: null,
    });
  });

  it("maps organization_member rows with all membership fields", async () => {
    const { db, upsertCalls } = createMockDb();
    const fetcher = createMockFetcher(
      {
        clubs: [],
        organizerClubs: [],
        organizationMembers: [
          {
            organization: { id: "9", name: "Klub Nine", shortName: null, orgType: "club" },
            memberType: "honorary",
            status: "active",
            memberStartDate: "2020-04-01",
            memberEndDate: "2030-04-01",
            isMembershipValid: true,
          },
        ],
      },
      [],
    );
    await syncServiceAccountAccess(db, fetcher);
    expect(upsertCalls[0].row).toMatchObject({
      kind: "organization_member",
      ssiId: "9",
      memberType: "honorary",
      memberStatus: "active",
      memberStartDate: "2020-04-01",
      memberEndDate: "2030-04-01",
      isMembershipValid: true,
    });
  });

  it("maps match_role rows with content type, role names, visibility, and host org", async () => {
    const { db, upsertCalls } = createMockDb();
    const fetcher = createMockFetcher(
      { clubs: [], organizerClubs: [], organizationMembers: [] },
      [
        {
          ssiId: "27190",
          ssiContentType: 22,
          name: "SPSK Open 2026",
          starts: "2026-04-26T08:00:00+00:00",
          discipline: "IPSC Handgun",
          visibility: "pub",
          roleNames: ["staff", "scorekeeper"],
          organizer: { id: "5", name: "SPSK", shortName: "SPSK", orgType: "club" },
        },
      ],
    );
    await syncServiceAccountAccess(db, fetcher);
    expect(upsertCalls[0].row).toMatchObject({
      kind: "match_role",
      ssiId: "27190",
      ssiContentType: 22,
      name: "SPSK Open 2026",
      matchStarts: "2026-04-26T08:00:00+00:00",
      discipline: "IPSC Handgun",
      matchVisibility: "pub",
      roleNames: ["staff", "scorekeeper"],
    });
  });

  it("handles match_role rows with no organizer (null host)", async () => {
    const { db, upsertCalls } = createMockDb();
    const fetcher = createMockFetcher(
      { clubs: [], organizerClubs: [], organizationMembers: [] },
      [
        {
          ssiId: "99999",
          ssiContentType: 22,
          name: "Orphan match",
          starts: null,
          discipline: null,
          visibility: "clb",
          roleNames: ["staff"],
          organizer: null,
        },
      ],
    );
    await syncServiceAccountAccess(db, fetcher);
    expect(upsertCalls[0].row.shortName).toBeNull();
    expect(upsertCalls[0].row.orgType).toBeNull();
  });

  it("revokes stale rows (those not bumped in this sync) at the end", async () => {
    const { db, revokeCalls } = createMockDb(3); // 3 stale rows
    const fetcher = createMockFetcher(
      { clubs: [], organizerClubs: [], organizationMembers: [] },
      [],
    );
    const result = await syncServiceAccountAccess(db, fetcher);
    expect(result.revokedCount).toBe(3);
    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0].reason).toBe("not_seen_in_sync");
  });

  it("returns startedAt and finishedAt ISO timestamps", async () => {
    const { db } = createMockDb();
    const fetcher = createMockFetcher(
      { clubs: [], organizerClubs: [], organizationMembers: [] },
      [],
    );
    const result = await syncServiceAccountAccess(db, fetcher);
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(result.finishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result.startedAt).getTime(),
    );
  });

  it("works with an empty viewer + empty match roles (idempotent no-op upsert)", async () => {
    const { db, upsertCalls, revokeCalls } = createMockDb();
    const fetcher = createMockFetcher(
      { clubs: [], organizerClubs: [], organizationMembers: [] },
      [],
    );
    const result = await syncServiceAccountAccess(db, fetcher);
    expect(upsertCalls).toHaveLength(0);
    expect(revokeCalls).toHaveLength(1); // still runs the sweep
    expect(result.clubsCount).toBe(0);
    expect(result.matchRolesCount).toBe(0);
  });
});
