import { describe, it, expect, beforeEach } from "vitest";
import { createSqliteDatabase } from "@/lib/db-sqlite";
import type { AppDatabase } from "@/lib/db";
import type { ShooterProfile } from "@/lib/shooter-index";

function freshDb(): AppDatabase {
  return createSqliteDatabase(":memory:");
}

describe("AppDatabase (SQLite)", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = freshDb();
  });

  // ── indexShooterMatch ─────────────────────────────────────────────────────

  describe("indexShooterMatch", () => {
    it("inserts a match reference", async () => {
      await db.indexShooterMatch(100, "22:1001", 1700000000);
      const refs = await db.getShooterMatches(100);
      expect(refs).toEqual(["22:1001"]);
    });

    it("is idempotent (upsert)", async () => {
      await db.indexShooterMatch(100, "22:1001", 1700000000);
      await db.indexShooterMatch(100, "22:1001", 1700000999);
      const refs = await db.getShooterMatches(100);
      expect(refs).toEqual(["22:1001"]);
    });

    it("trims to MAX_SHOOTER_MATCHES (200)", async () => {
      for (let i = 0; i < 210; i++) {
        await db.indexShooterMatch(100, `22:${i}`, 1700000000 + i);
      }
      const refs = await db.getShooterMatches(100);
      expect(refs.length).toBe(200);
      // The oldest 10 should be trimmed (refs 0–9)
      expect(refs[0]).toBe("22:10");
      expect(refs[refs.length - 1]).toBe("22:209");
    });
  });

  // ── setShooterProfile / getShooterProfile ──────────────────────────────────

  describe("setShooterProfile / getShooterProfile", () => {
    const profile: ShooterProfile = {
      name: "John Doe",
      club: "Club A",
      division: "Production",
      lastSeen: "2025-06-01T12:00:00Z",
    };

    it("inserts and retrieves a profile", async () => {
      await db.setShooterProfile(100, profile);
      const result = await db.getShooterProfile(100);
      expect(result).toEqual(profile);
    });

    it("updates an existing profile (upsert)", async () => {
      await db.setShooterProfile(100, profile);
      const updated: ShooterProfile = {
        name: "John Doe",
        club: "Club B",
        division: "Standard",
        lastSeen: "2025-07-01T12:00:00Z",
      };
      await db.setShooterProfile(100, updated);
      const result = await db.getShooterProfile(100);
      expect(result).toEqual(updated);
    });

    it("returns null for unknown shooter", async () => {
      const result = await db.getShooterProfile(999);
      expect(result).toBeNull();
    });

    it("handles null club and division", async () => {
      const p: ShooterProfile = {
        name: "Jane",
        club: null,
        division: null,
        lastSeen: "2025-06-01T00:00:00Z",
      };
      await db.setShooterProfile(200, p);
      const result = await db.getShooterProfile(200);
      expect(result).toEqual(p);
    });
  });

  // ── getShooterMatches ─────────────────────────────────────────────────────

  describe("getShooterMatches", () => {
    it("returns matches sorted by start_timestamp ascending", async () => {
      await db.indexShooterMatch(100, "22:3", 1700000003);
      await db.indexShooterMatch(100, "22:1", 1700000001);
      await db.indexShooterMatch(100, "22:2", 1700000002);
      const refs = await db.getShooterMatches(100);
      expect(refs).toEqual(["22:1", "22:2", "22:3"]);
    });

    it("returns empty array for unknown shooter", async () => {
      const refs = await db.getShooterMatches(999);
      expect(refs).toEqual([]);
    });
  });

  // ── hasShooterProfile ─────────────────────────────────────────────────────

  describe("hasShooterProfile", () => {
    it("returns false when profile does not exist", async () => {
      expect(await db.hasShooterProfile(999)).toBe(false);
    });

    it("returns true when profile exists", async () => {
      await db.setShooterProfile(100, {
        name: "Test",
        club: null,
        division: null,
        lastSeen: "2025-06-01T00:00:00Z",
      });
      expect(await db.hasShooterProfile(100)).toBe(true);
    });
  });

  // ── recordMatchAccess / getPopularKeys ────────────────────────────────────

  describe("recordMatchAccess / getPopularKeys", () => {
    it("records access and returns popular keys", async () => {
      await db.recordMatchAccess("gql:GetMatch:A");
      await db.recordMatchAccess("gql:GetMatch:A");
      await db.recordMatchAccess("gql:GetMatch:B");

      const popular = await db.getPopularKeys(3600, 10);
      expect(popular).toHaveLength(2);
      expect(popular[0]).toEqual({ key: "gql:GetMatch:A", hits: 2 });
      expect(popular[1]).toEqual({ key: "gql:GetMatch:B", hits: 1 });
    });

    it("respects limit", async () => {
      await db.recordMatchAccess("gql:GetMatch:A");
      await db.recordMatchAccess("gql:GetMatch:A");
      await db.recordMatchAccess("gql:GetMatch:B");

      const popular = await db.getPopularKeys(3600, 1);
      expect(popular).toHaveLength(1);
      expect(popular[0].key).toBe("gql:GetMatch:A");
    });

    it("returns empty for no data", async () => {
      const popular = await db.getPopularKeys(3600, 10);
      expect(popular).toEqual([]);
    });
  });
});
