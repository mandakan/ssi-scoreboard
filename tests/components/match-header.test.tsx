import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatchHeader } from "@/components/match-header";
import type { MatchResponse } from "@/lib/types";

const baseMatch: MatchResponse = {
  name: "Test Championship",
  cacheInfo: { cachedAt: null },
  venue: "Shooting Range Alpha",
  date: "2026-03-15T09:00:00+00:00",
  level: "l2",
  sub_rule: "nm",
  discipline: "IPSC Handgun & PCC",
  region: "SWE",
  stages_count: 8,
  competitors_count: 105,
  scoring_completed: 56,
  match_status: "on",
  results_status: "org",
  ssi_url: "https://shootnscoreit.com/event/22/123/",
  stages: [],
  competitors: [],
  squads: [],
};

describe("MatchHeader", () => {
  it("renders match name", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByRole("heading", { name: "Test Championship" })).toBeInTheDocument();
  });

  it("renders venue", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByText("Shooting Range Alpha")).toBeInTheDocument();
  });

  it("renders level badge", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByText("Level II")).toBeInTheDocument();
  });

  it("renders region badge", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByText("SWE")).toBeInTheDocument();
  });

  it("shows 56% progress for scoring_completed=56", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByText("56%")).toBeInTheDocument();
  });

  it("shows 'Complete' when scoring_completed=100", () => {
    render(<MatchHeader match={{ ...baseMatch, scoring_completed: 100 }} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("shows 0% progress for scoring_completed=0", () => {
    render(<MatchHeader match={{ ...baseMatch, scoring_completed: 0 }} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("handles missing optional fields gracefully", () => {
    render(
      <MatchHeader
        match={{ ...baseMatch, venue: null, date: null, level: null, sub_rule: null, region: null }}
      />
    );
    expect(screen.getByRole("heading", { name: "Test Championship" })).toBeInTheDocument();
  });

  it("shows stage and competitor count", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByText(/8 stages/)).toBeInTheDocument();
    expect(screen.getByText(/105 competitors/)).toBeInTheDocument();
  });

  it("shows sub_rule badge for Handgun matches", () => {
    render(<MatchHeader match={baseMatch} />);
    expect(screen.getByText("Standard")).toBeInTheDocument();
  });

  it("shows discipline badge for Rifle matches instead of sub_rule", () => {
    render(
      <MatchHeader
        match={{ ...baseMatch, discipline: "IPSC Rifle", sub_rule: "rifle" }}
      />
    );
    expect(screen.getByText("Rifle")).toBeInTheDocument();
    expect(screen.queryByText("Standard")).not.toBeInTheDocument();
  });

  it("shows discipline badge for Shotgun matches", () => {
    render(
      <MatchHeader
        match={{ ...baseMatch, discipline: "IPSC Shotgun", sub_rule: "shotgun" }}
      />
    );
    expect(screen.getByText("Shotgun")).toBeInTheDocument();
  });

  it("strips 'IPSC ' prefix from discipline badge", () => {
    render(
      <MatchHeader
        match={{ ...baseMatch, discipline: "IPSC Mini Rifle", sub_rule: null }}
      />
    );
    expect(screen.getByText("Mini Rifle")).toBeInTheDocument();
    expect(screen.queryByText("IPSC Mini Rifle")).not.toBeInTheDocument();
  });

  it("renders SSI link when ssi_url is provided", () => {
    render(<MatchHeader match={baseMatch} />);
    const link = screen.getByRole("link", { name: /ShootNScoreIt/i });
    expect(link).toHaveAttribute("href", "https://shootnscoreit.com/event/22/123/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("omits SSI link when ssi_url is null", () => {
    render(<MatchHeader match={{ ...baseMatch, ssi_url: null }} />);
    expect(screen.queryByRole("link", { name: /ShootNScoreIt/i })).not.toBeInTheDocument();
  });
});
