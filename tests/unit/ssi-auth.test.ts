import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const cacheMock = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<(key: string, val: string, ttl?: number | null) => Promise<void>>(),
  del: vi.fn<(...keys: string[]) => Promise<void>>(),
  persist: vi.fn(() => Promise.resolve()),
  expire: vi.fn(() => Promise.resolve()),
  setIfAbsent: vi.fn(() => Promise.resolve(true)),
  scanCachedMatchKeys: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

import { getJwt, purgeJwtCache, __resetForTests } from "@/lib/ssi-auth";

const FUTURE_ISO = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const NEAR_EXPIRY_ISO = () => new Date(Date.now() + 60 * 1000).toISOString(); // 1 min left

function tokenAuthOk(jwt: string, refreshToken: string, expiresAt = FUTURE_ISO()) {
  return new Response(
    JSON.stringify({
      data: {
        token_auth: {
          success: true,
          errors: null,
          token: { token: jwt },
          refresh_token: { token: refreshToken, expires_at: expiresAt },
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function refreshOk(jwt: string, refreshToken: string, expiresAt = FUTURE_ISO()) {
  return new Response(
    JSON.stringify({
      data: {
        refresh_token: {
          success: true,
          errors: null,
          token: { token: jwt },
          refresh_token: { token: refreshToken, expires_at: expiresAt },
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function tokenAuthFail(reason = "invalid_credentials") {
  return new Response(
    JSON.stringify({
      data: {
        token_auth: {
          success: false,
          errors: { nonFieldErrors: [{ message: "nope", code: reason }] },
          token: null,
          refresh_token: null,
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function refreshFail() {
  return new Response(
    JSON.stringify({
      data: {
        refresh_token: {
          success: false,
          errors: { nonFieldErrors: [{ message: "expired", code: "expired" }] },
          token: null,
          refresh_token: null,
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("ssi-auth getJwt", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cacheMock.get.mockReset();
    cacheMock.set.mockReset();
    cacheMock.get.mockResolvedValue(null);
    cacheMock.set.mockResolvedValue(undefined);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    process.env.SSI_API_KEY = "test-key";
    process.env.SSI_SERVICE_EMAIL = "bot@example.com";
    process.env.SSI_SERVICE_PASSWORD = "pw";
    __resetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs in via token_auth on cold start (no cache)", async () => {
    fetchSpy.mockResolvedValueOnce(tokenAuthOk("JWT-A", "REF-A"));

    const jwt = await getJwt();

    expect(jwt).toBe("JWT-A");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body).query).toContain("token_auth");

    // Cached the result
    expect(cacheMock.set).toHaveBeenCalledWith(
      "ssi:jwt:v1",
      expect.stringContaining("JWT-A"),
      expect.any(Number),
    );
  });

  it("returns cached JWT without any network call", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({
        jwt: "CACHED-JWT",
        refreshToken: "CACHED-REF",
        refreshExpiresAt: FUTURE_ISO(),
        cachedAt: Date.now(),
      }),
    );

    const jwt = await getJwt();

    expect(jwt).toBe("CACHED-JWT");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("force=true bypasses cache and calls refresh_token first", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({
        jwt: "OLD-JWT",
        refreshToken: "GOOD-REF",
        refreshExpiresAt: FUTURE_ISO(),
        cachedAt: Date.now(),
      }),
    );
    fetchSpy.mockResolvedValueOnce(refreshOk("NEW-JWT", "NEW-REF"));

    const jwt = await getJwt({ force: true });

    expect(jwt).toBe("NEW-JWT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body).query).toContain("refresh_token");
  });

  it("force=true falls back to token_auth when refresh_token fails", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({
        jwt: "OLD-JWT",
        refreshToken: "BAD-REF",
        refreshExpiresAt: FUTURE_ISO(),
        cachedAt: Date.now(),
      }),
    );
    fetchSpy
      .mockResolvedValueOnce(refreshFail())
      .mockResolvedValueOnce(tokenAuthOk("LOGIN-JWT", "LOGIN-REF"));

    const jwt = await getJwt({ force: true });

    expect(jwt).toBe("LOGIN-JWT");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).query).toContain("refresh_token");
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).query).toContain("token_auth");
  });

  it("force=true skips refresh when refresh-token is near expiry and goes straight to login", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({
        jwt: "OLD-JWT",
        refreshToken: "EXPIRING-REF",
        refreshExpiresAt: NEAR_EXPIRY_ISO(),
        cachedAt: Date.now(),
      }),
    );
    fetchSpy.mockResolvedValueOnce(tokenAuthOk("FRESH-JWT", "FRESH-REF"));

    const jwt = await getJwt({ force: true });

    expect(jwt).toBe("FRESH-JWT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).query).toContain("token_auth");
  });

  it("single-flights concurrent callers within one isolate", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchSpy.mockReturnValueOnce(pending);

    const p1 = getJwt();
    const p2 = getJwt();
    const p3 = getJwt();

    resolveFetch(tokenAuthOk("ONLY-JWT", "ONLY-REF"));

    const [j1, j2, j3] = await Promise.all([p1, p2, p3]);
    expect(j1).toBe("ONLY-JWT");
    expect(j2).toBe("ONLY-JWT");
    expect(j3).toBe("ONLY-JWT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when env vars are missing", async () => {
    delete process.env.SSI_SERVICE_EMAIL;
    await expect(getJwt()).rejects.toThrow(/SSI_SERVICE_EMAIL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates token_auth rejection (e.g. invalid_credentials)", async () => {
    fetchSpy.mockResolvedValueOnce(tokenAuthFail());

    await expect(getJwt()).rejects.toThrow(/token_auth rejected/);
  });

  it("short-circuits to a placeholder JWT when API key is the e2e sentinel", async () => {
    process.env.SSI_API_KEY = "dummy_key_for_e2e";
    delete process.env.SSI_SERVICE_EMAIL;
    delete process.env.SSI_SERVICE_PASSWORD;

    const jwt = await getJwt();

    expect(jwt).toBe("e2e-placeholder-jwt");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheMock.get).not.toHaveBeenCalled();
  });

  it("survives cache-read failure (treats it as a miss)", async () => {
    cacheMock.get.mockRejectedValueOnce(new Error("redis is down"));
    fetchSpy.mockResolvedValueOnce(tokenAuthOk("RECOVERED-JWT", "RECOVERED-REF"));

    const jwt = await getJwt();
    expect(jwt).toBe("RECOVERED-JWT");
  });
});

describe("ssi-auth purgeJwtCache", () => {
  beforeEach(() => {
    cacheMock.del.mockReset();
    cacheMock.del.mockResolvedValue(undefined);
    __resetForTests();
  });

  it("deletes the cached JWT key from Redis", async () => {
    await purgeJwtCache();
    expect(cacheMock.del).toHaveBeenCalledWith("ssi:jwt:v1");
  });
});
