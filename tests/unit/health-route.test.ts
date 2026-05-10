import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, HEAD } from "@/app/api/health/route";

describe("GET /api/health -- public liveness probe", () => {
  const originalBuildId = process.env.NEXT_PUBLIC_BUILD_ID;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BUILD_ID;
  });

  afterEach(() => {
    if (originalBuildId === undefined) {
      delete process.env.NEXT_PUBLIC_BUILD_ID;
    } else {
      process.env.NEXT_PUBLIC_BUILD_ID = originalBuildId;
    }
  });

  it("returns 200 with status=pass and the IETF health+json shape", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/health+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "pass",
      version: "1",
      serviceId: "ssi-scoreboard",
      description: expect.any(String),
      releaseId: null,
    });
  });

  it("includes releaseId when NEXT_PUBLIC_BUILD_ID is set", async () => {
    process.env.NEXT_PUBLIC_BUILD_ID = "abc123";
    const res = await GET();
    const body = (await res.json()) as { releaseId: string | null };
    expect(body.releaseId).toBe("abc123");
  });

  it("HEAD returns 200 with no body and the same headers", async () => {
    const res = await HEAD();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/health+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });
});
