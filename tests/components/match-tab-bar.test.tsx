import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/match/22/1/info" }));
const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (e: unknown) => trackUi(e) }));
const linkProps: Array<Record<string, unknown>> = [];
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown> & { children: React.ReactNode }) => {
    linkProps.push(props);
    return <a href={props.href as string} aria-current={props["aria-current"] as "page" | undefined}>{children}</a>;
  },
}));

import { MatchTabBar } from "@/components/match-tab-bar";

describe("MatchTabBar", () => {
  it("is a labelled nav of links with the active tab marked", () => {
    render(<MatchTabBar ct="22" id="1" />);
    const nav = screen.getByRole("navigation", { name: "Match sections" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/match/22/1", "/match/22/1/info", "/match/22/1/analysis",
    ]);
    expect(screen.getByRole("link", { name: /info/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /grid/i })).not.toHaveAttribute("aria-current");
  });

  it("reports the viewed tab once", () => {
    render(<MatchTabBar ct="22" id="1" />);
    expect(trackUi).toHaveBeenCalledWith({ op: "tab-view", ct: 22, tab: "info" });
  });

  it("disables prefetch so sibling tabs do not run the match layout", () => {
    linkProps.length = 0;
    render(<MatchTabBar ct="22" id="1" />);
    expect(linkProps).toHaveLength(3);
    for (const p of linkProps) expect(p.prefetch).toBe(false);
  });
});
