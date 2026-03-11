// Server-only — calls the Open-Meteo historical weather API (free, no API key required).
// Weather for past dates is immutable; results are cached permanently.

import cache from "@/lib/cache-impl";
import type { MatchWeatherData } from "@/lib/types";

// ── WMO weather code labels ───────────────────────────────────────────────────
// Subset covering all codes the Open-Meteo API emits.
const WMO_LABELS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "light freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "heavy rain showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "heavy thunderstorm with hail",
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function safeAvg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function safeMin(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  return valid.length > 0 ? Math.min(...valid) : null;
}

function safeMax(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  return valid.length > 0 ? Math.max(...valid) : null;
}

function safeSum(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null;
}

/** Choose the highest (most severe) WMO weather code from a list. */
function dominantWeatherCode(codes: (number | null)[]): number | null {
  const valid = codes.filter((c): c is number => c != null);
  if (valid.length === 0) return null;
  return Math.max(...valid);
}

/** Circular mean of wind direction degrees → compass point ("N", "NE", …). */
function dominantWindDirection(degrees: (number | null)[]): string | null {
  const valid = degrees.filter((d): d is number => d != null);
  if (valid.length === 0) return null;
  const sinSum = valid.reduce((s, d) => s + Math.sin((d * Math.PI) / 180), 0);
  const cosSum = valid.reduce((s, d) => s + Math.cos((d * Math.PI) / 180), 0);
  const meanDeg = ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return dirs[Math.round(meanDeg / 45) % 8];
}

/** Extract "HH:MM" from an ISO datetime string like "2026-06-15T04:38". */
function toHHMM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = iso.split("T")[1];
  return t ? t.slice(0, 5) : null;
}

// ── Raw API response shape ────────────────────────────────────────────────────

export interface OpenMeteoResponse {
  elevation: number;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    relative_humidity_2m: (number | null)[];
    precipitation: (number | null)[];
    windspeed_10m: (number | null)[];
    windgusts_10m: (number | null)[];
    winddirection_10m: (number | null)[];
    cloudcover: (number | null)[];
    direct_radiation: (number | null)[];
    weathercode: (number | null)[];
    wet_bulb_temperature_2m: (number | null)[];
    snow_depth: (number | null)[];
    visibility: (number | null)[];
  };
  daily: {
    time: string[];
    sunrise: (string | null)[];
    sunset: (string | null)[];
    precipitation_sum: (number | null)[];
  };
}

// ── Pure response processor ───────────────────────────────────────────────────

/**
 * Process a raw Open-Meteo API response into a MatchWeatherData summary.
 * Pure function — no I/O. Fully unit-testable.
 *
 * @param raw      Raw API response object
 * @param startHourUtc  First hour to include (0–23, UTC); null = include all hours
 * @param endHourUtc    Last hour to include (0–23, UTC); null = include all hours
 */
export function processWeatherResponse(
  raw: OpenMeteoResponse,
  startHourUtc: number | null,
  endHourUtc: number | null,
): MatchWeatherData {
  const h = raw.hourly;

  /**
   * Filter a parallel-array of values to the match-hour window.
   * Open-Meteo returns times as "YYYY-MM-DDTHH:MM" without a timezone suffix
   * (when timezone=UTC). Parse the hour directly from the string to avoid
   * JavaScript's Date treating naive strings as local time.
   */
  function slice<T>(arr: (T | null)[]): (T | null)[] {
    if (startHourUtc === null || endHourUtc === null) return arr;
    return arr.filter((_, i) => {
      const hourUtc = parseInt(h.time[i].split("T")[1]?.slice(0, 2) ?? "0", 10);
      // Handle overnight ranges (e.g. 22–02)
      if (startHourUtc <= endHourUtc) {
        return hourUtc >= startHourUtc && hourUtc <= endHourUtc;
      }
      return hourUtc >= startHourUtc || hourUtc <= endHourUtc;
    });
  }

  const tempSlice = slice(h.temperature_2m);
  const apparentSlice = slice(h.apparent_temperature);
  const humidSlice = slice(h.relative_humidity_2m);
  const precipSlice = slice(h.precipitation);
  const windSlice = slice(h.windspeed_10m);
  const gustSlice = slice(h.windgusts_10m);
  const dirSlice = slice(h.winddirection_10m);
  const cloudSlice = slice(h.cloudcover);
  const radSlice = slice(h.direct_radiation);
  const codeSlice = slice(h.weathercode);
  const wetbulbSlice = slice(h.wet_bulb_temperature_2m);
  const snowSlice = slice(h.snow_depth);
  const visSlice = slice(h.visibility);

  const tMin = safeMin(tempSlice);
  const tMax = safeMax(tempSlice);
  const aMin = safeMin(apparentSlice);
  const aMax = safeMax(apparentSlice);
  const weatherCode = dominantWeatherCode(codeSlice);

  const humidRaw = safeAvg(humidSlice);
  const cloudRaw = safeAvg(cloudSlice);
  const radRaw = safeAvg(radSlice);

  return {
    elevation: Math.round(raw.elevation),
    date: raw.daily.time[0] ?? "",
    tempRange: tMin != null && tMax != null ? [+tMin.toFixed(1), +tMax.toFixed(1)] : null,
    apparentTempRange: aMin != null && aMax != null ? [+aMin.toFixed(1), +aMax.toFixed(1)] : null,
    humidityAvg: humidRaw != null ? Math.round(humidRaw) : null,
    windspeedAvg: safeAvg(windSlice),
    windgustMax: safeMax(gustSlice),
    winddirectionDominant: dominantWindDirection(dirSlice),
    precipitationTotal: safeSum(precipSlice),
    cloudcoverAvg: cloudRaw != null ? Math.round(cloudRaw) : null,
    solarRadiationAvg: radRaw != null ? +radRaw.toFixed(1) : null,
    weatherCode,
    weatherLabel: weatherCode != null ? (WMO_LABELS[weatherCode] ?? `code ${weatherCode}`) : null,
    wetbulbMax: safeMax(wetbulbSlice),
    snowDepthMax: safeMax(snowSlice),
    visibilityMin: safeMin(visSlice),
    sunrise: toHHMM(raw.daily.sunrise[0]),
    sunset: toHHMM(raw.daily.sunset[0]),
    precipitationDayTotal: raw.daily.precipitation_sum[0] ?? null,
  };
}

