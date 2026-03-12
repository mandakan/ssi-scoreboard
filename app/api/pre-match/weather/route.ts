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
import type { MatchWeatherData } from "@/lib/types";

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

export async function GET(request: Request): Promise<NextResponse<MatchWeatherData | { error: string }>> {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const date = searchParams.get("date"); // YYYY-MM-DD
  const venue = searchParams.get("venue");
  const region = searchParams.get("region");

  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
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
    return NextResponse.json({ error: "No coordinates available for this venue" }, { status: 422 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
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
  return NextResponse.json(weather);
}
