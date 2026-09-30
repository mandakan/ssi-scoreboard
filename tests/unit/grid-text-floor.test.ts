import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["components/live-grid.tsx", "components/live-grid-cell.tsx", "components/live-grid-sheet.tsx"];

describe("grid text floor", () => {
  it("no arbitrary text size below 12px in the courtside grid", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of readFileSync(f, "utf8").matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) < 12) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
