import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShareButton } from "@/components/share-button";

// Only fake setTimeout so waitFor (which uses setInterval internally) still works.
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout"] });

describe("ShareButton", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { href: "https://example.com/match/22/42?competitors=1,2" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders with Share label and correct aria-label", () => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    render(<ShareButton title="Test Match" />);

    const btn = screen.getByRole("button", { name: "Share comparison link" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Share");
  });

  it("uses clipboard when navigator.share is unavailable and shows Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fakeTimers();

    render(<ShareButton title="Test Match" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share comparison link" }));
    });

    expect(writeText).toHaveBeenCalledWith(
      "https://example.com/match/22/42?competitors=1,2"
    );

    expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link copied" })).toHaveTextContent("Copied");
  });

  it("resets to Share after 2 seconds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fakeTimers();

    render(<ShareButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share comparison link" }));
    });

    expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(
      screen.getByRole("button", { name: "Share comparison link" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Share comparison link" })
    ).toHaveTextContent("Share");
  });

  it("uses navigator.share when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    fakeTimers();

    render(<ShareButton title="Test Match" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share comparison link" }));
    });

    expect(share).toHaveBeenCalledWith({
      url: "https://example.com/match/22/42?competitors=1,2",
      title: "Test Match",
    });
  });

  it("silently ignores AbortError from native share sheet", async () => {
    const abortError = new DOMException("Share cancelled", "AbortError");
    const share = vi.fn().mockRejectedValue(abortError);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    fakeTimers();

    render(<ShareButton title="Test Match" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share comparison link" }));
    });

    expect(share).toHaveBeenCalled();

    // Button should NOT switch to "Copied" — abort was silently ignored
    expect(
      screen.queryByRole("button", { name: "Link copied" })
    ).not.toBeInTheDocument();
  });

  it("falls back to clipboard when navigator.share throws a non-AbortError", async () => {
    const networkError = new Error("Network error");
    const share = vi.fn().mockRejectedValue(networkError);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fakeTimers();

    render(<ShareButton title="Test Match" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share comparison link" }));
    });

    expect(writeText).toHaveBeenCalledWith(
      "https://example.com/match/22/42?competitors=1,2"
    );
    expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });
});
