import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HitZoneBar } from "@/components/hit-zone-bar";

function renderBar(props: {
  aHits: number | null;
  cHits: number | null;
  dHits: number | null;
  misses: number | null;
  noShoots?: number | null;
  procedurals?: number | null;
}) {
  return render(
    <TooltipProvider>
      <HitZoneBar
        aHits={props.aHits}
        cHits={props.cHits}
        dHits={props.dHits}
        misses={props.misses}
        noShoots={props.noShoots ?? null}
        procedurals={props.procedurals ?? null}
      />
    </TooltipProvider>
  );
}

describe("HitZoneBar — hit zones", () => {
  it("renders nothing when all values are null (DNF)", () => {
    const { container } = renderBar({ aHits: null, cHits: null, dHits: null, misses: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders a bar with aria-label for all-A clean result", () => {
    renderBar({ aHits: 10, cHits: 0, dHits: 0, misses: 0 });
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Hit zones: 10A 0C 0D 0M"
    );
  });

  it("renders a bar with aria-label for mixed result", () => {
    renderBar({ aHits: 5, cHits: 2, dHits: 1, misses: 0 });
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Hit zones: 5A 2C 1D 0M"
    );
  });

  it("renders a bar with aria-label for miss-heavy result", () => {
    renderBar({ aHits: 2, cHits: 1, dHits: 0, misses: 3 });
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Hit zones: 2A 1C 0D 3M"
    );
  });

  it("renders empty bar for zeroed stage (all counts zero)", () => {
    renderBar({ aHits: 0, cHits: 0, dHits: 0, misses: 0 });
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Hit zones: 0A 0C 0D 0M");
  });

  it("renders bar when some zone values are null (treats null as 0)", () => {
    renderBar({ aHits: 8, cHits: null, dHits: null, misses: null });
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Hit zones: 8A 0C 0D 0M"
    );
  });

  it("renders the correct number of coloured segments for a mixed result", () => {
    const { container } = renderBar({ aHits: 4, cHits: 2, dHits: 0, misses: 1 });
    // a=4, c=2, m=1 → 3 segments (d=0 is omitted); each segment is an SVG <rect>
    const rects = container.querySelectorAll('[role="img"] > svg > rect');
    expect(rects.length).toBe(3);
  });

  it("omits segments for zones with zero count", () => {
    const { container } = renderBar({ aHits: 10, cHits: 0, dHits: 0, misses: 0 });
    const rects = container.querySelectorAll('[role="img"] > svg > rect');
    expect(rects.length).toBe(1);
  });
});

describe("HitZoneBar — penalties", () => {
  it("includes NS and P counts in aria-label when penalty data is present", () => {
    renderBar({ aHits: 5, cHits: 2, dHits: 0, misses: 0, noShoots: 1, procedurals: 2 });
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Hit zones: 5A 2C 0D 0M · 1NS 2P"
    );
  });

  it("renders penalty text when no-shoots > 0", () => {
    renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 1, procedurals: 0 });
    expect(screen.getByText("1NS")).toBeInTheDocument();
  });

  it("renders penalty text when procedurals > 0", () => {
    renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 0, procedurals: 2 });
    expect(screen.getByText("2P")).toBeInTheDocument();
  });

  it("renders combined penalty label when both are > 0", () => {
    renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 1, procedurals: 1 });
    expect(screen.getByText("1NS · 1P")).toBeInTheDocument();
  });

  it("does not render penalty text when both are zero", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 0, procedurals: 0 });
    expect(container.querySelector(".font-mono.text-rose-600")).toBeNull();
  });

  it("renders bar with no penalty text when penalty data is null", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: null, procedurals: null });
    expect(container.querySelector(".text-rose-600")).toBeNull();
  });

  it("renders only penalty text when hit data is null but penalties > 0", () => {
    renderBar({ aHits: null, cHits: null, dHits: null, misses: null, noShoots: 1, procedurals: 0 });
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("1NS")).toBeInTheDocument();
  });
});
