import { afterEach, describe, expect, it, vi } from "vitest";
import { trackUi } from "@/lib/ui-telemetry";

const EV = { op: "tab-view", ct: 22, tab: "grid" } as const;

describe("trackUi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the event as JSON via sendBeacon", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    trackUi(EV);
    expect(beacon).toHaveBeenCalledWith("/api/telemetry/ui", JSON.stringify(EV));
  });

  it("falls back to keepalive fetch when sendBeacon is missing", () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchSpy);
    trackUi(EV);
    expect(fetchSpy).toHaveBeenCalledWith("/api/telemetry/ui", {
      method: "POST",
      body: JSON.stringify(EV),
      keepalive: true,
    });
  });

  it("falls back to fetch when sendBeacon refuses the payload", () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetchSpy);
    trackUi(EV);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws and never leaves an unhandled rejection", async () => {
    vi.stubGlobal("navigator", { sendBeacon: () => { throw new Error("blocked"); } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(() => trackUi(EV)).not.toThrow();
    // Let the rejected fetch promise settle; vitest fails the run on an
    // unhandled rejection.
    await new Promise((r) => setTimeout(r, 0));
  });
});
