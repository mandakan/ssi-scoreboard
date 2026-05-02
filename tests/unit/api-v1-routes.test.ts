// Snapshot tests for /api/v1/* response shapes.
//
// The whole point of the v1 contract is that splitsmith (and any future
// consumer) can pin to it. These snapshots fail CI if the shape drifts --
// any field rename or removal is a breaking change that requires v2.
// Additive changes (new optional fields) need an intentional snapshot update.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/app/api/events/route", () => ({ GET: innerEvents }));
vi.mock("@/app/api/match/[ct]/[id]/route", () => ({ GET: innerMatch }));
vi.mock("@/app/api/shooter/search/route", () => ({ GET: innerShooterSearch }));
vi.mock("@/app/api/shooter/[shooterId]/route", () => ({ GET: innerShooterDashboard }));

const ORIGINAL_TOKENS = process.env.EXTERNAL_API_TOKENS;

beforeEach(() => {
  process.env.EXTERNAL_API_TOKENS = "secret-token";
  cacheMock.get.mockResolvedValue(null);
  cacheMock.set.mockResolvedValue(undefined);
  innerEvents.mockReset();
  innerMatch.mockReset();
  innerShooterSearch.mockReset();
  innerShooterDashboard.mockReset();
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
    ];
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
      lat: null,
      lng: null,
      date: "2026-04-26T00:00:00",
      ends: "2026-04-27T00:00:00",
      level: "Level III",
      sub_rule: null,
      discipline: "IPSC Handgun",
      region: "SWE",
      stages_count: 12,
      competitors_count: 200,
      scoring_completed: 100,
      cacheInfo: { cachedAt: "2026-04-27T10:00:00Z" },
    };
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
      { shooterId: 12345, name: "Jane Doe", club: "Bromma PK", division: "Production Optics", matchCount: 27 },
      { shooterId: 67890, name: "John Doe", club: null, division: null, matchCount: 3 },
    ];
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
        shooterId: 12345,
        name: "Jane Doe",
        club: "Bromma PK",
        division: "Production Optics",
        firstSeenAt: "2024-01-01T00:00:00Z",
        lastSeenAt: "2026-04-27T00:00:00Z",
      },
      matchCount: 1,
      matches: [],
      stats: null,
      achievements: [],
    };
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
