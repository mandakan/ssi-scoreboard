import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useHashAnchor } from "@/lib/hooks/use-hash-anchor";

function Probe({ anchors, onAnchor }: { anchors: string[]; onAnchor: (a: string) => void }) {
  useHashAnchor(anchors, onAnchor);
  return null;
}

describe("useHashAnchor", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/match?x=1");
  });

  it("fires for a matching hash on mount and clears it, keeping path and query", () => {
    window.location.hash = "#alpha";
    const onAnchor = vi.fn();
    render(<Probe anchors={["alpha", "beta"]} onAnchor={onAnchor} />);
    expect(onAnchor).toHaveBeenCalledWith("alpha");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/match?x=1");
  });

  it("fires again on hashchange, including a repeat of the same anchor", () => {
    const onAnchor = vi.fn();
    render(<Probe anchors={["alpha"]} onAnchor={onAnchor} />);
    for (let i = 0; i < 2; i++) {
      window.location.hash = "#alpha";
      act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    }
    expect(onAnchor).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("");
  });

  it("ignores and does not clear a non-matching hash", () => {
    window.location.hash = "#other";
    const onAnchor = vi.fn();
    render(<Probe anchors={["alpha"]} onAnchor={onAnchor} />);
    expect(onAnchor).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#other");
  });

  it("does not re-apply a cleared hash on remount", () => {
    window.location.hash = "#alpha";
    const onAnchor = vi.fn();
    const first = render(<Probe anchors={["alpha"]} onAnchor={onAnchor} />);
    first.unmount();
    render(<Probe anchors={["alpha"]} onAnchor={onAnchor} />);
    expect(onAnchor).toHaveBeenCalledTimes(1);
  });
});
