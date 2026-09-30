import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("help popover widths", () => {
  it("every w-80 PopoverContent is capped to the viewport", () => {
    const offenders: string[] = [];
    for (const file of [...walk("app"), ...walk("components")]) {
      if (file.includes(`components${"/"}ui${"/"}`)) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<PopoverContent[^>]*className="([^"]*)"/g)) {
        const cls = m[1];
        if (/\bw-80\b/.test(cls) && !cls.includes("max-w-[calc(100vw-2rem)]")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
