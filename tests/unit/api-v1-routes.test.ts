// Snapshot tests for /api/v1/* response shapes.
//
// The whole point of the v1 contract is that splitsmith (and any future
// consumer) can pin to it. These snapshots fail CI if the shape drifts --
// any field rename or removal is a breaking change that requires v2.
// Additive changes (new optional fields) need an intentional snapshot update.
//
// Fixtures are typed against the real interfaces in lib/types.ts via
// `satisfies`, so the typechecker also catches drift between the fixture and
// the production type -- the snapshot alone could lock a fictional shape if
// the fixture was hand-written without that constraint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CompetitorStageResults,
  EventSummary,
  MatchResponse,
  ShooterDashboardResponse,
  ShooterSearchResult,
} from "@/lib/types";

const cacheMock = vi.hoisted(() => ({
  get: vi.fn<(k: string) => Promise<string | null>>(),
  set: vi.fn<(k: string, v: string, ttl?: number) => Promise<void>>(),
}));
vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

// Stub each inner route handler so we can drive the v1 wrapper directly
// without spinning up real GraphQL / cache / DB layers.
const innerEvents = vi.hoisted(() => vi.fn<(req: Request) => Promise<Response>>());
const innerMatch = vi.hoisted(() =>
  vi.fn<(req: Request, ctx: { params: Promise<{ ct: string; id: string }> }) => Promise<Response>>(),
);
const innerShooterSearch = vi.hoisted(() => vi.fn<(req: Request) => Promise<Response>>());
const innerShooterDashboard = vi.hoisted(() =>
  vi.fn<(req: Request, ctx: { params: Promise<{ shooterId: string }> }) => Promise<Response>>(),
);
const innerCompetitorStages = vi.hoisted(() =>
  vi.fn<(
    req: Request,
    ctx: { params: Promise<{ ct: string; id: string; competitorId: string }> },
  ) => Promise<Response>>(),
);

vi.mock("@/app/api/events/route", () => ({ GET: innerEvents }));
vi.mock("@/app/api/match/[ct]/[id]/route", () => ({ GET: innerMatch }));
vi.mock("@/app/api/shooter/search/route", () => ({ GET: innerShooterSearch }));
vi.mock("@/app/api/shooter/[shooterId]/route", () => ({ GET: innerShooterDashboard }));
vi.mock("@/app/api/match/[ct]/[id]/competitor/[competitorId]/stages/route", () => ({
  GET: innerCompetitorStages,
}));

const ORIGINAL_TOKENS = process.env.EXTERNAL_API_TOKENS;

beforeEach(() => {
  process.env.EXTERNAL_API_TOKENS = "secret-token";
  cacheMock.get.mockResolvedValue(null);
  cacheMock.set.mockResolvedValue(undefined);
  innerEvents.mockReset();
  innerMatch.mockReset();
  innerShooterSearch.mockReset();
  innerShooterDashboard.mockReset();
  innerCompetitorStages.mockReset();
});

afterEach(() => {
  if (ORIGINAL_TOKENS === undefined) delete process.env.EXTERNAL_API_TOKENS;
  else process.env.EXTERNAL_API_TOKENS = ORIGINAL_TOKENS;
});

const auth = { Authorization: "Bearer secret-token" } as const;

