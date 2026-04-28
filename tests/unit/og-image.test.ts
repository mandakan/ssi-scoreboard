// @vitest-environment node
// Sharp's typedArray check compares val.constructor === Uint8Array, which fails
// under jsdom because jsdom creates a separate realm. Next's bundled @vercel/og
// hits this path starting in 16.2.x. Production runs in a single Node realm.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OgMatchData } from "@/lib/og-data";

// ── Mock fetchOgMatchData before importing the route ───────────────────
vi.mock("@/lib/og-data", () => ({
  fetchOgMatchData: vi.fn(),
}));

// Import after mock is set up
const { fetchOgMatchData } = await import("@/lib/og-data");
const { GET } = await import("@/app/api/og/match/[ct]/[id]/route");

const mockFetch = vi.mocked(fetchOgMatchData);

// ── Test data ──────────────────────────────────────────────────────────

const MOCK_MATCH: OgMatchData = {
  name: "Test Championship 2024",
  venue: "Test Arena",
  date: "2024-06-15",
  level: "l3",
  region: "SWE",
  stagesCount: 12,
  competitorsCount: 85,
  scoringCompleted: 100,
  matchStatus: "cp",
  resultsStatus: "all",
  minRounds: 180,
  imageUrl: null,
  imageWidth: null,
  imageHeight: null,
  competitors: [
    { id: 1, shooterId: null, name: "Alice Andersson", competitor_number: "A001", club: "Test Club", division: "Production", region: null, region_display: null, category: null, ics_alias: null, license: null },
    { id: 2, shooterId: null, name: "Bob Bjork", competitor_number: "B002", club: "Other Club", division: "Open", region: null, region_display: null, category: null, ics_alias: null, license: null },
    { id: 3, shooterId: null, name: "Charlie Chen", competitor_number: "C003", club: "Third Club", division: "Standard", region: null, region_display: null, category: null, ics_alias: null, license: null },
    { id: 4, shooterId: null, name: "Diana Dahl", competitor_number: "D004", club: "Fourth Club", division: "Production Optics", region: null, region_display: null, category: null, ics_alias: null, license: null },
    { id: 5, shooterId: null, name: "Erik Ekman", competitor_number: "E005", club: "Fifth Club", division: "Classic", region: null, region_display: null, category: null, ics_alias: null, license: null },
    { id: 6, shooterId: null, name: "Fiona Falk", competitor_number: "F006", club: "Sixth Club", division: "Revolver", region: null, region_display: null, category: null, ics_alias: null, license: null },
  ],
};

// Active match: recent date + low scoring so isMatchComplete() is false.
// (A completed-but-recent match would also need to be within 7 days, so we
// set date to a few hours ago — mirrors the real "match in progress" case.)
const ACTIVE_MATCH: OgMatchData = {
  ...MOCK_MATCH,
  name: "Active Match",
  scoringCompleted: 40,
  date: new Date(Date.now() - 6 * 3_600_000).toISOString(),
};

function makeRequest(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

function makeParams(ct: string, id: string) {
  return { params: Promise.resolve({ ct, id }) };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("OG Image Route — GET /api/og/match/[ct]/[id]", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── Fallback variant ───────────────────────────────────────────────

  describe("fallback (match not found)", () => {
    it("returns a PNG image", async () => {
      mockFetch.mockResolvedValue(null);
      const res = await GET(
        makeRequest("/api/og/match/22/99999"),
        makeParams("22", "99999"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("sets a moderate cache header", async () => {
      mockFetch.mockResolvedValue(null);
      const res = await GET(
        makeRequest("/api/og/match/22/99999"),
        makeParams("22", "99999"),
      );
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("produces non-empty image data", async () => {
      mockFetch.mockResolvedValue(null);
      const res = await GET(
        makeRequest("/api/og/match/22/99999"),
        makeParams("22", "99999"),
      );
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(1000);
    });
  });

  // ── Match overview variant ─────────────────────────────────────────

  describe("match overview (no competitors param)", () => {
    it("returns a PNG image", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345"),
        makeParams("22", "12345"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("uses long cache for completed matches", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345"),
        makeParams("22", "12345"),
      );
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=86400, s-maxage=604800",
      );
    });

    it("uses short cache for active matches", async () => {
      mockFetch.mockResolvedValue(ACTIVE_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345"),
        makeParams("22", "12345"),
      );
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=60, s-maxage=300",
      );
    });

    it("produces non-empty image data", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345"),
        makeParams("22", "12345"),
      );
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(1000);
    });
  });

  // ── Single competitor variant ──────────────────────────────────────

  describe("single competitor", () => {
    it("returns a PNG image", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=1"),
        makeParams("22", "12345"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("produces non-empty image data", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=1"),
        makeParams("22", "12345"),
      );
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(1000);
    });
  });

  // ── Multi-competitor variant ───────────────────────────────────────

  describe("multi-competitor", () => {
    it("returns a PNG image for 2 competitors", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=1,2"),
        makeParams("22", "12345"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("returns a PNG image for 3 competitors", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=1,2,3"),
        makeParams("22", "12345"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("handles >5 competitors with overflow text", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=1,2,3,4,5,6"),
        makeParams("22", "12345"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(1000);
    });

    it("produces non-empty image data", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=1,2,3"),
        makeParams("22", "12345"),
      );
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(1000);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("falls back to overview when competitor IDs don't match", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=9999"),
        makeParams("22", "12345"),
      );
      // No valid competitors resolved → overview variant
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("ignores invalid competitor IDs in the param", async () => {
      mockFetch.mockResolvedValue(MOCK_MATCH);
      const res = await GET(
        makeRequest("/api/og/match/22/12345?competitors=abc,0,-1,1"),
        makeParams("22", "12345"),
      );
      // Only id=1 is valid → single competitor variant
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("handles match with minimal data", async () => {
      const minimal: OgMatchData = {
        name: "Minimal Match",
        venue: null,
        date: null,
        level: null,
        region: null,
        stagesCount: 0,
        competitorsCount: 0,
        scoringCompleted: 0,
        matchStatus: "on",
        resultsStatus: "org",
        minRounds: null,
        imageUrl: null,
        imageWidth: null,
        imageHeight: null,
        competitors: [],
      };
      mockFetch.mockResolvedValue(minimal);
      const res = await GET(
        makeRequest("/api/og/match/22/12345"),
        makeParams("22", "12345"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("passes ct and id to fetchOgMatchData with 15s timeout", async () => {
      mockFetch.mockResolvedValue(null);
      await GET(
        makeRequest("/api/og/match/22/54321"),
        makeParams("22", "54321"),
      );
      expect(mockFetch).toHaveBeenCalledWith("22", "54321", 15_000);
    });
  });
});
