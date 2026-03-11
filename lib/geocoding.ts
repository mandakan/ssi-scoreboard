// Server-only — geocodes venue names via OpenStreetMap Nominatim (free, no key required).
// Nominatim usage policy: max 1 request/second, descriptive User-Agent required.
// Results are cached permanently so each venue is queried at most once.

import cache from "@/lib/cache-impl";

// ISO 3166-1 alpha-3 → alpha-2 for the Nominatim `countrycodes` parameter.
// Covers IPSC member countries. Extend as needed — keys must be upper-case.
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: "af", ALB: "al", ARG: "ar", ARM: "am", AUS: "au", AUT: "at",
  AZE: "az", BEL: "be", BLR: "by", BRA: "br", BRN: "bn", CAN: "ca",
  CHE: "ch", CHL: "cl", CHN: "cn", COL: "co", CZE: "cz", DEU: "de",
  DNK: "dk", ECU: "ec", EST: "ee", FIN: "fi", FRA: "fr", GBR: "gb",
  GRC: "gr", HKG: "hk", HRV: "hr", HUN: "hu", IDN: "id", IRL: "ie",
  ISR: "il", ITA: "it", JPN: "jp", KAZ: "kz", KOR: "kr", LTU: "lt",
  LVA: "lv", MEX: "mx", MKD: "mk", MYS: "my", NLD: "nl", NOR: "no",
  NZL: "nz", PER: "pe", PHL: "ph", POL: "pl", PRT: "pt", ROU: "ro",
  RUS: "ru", SGP: "sg", SRB: "rs", SVK: "sk", SVN: "si", ESP: "es",
  SWE: "se", THA: "th", TUR: "tr", TWN: "tw", UKR: "ua", USA: "us",
  ZAF: "za", ZWE: "zw",
};

const GEOCODE_TIMEOUT_MS = 5_000;
const CACHE_KEY_PREFIX = "geocode:v1:";
/** Sentinel stored in cache to record "queried, not found" — avoids re-querying. */
const NULL_SENTINEL = "__null__";

// ── Rate limiter ───────────────────────────────────────────────────────────────
// All outbound Nominatim requests are serialised through a module-level promise
// chain. Each request is only started after the previous one has completed AND
// a 1 000 ms delay has elapsed — guaranteeing at most 1 req/s to Nominatim
// regardless of how many concurrent callers are waiting.

let nominatimChain: Promise<void> = Promise.resolve();

function nominatimFetch(url: string): Promise<Response> {
  // Enqueue behind the current chain tail.
  const responsePromise = nominatimChain.then(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    return fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim policy requires a descriptive User-Agent identifying the app.
        "User-Agent":
          "ssi-scoreboard/1.0 (https://github.com/mandakan/ssi-scoreboard; contact via GitHub issues)",
        "Accept-Language": "en",
      },
    }).finally(() => clearTimeout(timer));
  });

  // Regardless of success or failure, the next request must wait ≥ 1 000 ms
  // after this one settles.
  nominatimChain = responsePromise.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    () => new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
  );

  return responsePromise;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Best-effort geocoding of a venue name via OpenStreetMap Nominatim.
 *
 * Pass the `region` ISO 3166-1 alpha-3 code (e.g. "SWE") to narrow the
 * search to the correct country and improve accuracy.
 *
 * Results — including "not found" — are cached permanently so Nominatim is
 * queried at most once per distinct (venue, region) pair.
 *
 * On network errors or timeouts the result is NOT cached so the next request
 * can retry. Only confirmed responses (found or not found) are persisted.
 *
 * @param venue  Venue name from the SSI match event (e.g. "Skjutbanan Ekerum")
 * @param region ISO 3166-1 alpha-3 country code, or null
 * @returns      {lat, lng}, or null when the venue cannot be resolved
 */
export async function geocodeVenueName(
  venue: string,
  region: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const venueTrimmed = venue.trim();
  if (!venueTrimmed) return null;

  const cacheKey = `${CACHE_KEY_PREFIX}${venueTrimmed.toLowerCase()}:${region ?? ""}`;

  // ── Cache lookup ──
  try {
    const cached = await cache.get(cacheKey);
    if (cached != null) {
      if (cached === NULL_SENTINEL) return null;
      return JSON.parse(cached) as { lat: number; lng: number };
    }
  } catch {
    // Cache unavailable — proceed to Nominatim
  }

  // ── Build query URL ──
  const alpha2 = region ? ALPHA3_TO_ALPHA2[region.toUpperCase()] : undefined;
  const params = new URLSearchParams({
    q: venueTrimmed,
    format: "json",
    limit: "1",
    addressdetails: "0",
  });
  if (alpha2) params.set("countrycodes", alpha2);

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  // ── Nominatim request (rate-limited to ≤ 1 req/s) ──
  let result: { lat: number; lng: number } | null = null;
  try {
    const res = await nominatimFetch(url);
    if (!res.ok) {
      // Non-2xx — don't cache, allow a retry on the next request
      console.warn(`[geocoding] Nominatim HTTP ${res.status} for venue "${venueTrimmed}"`);
      return null;
    }
    const json = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (json.length > 0) {
      const lat = parseFloat(json[0].lat);
      const lng = parseFloat(json[0].lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        result = { lat, lng };
      }
    }
  } catch (err) {
    // Network error or AbortController timeout — don't cache, allow retry
    const msg = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
    console.warn(`[geocoding] Nominatim failed for venue "${venueTrimmed}": ${msg}`);
    return null;
  }

  // ── Persist confirmed result (or null sentinel) permanently ──
  try {
    const toStore = result !== null ? JSON.stringify(result) : NULL_SENTINEL;
    await cache.set(cacheKey, toStore);
    await cache.persist(cacheKey);
  } catch {
    // Non-fatal — result is still returned even if caching fails
  }

  if (result) {
    console.log(
      `[geocoding] Resolved "${venueTrimmed}" (${region ?? "?"}) → ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`,
    );
  } else {
    console.log(`[geocoding] No result for venue "${venueTrimmed}" (${region ?? "?"})`);
  }

  return result;
}