// ── Hourly snapshot helper ────────────────────────────────────────────────────

/**
 * Look up weather conditions at a specific UTC hour from a raw response.
 * Returns null fields if the hour is not found in the data.
 */
const COMPASS_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function getHourlySnapshot(
  raw: OpenMeteoResponse,
  hourUtc: number,
): {
  weatherCode: number | null;
  weatherLabel: string | null;
  tempC: number | null;
  windspeedMs: number | null;
  windgustMs: number | null;
  winddirectionDominant: string | null;
} {
  const h = raw.hourly;
  const idx = h.time.findIndex((t) => {
    const hr = parseInt(t.split("T")[1]?.slice(0, 2) ?? "-1", 10);
    return hr === hourUtc;
  });
  if (idx === -1) {
    return {
      weatherCode: null, weatherLabel: null, tempC: null,
      windspeedMs: null, windgustMs: null, winddirectionDominant: null,
    };
  }
  const weatherCode = h.weathercode[idx] ?? null;
  const windDeg = h.winddirection_10m[idx] ?? null;
  return {
    weatherCode,
    weatherLabel: weatherCode != null ? (WMO_LABELS[weatherCode] ?? `code ${weatherCode}`) : null,
    tempC: h.temperature_2m[idx] ?? null,
    windspeedMs: h.windspeed_10m[idx] ?? null,
    windgustMs: h.windgusts_10m[idx] ?? null,
    winddirectionDominant: windDeg != null ? (COMPASS_DIRS[Math.round(windDeg / 45) % 8] ?? null) : null,
  };
}

// ── HTTP fetch + cache ────────────────────────────────────────────────────────

const WEATHER_TIMEOUT_MS = 5_000;

/** Build the Open-Meteo URL. Uses the forecast API for recent dates (≤ 90 days
 *  ago) and the archive API for older ones — the archive has a ~5-day lag. */
function buildWeatherUrl(lat: number, lng: number, date: string): string {
  const daysDiff = Math.floor(
    (Date.now() - new Date(date + "T12:00:00Z").getTime()) / 86_400_000,
  );

  const hourly = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "windspeed_10m",
    "windgusts_10m",
    "winddirection_10m",
    "cloudcover",
    "direct_radiation",
    "weathercode",
    "wet_bulb_temperature_2m",
    "snow_depth",
    "visibility",
  ].join(",");

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: date,
    end_date: date,
    hourly,
    daily: "sunrise,sunset,precipitation_sum",
    wind_speed_unit: "ms",
    timezone: "UTC",
  });

  const base =
    daysDiff <= 90
      ? "https://api.open-meteo.com/v1/forecast"
      : "https://archive-api.open-meteo.com/v1/archive";

  return `${base}?${params.toString()}`;
}

/**
 * Fetch the raw Open-Meteo response for a match venue, with permanent caching.
 * Returns null on any error (network, timeout, etc.).
 * The raw response is cached permanently so it can be re-sliced with different
 * hour windows without additional API calls.
 */
export async function fetchMatchWeatherRaw(
  lat: number,
  lng: number,
  date: string,
): Promise<OpenMeteoResponse | null> {
  // Round to 4 dp (~11 m precision) for the cache key — sufficient for a 9 km grid model
  const cacheKey = `weather:${lat.toFixed(4)}:${lng.toFixed(4)}:${date}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached) as OpenMeteoResponse;
  } catch {
    // Cache unavailable — proceed to fetch
  }

  const url = buildWeatherUrl(lat, lng, date);
  let raw: OpenMeteoResponse;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[weather] HTTP ${res.status} for ${date} (${lat}, ${lng})`);
      return null;
    }
    raw = (await res.json()) as OpenMeteoResponse;
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
    console.warn(`[weather] fetch failed for ${date}: ${msg}`);
    return null;
  }

  // Cache the raw response permanently — weather for past dates never changes.
  try {
    await cache.set(cacheKey, JSON.stringify(raw));
    await cache.persist(cacheKey);
  } catch {
    // Non-fatal — weather still returned even if caching fails
  }

  return raw;
}

/**
 * Fetch historical weather for a match venue, with permanent caching.
 * Returns null on any error (network, timeout, missing coordinates, etc.).
 * Non-fatal — coaching tips still work without weather context.
 *
 * @param lat           Venue latitude
 * @param lng           Venue longitude
 * @param date          Match date (YYYY-MM-DD)
 * @param startHourUtc  UTC hour of competitor's first stage (0–23); null = full day
 * @param endHourUtc    UTC hour of competitor's last stage (0–23); null = full day
 */
export async function fetchMatchWeather(
  lat: number,
  lng: number,
  date: string,
  startHourUtc: number | null,
  endHourUtc: number | null,
): Promise<MatchWeatherData | null> {
  const raw = await fetchMatchWeatherRaw(lat, lng, date);
  if (!raw) return null;
  return processWeatherResponse(raw, startHourUtc, endHourUtc);
}
