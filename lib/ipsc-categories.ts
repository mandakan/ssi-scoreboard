// Pure display helpers for IPSC competitor metadata.
// Safe to import from both server and client components (no server-only imports).

/** Human-readable display name for each IPSC category code. Empty string for "-" (standard). */
export const CATEGORY_DISPLAY: Record<string, string> = {
  "-": "",
  L: "Lady",
  GJ: "Grand Junior",
  LGJ: "Lady Grand Junior",
  SJ: "Super Junior",
  LSJ: "Lady Super Junior",
  J: "Junior",
  LJ: "Lady Junior",
  S: "Senior",
  LS: "Lady Senior",
  SS: "Super Senior",
  GS: "Grand Senior",
};

/** ISO 3166-1 alpha-3 → alpha-2 lookup for relevant IPSC nations. */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: "AF", ALB: "AL", DZA: "DZ", ARG: "AR", ARM: "AM", AUS: "AU",
  AUT: "AT", AZE: "AZ", BLR: "BY", BEL: "BE", BRA: "BR", BGR: "BG",
  CAN: "CA", CHL: "CL", CHN: "CN", COL: "CO", HRV: "HR", CYP: "CY",
  CZE: "CZ", DNK: "DK", EST: "EE", FIN: "FI", FRA: "FR", GEO: "GE",
  DEU: "DE", GRC: "GR", HKG: "HK", HUN: "HU", ISL: "IS", IND: "IN",
  IRL: "IE", ISR: "IL", ITA: "IT", JPN: "JP", KAZ: "KZ", KOR: "KR",
  LVA: "LV", LIE: "LI", LTU: "LT", LUX: "LU", MKD: "MK", MLT: "MT",
  MEX: "MX", MCO: "MC", NLD: "NL", NZL: "NZ", NOR: "NO", PER: "PE",
  POL: "PL", PRT: "PT", PRY: "PY", ROU: "RO", RUS: "RU", SRB: "RS",
  SGP: "SG", SVK: "SK", SVN: "SI", ZAF: "ZA", ESP: "ES", SWE: "SE",
  CHE: "CH", TWN: "TW", TUR: "TR", UKR: "UA", GBR: "GB", USA: "US",
  URY: "UY", SMR: "SM", AND: "AD",
};

/**
 * Convert an ISO 3166-1 alpha-3 country code to a flag emoji.
 * Returns null for unknown or empty codes.
 */
export function regionToFlagEmoji(alpha3: string | null | undefined): string | null {
  if (!alpha3) return null;
  const alpha2 = ALPHA3_TO_ALPHA2[alpha3.toUpperCase()];
  if (!alpha2) return null;
  // Regional indicator symbols: A = U+1F1E6, B = U+1F1E7, …, Z = U+1F1FF
  return [...alpha2]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}
