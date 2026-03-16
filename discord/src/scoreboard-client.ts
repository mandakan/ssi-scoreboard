// Typed HTTP client for the SSI Scoreboard API.
// Calls the same endpoints that the web app uses.

import type {
  CompareResult,
  EventSearchResult,
  MatchResponse,
  ShooterDashboardResponse,
  ShooterSearchResult,
} from "./types";

export class ScoreboardClient {
  constructor(private baseUrl: string) {}

  /** Search for events/matches by name. */
  async searchEvents(
    query: string,
    opts?: { minLevel?: string },
  ): Promise<EventSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (opts?.minLevel) params.set("minLevel", opts.minLevel);
    const resp = await this.fetch(`/api/events?${params}`);
    return resp.json();
  }

  /** Get full match data (competitors, stages, squads). */
  async getMatch(ct: number, id: number): Promise<MatchResponse> {
    const resp = await this.fetch(`/api/match/${ct}/${id}`);
    return resp.json();
  }

  /** Search for a shooter by name. */
  async searchShooters(query: string): Promise<ShooterSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    const resp = await this.fetch(`/api/shooter/search?${params}`);
    return resp.json();
  }

  /** Get shooter dashboard (cross-competition stats). */
  async getShooterDashboard(
    shooterId: number,
  ): Promise<ShooterDashboardResponse> {
    const resp = await this.fetch(`/api/shooter/${shooterId}`);
    return resp.json();
  }

  /** Compare specific competitors in a match (stage-by-stage data). */
  async compare(
    ct: number,
    id: number,
    competitorIds: number[],
  ): Promise<CompareResult> {
    const params = new URLSearchParams({
      ct: String(ct),
      id: String(id),
      competitor_ids: competitorIds.join(","),
    });
    const resp = await this.fetch(`/api/compare?${params}`);
    return resp.json();
  }

  private async fetch(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const resp = await globalThis.fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`Scoreboard API error: ${resp.status} ${resp.statusText} (${path})`);
    }
    return resp;
  }
}
