// Generic feature preview toggle system.
// State stored in localStorage as a JSON array under key "ssi-preview-features".

export const PREVIEW_FEATURES = ["achievements"] as const;
export type PreviewFeatureId = (typeof PREVIEW_FEATURES)[number];

const STORAGE_KEY = "ssi-preview-features";

function getEnabledFeatures(): Set<PreviewFeatureId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(
      arr.filter((id): id is PreviewFeatureId =>
        (PREVIEW_FEATURES as readonly string[]).includes(id),
      ),
    );
  } catch {
    return new Set();
  }
}

function saveEnabledFeatures(features: Set<PreviewFeatureId>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...features]));
  } catch { /* ignore storage errors */ }
}

export function isPreviewEnabled(id: PreviewFeatureId): boolean {
  return getEnabledFeatures().has(id);
}

export function enablePreview(id: PreviewFeatureId): void {
  const features = getEnabledFeatures();
  features.add(id);
  saveEnabledFeatures(features);
}

export function disablePreview(id: PreviewFeatureId): void {
  const features = getEnabledFeatures();
  features.delete(id);
  saveEnabledFeatures(features);
}

/**
 * Process `?preview=` URL params. Supports comma-separated IDs.
 * Prefix with `-` to disable: `?preview=-achievements`.
 * Returns true if any preview state was changed.
 */
export function processPreviewParams(params: URLSearchParams): boolean {
  const raw = params.get("preview");
  if (!raw) return false;

  const features = getEnabledFeatures();
  let changed = false;

  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("-")) {
      const id = trimmed.slice(1) as PreviewFeatureId;
      if ((PREVIEW_FEATURES as readonly string[]).includes(id) && features.has(id)) {
        features.delete(id);
        changed = true;
      }
    } else {
      const id = trimmed as PreviewFeatureId;
      if ((PREVIEW_FEATURES as readonly string[]).includes(id) && !features.has(id)) {
        features.add(id);
        changed = true;
      }
    }
  }

  if (changed) saveEnabledFeatures(features);
  return changed;
}
