"""IPSC division name normalization.

Competitors across SSI and ipscresults use inconsistent naming for the same
division (formatting differences, abbreviations, typos). This module provides
a canonical mapping applied at read time so rating algorithms and exports always
see consistent division names without requiring a data re-sync.

Normalization is applied in:
- Store.get_competitor_division_map()  — training pipeline
- exporter._export_shooters()          — static site export

## Clear duplicates (implemented)

These are unambiguous formatting variants of the same IPSC division.
Official PCC division names per the IPSC PCC rulebook are "PCC Optics"
and "PCC Iron"; "Pistol Caliber Carbine" is the full form used in some
match management software.

| Raw value                     | Canonical                        |
|-------------------------------|----------------------------------|
| ProductionOptics              | Production Optics                |
| Production Optics L.          | Production Optics Light          |
| PCC                           | Pistol Caliber Carbine           |
| PistolCaliberCarbine          | Pistol Caliber Carbine           |
| PCC Iron                      | Pistol Caliber Carbine Iron      |
| PC Iron                       | Pistol Caliber Carbine Iron      |
| Pistol Caliber Carbine Iron   | Pistol Caliber Carbine Iron      |
| PCC Optic                     | Pistol Caliber Carbine Optics    |
| PC Optic                      | Pistol Caliber Carbine Optics    |

## Ambiguous / deferred (not yet mapped)

These require a policy decision before merging. They have active usage in
recent (2023+) matches and may represent legitimate sub-divisions used by
specific national federations:

| Raw value          | Count  | Recent (2023+) | Notes                                      |
|--------------------|--------|----------------|--------------------------------------------|
| Optics             | 471    | 471 (2025–26)  | Confirmed: a new standalone IPSC division. |
|                    |        |                | Do NOT merge into Production Optics.       |
| Open Semi-Auto     | 7 837  | 1 279          | Used by several Scandinavian clubs.        |
|                    |        |                | May be distinct from Open (equipment       |
|                    |        |                | restrictions). Do NOT merge into Open      |
|                    |        |                | without confirming ruleset equivalence.    |
| Standard Semi-Auto | 2 403  | 154            | Same concern as Open Semi-Auto.            |
| Standard Manual    | 2 790  | 499            | Same concern as Open Manual.               |
| Open Manual        | 191    | 2 (2023 only)  | Essentially dead — low priority.           |
| Pistol Caliber     | 964    | 0              | No recent usage — possibly PCC, but old    |
|                    |        |                | data only. Safe to defer.                  |
| Pistol Caliber OPN | 49     | 0              | No recent usage. Possibly PCC Open.        |
"""

from __future__ import annotations

# Mapping from raw division name to canonical IPSC division name.
# Only unambiguous formatting variants are listed here.
_DIVISION_MAP: dict[str, str] = {
    # Production variants
    "ProductionOptics":             "Production Optics",
    "Production Optics L.":         "Production Optics Light",
    # PCC base division
    "PCC":                          "Pistol Caliber Carbine",
    "PistolCaliberCarbine":         "Pistol Caliber Carbine",
    # PCC Iron variants
    "PCC Iron":                     "Pistol Caliber Carbine Iron",
    "PC Iron":                      "Pistol Caliber Carbine Iron",
    # PCC Optics variants
    "PCC Optic":                    "Pistol Caliber Carbine Optics",
    "PC Optic":                     "Pistol Caliber Carbine Optics",
    "Pistol Caliber Carbine Optic": "Pistol Caliber Carbine Optics",
}


def normalize_division(raw: str | None) -> str | None:
    """Return the canonical IPSC division name for a raw value.

    Returns None unchanged. Unknown values are returned as-is.
    """
    if raw is None:
        return None
    return _DIVISION_MAP.get(raw, raw)
