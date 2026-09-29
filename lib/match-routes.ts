// Pure URL helpers for the match tabs (Grid / Info / Analysis).
// See docs/superpowers/specs/2026-09-29-match-tabs-ux-design.md Section 1.

export const MATCH_TABS = ["grid", "info", "analysis"] as const;
export type MatchTab = (typeof MATCH_TABS)[number];

const TAB_SUFFIX = /\/(info|analysis)\/?$/;

export function matchTabHref(ct: string, id: string, tab: MatchTab): string {
  const base = `/match/${ct}/${id}`;
  return tab === "grid" ? base : `${base}/${tab}`;
}

export function matchTabFromPath(pathname: string): MatchTab {
  const m = pathname.match(TAB_SUFFIX);
  return m ? (m[1] as MatchTab) : "grid";
}

export function matchBasePath(pathname: string): string {
  return pathname.replace(TAB_SUFFIX, "").replace(/\/$/, "");
}

export function ogImagePath(pathname: string): string {
  return matchBasePath(pathname).replace(/^\/match\//, "/api/og/match/");
}

/** True when `path` is this match's base path or any of its tabs. */
export function isSameMatchPath(path: string, ct: string, id: string): boolean {
  return matchBasePath(path) === `/match/${ct}/${id}`;
}

/**
 * Old links put comparison state on the bare match URL. The bare URL is now
 * the grid, so those links belong on Analysis. Returns the target, or null
 * when the URL is a genuine grid visit.
 */
export function resolveLegacyMatchUrl(a: {
  ct: string;
  id: string;
  search: string;
  hash: string;
}): string | null {
  const competitors = new URLSearchParams(a.search).get("competitors");
  const hasCompetitors = competitors != null && competitors.trim() !== "";
  const hasStageAnchor = /^#stage-\d+$/.test(a.hash);
  if (!hasCompetitors && !hasStageAnchor) return null;
  const query = hasCompetitors ? `?competitors=${competitors}` : "";
  const hash = hasStageAnchor ? a.hash : "";
  return `${matchTabHref(a.ct, a.id, "analysis")}${query}${hash}`;
}