describe("/api/v1/events", () => {
  it("requires a bearer token", async () => {
    const { GET } = await import("@/app/api/v1/events/route");
    const res = await GET(new Request("http://x/api/v1/events"));
    expect(res.status).toBe(401);
    expect(innerEvents).not.toHaveBeenCalled();
  });

  it("forwards query params and returns the inner payload unchanged", async () => {
    // Real EventSummary shape -- the `satisfies` clause makes the typechecker
    // fail this test if the fixture drifts from the production interface.
    const payload = [
      {
        id: 27190,
        content_type: 22,
        name: "SPSK Open 2026",
        venue: "Stockholm",
        date: "2026-04-26T00:00:00",
        ends: "2026-04-27T00:00:00",
        status: "on",
        region: "SWE",
        discipline: "IPSC Handgun",
        level: "Level III",
        registration_status: "cl",
        registration_starts: null,
        registration_closes: null,
        is_registration_possible: false,
        squadding_starts: null,
        squadding_closes: null,
        is_squadding_possible: false,
        max_competitors: 240,
        scoring_completed: 42.5,
      },
    ] satisfies EventSummary[];
    innerEvents.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { GET } = await import("@/app/api/v1/events/route");
    const res = await GET(
      new Request("http://x/api/v1/events?q=SPSK&minLevel=l2plus&country=SWE", { headers: auth }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchSnapshot();

    const innerReq = innerEvents.mock.calls[0]![0];
    expect(innerReq.url).toBe("http://x/api/events?q=SPSK&minLevel=l2plus&country=SWE");
  });

  it("maps inner 502 to upstream_failed envelope", async () => {
    innerEvents.mockResolvedValue(
      new Response(JSON.stringify({ error: "SSI down" }), { status: 502 }),
    );
    const { GET } = await import("@/app/api/v1/events/route");
    const res = await GET(new Request("http://x/api/v1/events", { headers: auth }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchSnapshot();
  });
});

describe("/api/v1/match/[ct]/[id]", () => {
  it("returns the match payload through the v1 envelope", async () => {
    const payload = {
      name: "SPSK Open 2026",
      venue: "Stockholm",
      lat: 59.3293,
      lng: 18.0686,
      date: "2026-04-26T00:00:00",
      ends: "2026-04-27T00:00:00",
      level: "Level III",
      sub_rule: null,
      discipline: "IPSC Handgun",
      region: "SWE",
      stages_count: 12,
      competitors_count: 200,
      max_competitors: 240,
      scoring_completed: 100,
      match_status: "cp",
      results_status: "all",
      registration_status: "cl",
      registration_starts: null,
      registration_closes: null,
      is_registration_possible: false,
      squadding_starts: null,
      squadding_closes: null,
      is_squadding_possible: false,
      ssi_url: "https://shootnscoreit.com/event/22/27190/",
      stages: [
        {
          id: 1,
          name: "Stage 1",
          stage_number: 1,
          max_points: 150,
          min_rounds: 30,
          paper_targets: 12,
          steel_targets: 2,
          ssi_url: null,
          course_display: "Long",
          procedure: null,
          firearm_condition: null,
        },
      ],
      competitors: [
        {
          id: 101,
          shooterId: 12345,
          name: "Jane Doe",
          competitor_number: "1",
          club: "Bromma PK",
          division: "Production Optics",
          region: "SWE",
          region_display: "Sweden",
          category: "L",
          ics_alias: null,
          license: "SE-12345",
        },
      ],
      squads: [{ id: 1, number: 1, name: "Squad 1", competitorIds: [101] }],
      cacheInfo: { cachedAt: "2026-04-27T10:00:00Z" },
    } satisfies MatchResponse;
    innerMatch.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Server-Timing": "graphql;dur=12.0;desc=\"GraphQL fetch\"",
        },
      }),
    );

    const { GET } = await import("@/app/api/v1/match/[ct]/[id]/route");
    const res = await GET(
      new Request("http://x/api/v1/match/22/27190", { headers: auth }),
      { params: Promise.resolve({ ct: "22", id: "27190" }) },
    );
    expect(res.status).toBe(200);
    // Server-Timing should be stripped from the v1 envelope.
    expect(res.headers.get("Server-Timing")).toBeNull();
    expect(await res.json()).toMatchSnapshot();
  });

  it("maps a 404 from the inner route to not_found", async () => {
    innerMatch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Match not found" }), { status: 404 }),
    );
    const { GET } = await import("@/app/api/v1/match/[ct]/[id]/route");
    const res = await GET(
      new Request("http://x/api/v1/match/22/99999", { headers: auth }),
      { params: Promise.resolve({ ct: "22", id: "99999" }) },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchSnapshot();
  });

  it("maps a 400 from the inner route to bad_request", async () => {
    innerMatch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid content_type" }), { status: 400 }),
    );
    const { GET } = await import("@/app/api/v1/match/[ct]/[id]/route");
    const res = await GET(
      new Request("http://x/api/v1/match/abc/27190", { headers: auth }),
      { params: Promise.resolve({ ct: "abc", id: "27190" }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchSnapshot();
  });
});

describe("/api/v1/shooter/search", () => {
  it("returns shooter search results", async () => {
    const payload = [
      {
        shooterId: 12345,
        name: "Jane Doe",
        club: "Bromma PK",
        division: "Production Optics",
        lastSeen: "2026-04-27T00:00:00Z",
      },
      {
        shooterId: 67890,
        name: "John Doe",
        club: null,
        division: null,
        lastSeen: "2025-09-12T00:00:00Z",
      },
    ] satisfies ShooterSearchResult[];
    innerShooterSearch.mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const { GET } = await import("@/app/api/v1/shooter/search/route");
    const res = await GET(
      new Request("http://x/api/v1/shooter/search?q=doe&limit=10", { headers: auth }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchSnapshot();
  });
});

describe("/api/v1/shooter/[shooterId]", () => {
  it("returns the shooter dashboard payload", async () => {
    const payload = {
      shooterId: 12345,
      profile: {
        name: "Jane Doe",
        club: "Bromma PK",
        division: "Production Optics",
        lastSeen: "2026-04-27T00:00:00Z",
        region: "SWE",
        region_display: "Sweden",
        category: "L",
        ics_alias: null,
        license: "SE-12345",
      },
      matchCount: 1,
      matches: [
        {
          ct: "22",
          matchId: "27190",
          name: "SPSK Open 2026",
          date: "2026-04-26T00:00:00",
          venue: "Stockholm",
          level: "Level III",
          region: "Sweden",
          division: "Production Optics",
          competitorId: 101,
          competitorsInDivision: 42,
          stageCount: 12,
          avgHF: 6.42,
          matchPct: 87.4,
          totalA: 200,
          totalC: 40,
          totalD: 5,
          totalMiss: 2,
          totalNoShoots: 0,
        },
      ],
      stats: {
        totalStages: 12,
        dateRange: { from: "2026-04-26T00:00:00", to: "2026-04-26T00:00:00" },
        overallAvgHF: 6.42,
        overallMatchPct: 87.4,
        aPercent: 81.0,
        cPercent: 16.0,
        dPercent: 2.0,
        missPercent: 1.0,
        consistencyCV: null,
        hfTrendSlope: null,
      },
      achievements: [],
    } satisfies ShooterDashboardResponse;
    innerShooterDashboard.mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const { GET } = await import("@/app/api/v1/shooter/[shooterId]/route");
    const res = await GET(
      new Request("http://x/api/v1/shooter/12345", { headers: auth }),
      { params: Promise.resolve({ shooterId: "12345" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchSnapshot();
  });

  it("maps GDPR 410 to not_found preserving the 410 status code", async () => {
    innerShooterDashboard.mockResolvedValue(
      new Response(JSON.stringify({ error: "This profile has been removed at the owner's request" }), {
        status: 410,
      }),
    );
    const { GET } = await import("@/app/api/v1/shooter/[shooterId]/route");
    const res = await GET(
      new Request("http://x/api/v1/shooter/12345", { headers: auth }),
      { params: Promise.resolve({ shooterId: "12345" }) },
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchSnapshot();
  });
});

describe("/api/v1/match/[ct]/[id]/competitor/[competitorId]/stages", () => {
  it("returns the per-competitor stage results through the v1 envelope", async () => {
    const payload = {
      ct: 22,
      matchId: 27190,
      competitorId: 101,
      shooterId: 12345,
      division: "Production Optics",
      stages: [
        {
          stage_number: 1,
          stage_id: 5001,
          time_seconds: 18.42,
          scorecard_updated_at: "2026-04-26T09:14:32Z",
          hit_factor: 8.142,
          stage_points: 150,
          stage_pct: 100,
          alphas: 12,
          charlies: 0,
          deltas: 0,
          misses: 0,
          no_shoots: 0,
          procedurals: 0,
          dq: false,
        },
        {
          stage_number: 2,
          stage_id: 5002,
          time_seconds: null,
          scorecard_updated_at: null,
          hit_factor: null,
          stage_points: null,
          stage_pct: null,
          alphas: null,
          charlies: null,
          deltas: null,
          misses: null,
          no_shoots: null,
          procedurals: null,
          dq: false,
        },
      ],
      cacheInfo: {
        cachedAt: "2026-04-27T10:00:00Z",
        scorecardsCachedAt: "2026-04-27T10:00:05Z",
      },
    } satisfies CompetitorStageResults;
    innerCompetitorStages.mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const { GET } = await import(
      "@/app/api/v1/match/[ct]/[id]/competitor/[competitorId]/stages/route"
    );
    const res = await GET(
      new Request("http://x/api/v1/match/22/27190/competitor/101/stages", {
        headers: auth,
      }),
      {
        params: Promise.resolve({ ct: "22", id: "27190", competitorId: "101" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchSnapshot();
  });

  it("maps a 404 from the inner route to not_found", async () => {
    innerCompetitorStages.mockResolvedValue(
      new Response(JSON.stringify({ error: "Competitor not found in this match" }), {
        status: 404,
      }),
    );
    const { GET } = await import(
      "@/app/api/v1/match/[ct]/[id]/competitor/[competitorId]/stages/route"
    );
    const res = await GET(
      new Request("http://x/api/v1/match/22/27190/competitor/999/stages", {
        headers: auth,
      }),
      {
        params: Promise.resolve({ ct: "22", id: "27190", competitorId: "999" }),
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchSnapshot();
  });

  it("maps a 400 from the inner route to bad_request", async () => {
    innerCompetitorStages.mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid ct, id, or competitorId" }), {
        status: 400,
      }),
    );
    const { GET } = await import(
      "@/app/api/v1/match/[ct]/[id]/competitor/[competitorId]/stages/route"
    );
    const res = await GET(
      new Request("http://x/api/v1/match/abc/27190/competitor/101/stages", {
        headers: auth,
      }),
      {
        params: Promise.resolve({ ct: "abc", id: "27190", competitorId: "101" }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchSnapshot();
  });
});
