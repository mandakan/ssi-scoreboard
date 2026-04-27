// Pre-match weather forecast route.
// Fetches the Open-Meteo forecast API directly (no Redis cache — forecasts change
// over time and must not be cached permanently like historical weather data).
// Next.js fetch() revalidates every hour so the forecast stays reasonably fresh.

import { NextResponse } from "next/server";
import {
  processWeatherResponse,
  type OpenMeteoResponse,
} from "@/lib/weather";
import { geocodeVenueName } from "@/lib/geocoding";
import type { PreMatchWeatherResponse } from "@/lib/types";

export const runtime = "nodejs";

const HOURLY_FIELDS = [
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

// Open-Meteo's free forecast endpoint serves roughly the past 90 days
// (reanalysis-backed) through 16 days into the future. The exact window slides
// with the current UTC day. Anything outside is a structured "not available"
// response — never a 5xx.
const FORECAST_PAST_DAYS = 90;
const FORECAST_FUTURE_DAYS = 16;

const MS_PER_DAY = 86_400_000;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET(
  request: Request,
): Promise<NextResponse<PreMatchWeatherResponse | { error: string }>> {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const date = searchParams.get("date"); // YYYY-MM-DD
  const venue = searchParams.get("venue");
  const region = searchParams.get("region");

  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  // Window check first: skip geocoding and the upstream call when we already
  // know the forecast can't cover this date. Saves a round-trip per page load.
  const today = startOfUtcDay(new Date());
  const matchDay = startOfUtcDay(new Date(`${date}T00:00:00Z`));
  const offsetDays = Math.round((matchDay.getTime() - today.getTime()) / MS_PER_DAY);

  if (offsetDays > FORECAST_FUTURE_DAYS) {
    return NextResponse.json({
      available: false,
      reason: "out_of_range_future",
      daysUntilWindow: offsetDays - FORECAST_FUTURE_DAYS,
    });
  }
  if (offsetDays < -FORECAST_PAST_DAYS) {
    return NextResponse.json({ available: false, reason: "out_of_range_past" });
  }

  let lat = latStr ? parseFloat(latStr) : null;
  let lng = lngStr ? parseFloat(lngStr) : null;
  if (lat != null && !isFinite(lat)) lat = null;
  if (lng != null && !isFinite(lng)) lng = null;

  // Fallback: geocode the venue name when SSI has no GPS coordinates.
  // Results are cached permanently in Redis so Nominatim is called at most once per venue.
  if ((lat == null || lng == null) && venue) {
    try {
      const geocoded = await geocodeVenueName(venue, region ?? null);
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      }
    } catch {
      // Non-fatal — fall through to the coordinates check below
    }
  }

  if (lat == null || lng == null) {
    return NextResponse.json({ available: false, reason: "no_coordinates" });
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: date,
    end_date: date,
    hourly: HOURLY_FIELDS,
    daily: "sunrise,sunset,precipitation_sum",
    wind_speed_unit: "ms",
    timezone: "UTC",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  let raw: OpenMeteoResponse;
  try {
    // Revalidate every hour — forecast data changes; must not be permanent.
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      console.warn(`[pre-match/weather] Open-Meteo HTTP ${res.status}`);
      return NextResponse.json({ error: "Weather service unavailable" }, { status: 502 });
    }
    raw = (await res.json()) as OpenMeteoResponse;
  } catch (err) {
    console.warn("[pre-match/weather] fetch error:", err);
    return NextResponse.json({ error: "Weather fetch failed" }, { status: 502 });
  }

  const weather = processWeatherResponse(raw, null, null);
  return NextResponse.json({ available: true, weather });
}
