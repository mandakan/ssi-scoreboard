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
    const { container } = renderBar({ aHits: 4, cHits: 2, dHits: 1, misses: 0 });
    // a=4, c=2, d=1 → 3 bar segments. M lives outside the bar as a pip.
    const rects = container.querySelectorAll('[role="img"] > svg > rect');
    expect(rects.length).toBe(3);
  });

  it("excludes misses from the bar (misses render as pips, not segments)", () => {
    const { container } = renderBar({ aHits: 4, cHits: 2, dHits: 0, misses: 1 });
    // Bar segments: a + c only (M is now a pip below the bar)
    const rects = container.querySelectorAll('[role="img"] > svg > rect');
    expect(rects.length).toBe(2);
  });

  it("omits segments for zones with zero count", () => {
    const { container } = renderBar({ aHits: 10, cHits: 0, dHits: 0, misses: 0 });
    const rects = container.querySelectorAll('[role="img"] > svg > rect');
    expect(rects.length).toBe(1);
  });
});

// Penalty pips render as small SVG shapes (square=M, triangle=NS, diamond=P).
// `polygon[points^="5,1 9,9"]` matches the triangle (NS); `polygon[points^="5,1 9,5"]`
// matches the diamond (P); `rect` inside the penalty row is M. The bar itself
// uses <rect> elements wrapped in an <svg>, and penalty pips live in a sibling
// <div> after the bar — so we scope queries with `[role="img"] > div` to avoid
// the bar svg.
function penaltyPips(container: HTMLElement) {
  const row = container.querySelector(
    '[role="img"] > div[aria-hidden="true"]'
  );
  return {
    misses: row ? row.querySelectorAll("rect").length : 0,
    noShoots: row
      ? row.querySelectorAll('polygon[points^="5,1 9,9"]').length
      : 0,
    procedurals: row
      ? row.querySelectorAll('polygon[points^="5,1 9,5"]').length
      : 0,
    row,
  };
}

describe("HitZoneBar — penalties", () => {
  it("includes NS and P counts in aria-label when penalty data is present", () => {
    renderBar({ aHits: 5, cHits: 2, dHits: 0, misses: 0, noShoots: 1, procedurals: 2 });
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Hit zones: 5A 2C 0D 0M · 1NS 2P"
    );
  });

  it("renders one NS pip when no-shoots = 1", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 1, procedurals: 0 });
    const pips = penaltyPips(container);
    expect(pips.noShoots).toBe(1);
    expect(pips.procedurals).toBe(0);
    expect(pips.misses).toBe(0);
  });

  it("renders two P pips when procedurals = 2", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 0, procedurals: 2 });
    const pips = penaltyPips(container);
    expect(pips.procedurals).toBe(2);
    expect(pips.noShoots).toBe(0);
  });

  it("renders pips for misses, NS, and P together", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 2, noShoots: 1, procedurals: 1 });
    const pips = penaltyPips(container);
    expect(pips.misses).toBe(2);
    expect(pips.noShoots).toBe(1);
    expect(pips.procedurals).toBe(1);
  });

  it("collapses to shape + count when a penalty exceeds the inline pip threshold", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 7, noShoots: 0, procedurals: 0 });
    const pips = penaltyPips(container);
    // Collapsed mode renders one pip and a "×N" label
    expect(pips.misses).toBe(1);
    expect(pips.row?.textContent).toContain("×7");
  });

  it("does not render the penalty row when all penalty counts are zero", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: 0, procedurals: 0 });
    const pips = penaltyPips(container);
    expect(pips.row).toBeNull();
  });

  it("does not render the penalty row when penalty data is null and misses are zero", () => {
    const { container } = renderBar({ aHits: 5, cHits: 0, dHits: 0, misses: 0, noShoots: null, procedurals: null });
    const pips = penaltyPips(container);
    expect(pips.row).toBeNull();
  });

  it("renders only penalty pips when hit data is null but penalties > 0", () => {
    const { container } = renderBar({ aHits: null, cHits: null, dHits: null, misses: null, noShoots: 1, procedurals: 0 });
    expect(screen.getByRole("img")).toBeInTheDocument();
    const pips = penaltyPips(container);
    expect(pips.noShoots).toBe(1);
  });
});
