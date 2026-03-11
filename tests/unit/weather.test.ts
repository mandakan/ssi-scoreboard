import { describe, it, expect } from "vitest";
import { processWeatherResponse, type OpenMeteoResponse } from "@/lib/weather";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeHourly(overrides: Partial<OpenMeteoResponse["hourly"]> = {}): OpenMeteoResponse["hourly"] {
  // 24 hourly entries for 2026-06-15T00:00 through T23:00
  const times = Array.from({ length: 24 }, (_, i) =>
    `2026-06-15T${String(i).padStart(2, "0")}:00`,
  );

  return {
    time: times,
    temperature_2m: Array(24).fill(15),
    apparent_temperature: Array(24).fill(12),
    relative_humidity_2m: Array(24).fill(70),
    precipitation: Array(24).fill(0),
    windspeed_10m: Array(24).fill(5),
    windgusts_10m: Array(24).fill(8),
    winddirection_10m: Array(24).fill(225), // SW
    cloudcover: Array(24).fill(40),
    direct_radiation: Array(24).fill(100),
    weathercode: Array(24).fill(2), // partly cloudy
    wet_bulb_temperature_2m: Array(24).fill(10),
    snow_depth: Array(24).fill(0),
    visibility: Array(24).fill(20_000),
    ...overrides,
  };
}

function makeRaw(overrides: Partial<OpenMeteoResponse> = {}): OpenMeteoResponse {
  return {
    elevation: 82,
    hourly: makeHourly(),
    daily: {
      time: ["2026-06-15"],
      sunrise: ["2026-06-15T04:38"],
      sunset: ["2026-06-15T22:02"],
      precipitation_sum: [0],
    },
    ...overrides,
  };
}

// ── processWeatherResponse ─────────────────────────────────────────────────────

