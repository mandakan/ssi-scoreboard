import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function run(path: string) {
  return middleware(new NextRequest(`http://localhost:3000${path}`));
}

describe("middleware legacy match redirect", () => {
  it("redirects a bare match URL with ?competitors= to analysis (307)", () => {
    const res = run("/match/22/1?competitors=100,101");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/match/22/1/analysis?competitors=100,101",
    );
  });

  it("also redirects with a trailing slash", () => {
    const res = run("/match/22/1/?competitors=100");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/match/22/1/analysis?competitors=100",
    );
  });

  it("passes the plain grid URL through with CSP", () => {
    const res = run("/match/22/1");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-");
  });

  it("passes analysis URLs through", () => {
    const res = run("/match/22/1/analysis?competitors=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