describe("processWeatherResponse", () => {
  it("returns elevation from raw response", () => {
    const result = processWeatherResponse(makeRaw({ elevation: 150 }), null, null);
    expect(result.elevation).toBe(150);
  });

  it("returns date from daily.time[0]", () => {
    const result = processWeatherResponse(makeRaw(), null, null);
    expect(result.date).toBe("2026-06-15");
  });

  it("extracts sunrise/sunset as HH:MM", () => {
    const result = processWeatherResponse(makeRaw(), null, null);
    expect(result.sunrise).toBe("04:38");
    expect(result.sunset).toBe("22:02");
  });

  it("handles null sunrise/sunset gracefully", () => {
    const raw = makeRaw({
      daily: {
        time: ["2026-06-15"],
        sunrise: [null],
        sunset: [null],
        precipitation_sum: [0],
      },
    });
    const result = processWeatherResponse(raw, null, null);
    expect(result.sunrise).toBeNull();
    expect(result.sunset).toBeNull();
  });

  it("computes temp range across all hours when no window given", () => {
    const temps = Array.from({ length: 24 }, (_, i) => 10 + i * 0.5); // 10–21.5°C
    const raw = makeRaw({ hourly: makeHourly({ temperature_2m: temps }) });
    const result = processWeatherResponse(raw, null, null);
    expect(result.tempRange![0]).toBe(10);
    expect(result.tempRange![1]).toBeCloseTo(21.5, 1);
  });

  it("slices to match-hour window", () => {
    // Hours 0–23: temps 0°C to 23°C
    const temps = Array.from({ length: 24 }, (_, i) => i);
    const raw = makeRaw({ hourly: makeHourly({ temperature_2m: temps }) });
    // Only hours 9–12
    const result = processWeatherResponse(raw, 9, 12);
    expect(result.tempRange).toEqual([9, 12]);
  });

  it("sums precipitation over match hours only", () => {
    const precip = Array(24).fill(0);
    precip[9] = 1.0;
    precip[10] = 2.0;
    precip[15] = 5.0; // outside window
    const raw = makeRaw({ hourly: makeHourly({ precipitation: precip }) });
    const result = processWeatherResponse(raw, 9, 12);
    expect(result.precipitationTotal).toBeCloseTo(3.0, 5);
  });

  it("picks worst (highest) WMO weather code", () => {
    const codes = Array(24).fill(1); // mainly clear
    codes[10] = 63; // rain
    codes[11] = 2;  // partly cloudy
    const raw = makeRaw({ hourly: makeHourly({ weathercode: codes }) });
    const result = processWeatherResponse(raw, null, null);
    expect(result.weatherCode).toBe(63);
    expect(result.weatherLabel).toBe("rain");
  });

  it("maps weatherCode to human-readable label", () => {
    const result = processWeatherResponse(makeRaw(), null, null);
    expect(result.weatherCode).toBe(2);
    expect(result.weatherLabel).toBe("partly cloudy");
  });

  it("returns 'clear sky' for weatherCode 0", () => {
    const raw = makeRaw({ hourly: makeHourly({ weathercode: Array(24).fill(0) }) });
    const result = processWeatherResponse(raw, null, null);
    expect(result.weatherLabel).toBe("clear sky");
  });

  it("computes dominant wind direction via circular mean", () => {
    // All hours SW (225°) → dominant should be SW
    const result = processWeatherResponse(makeRaw(), null, null);
    expect(result.winddirectionDominant).toBe("SW");
  });

  it("computes dominant wind direction for N/NW boundary correctly", () => {
    const dirs = Array(24).fill(350); // NNW → rounds to N
    const raw = makeRaw({ hourly: makeHourly({ winddirection_10m: dirs }) });
    const result = processWeatherResponse(raw, null, null);
    expect(result.winddirectionDominant).toBe("N");
  });

  it("returns windgustMax as maximum over match hours", () => {
    const gusts = Array(24).fill(5);
    gusts[10] = 20;
    gusts[20] = 25; // outside window 8–12
    const raw = makeRaw({ hourly: makeHourly({ windgusts_10m: gusts }) });
    const result = processWeatherResponse(raw, 8, 12);
    expect(result.windgustMax).toBe(20);
  });

  it("handles all-null hourly arrays gracefully", () => {
    const raw = makeRaw({
      hourly: makeHourly({
        temperature_2m: Array(24).fill(null),
        windspeed_10m: Array(24).fill(null),
        precipitation: Array(24).fill(null),
      }),
    });
    const result = processWeatherResponse(raw, null, null);
    expect(result.tempRange).toBeNull();
    expect(result.windspeedAvg).toBeNull();
    expect(result.precipitationTotal).toBeNull();
  });

  it("reports snowDepthMax in metres as stored", () => {
    const snow = Array(24).fill(0);
    snow[9] = 0.15; // 15 cm
    snow[10] = 0.20; // 20 cm — max
    const raw = makeRaw({ hourly: makeHourly({ snow_depth: snow }) });
    const result = processWeatherResponse(raw, 9, 12);
    expect(result.snowDepthMax).toBe(0.20);
  });

  it("returns visibilityMin as minimum over match hours", () => {
    const vis = Array(24).fill(20_000);
    vis[10] = 2_000; // reduced
    vis[20] = 500;   // outside window
    const raw = makeRaw({ hourly: makeHourly({ visibility: vis }) });
    const result = processWeatherResponse(raw, 9, 12);
    expect(result.visibilityMin).toBe(2_000);
  });

  it("returns precipitationDayTotal from daily.precipitation_sum[0]", () => {
    const raw = makeRaw({
      daily: {
        time: ["2026-06-15"],
        sunrise: ["2026-06-15T04:38"],
        sunset: ["2026-06-15T22:02"],
        precipitation_sum: [12.5],
      },
    });
    const result = processWeatherResponse(raw, null, null);
    expect(result.precipitationDayTotal).toBe(12.5);
  });

  it("rounds elevation to integer", () => {
    const raw = makeRaw({ elevation: 82.7 });
    const result = processWeatherResponse(raw, null, null);
    expect(result.elevation).toBe(83);
  });

  it("rounds humidityAvg to integer", () => {
    const humid = Array(24).fill(72.3);
    const raw = makeRaw({ hourly: makeHourly({ relative_humidity_2m: humid }) });
    const result = processWeatherResponse(raw, null, null);
    expect(result.humidityAvg).toBe(72);
  });
});
