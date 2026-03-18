import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShareButton } from "@/components/share-button";

// Only fake setTimeout so waitFor (which uses setInterval internally) still works.
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout"] });

// Vaul Drawer uses matchMedia internally
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function mockWindowLocation() {
  Object.defineProperty(window, "location", {
    value: {
      href: "https://example.com/match/22/42?competitors=1,2",
      origin: "https://example.com",
      pathname: "/match/22/42",
      search: "?competitors=1,2",
    },
    writable: true,
    configurable: true,
  });
}

describe("ShareButton", () => {
  beforeEach(() => {
    mockWindowLocation();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders with Share label and correct aria-label (no competitors)", () => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    render(<ShareButton title="Test Match" />);

    const btn = screen.getByRole("button", { name: "Share match link" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Share");
  });

  it("renders with competitor-aware aria-label when competitorCount is provided", () => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    render(<ShareButton title="Test Match" competitorCount={2} />);

    const btn = screen.getByRole("button", {
      name: "Share comparison link with 2 competitors",
    });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Share");
  });

  it("opens drawer and copies URL via Copy link button", async () => {
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

    // Click the trigger to open the drawer
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share match link" }));
    });

    // Find and click the Copy link button inside the drawer
    const copyBtn = screen.getByText("Copy link").closest("button");
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(copyBtn!);
    });

    expect(writeText).toHaveBeenCalledWith(
      "https://example.com/match/22/42?competitors=1,2"
    );
  });

  it("shows Copied to clipboard after copy", async () => {
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

    // Open drawer
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share match link" }));
    });

    // Click copy
    const copyBtn = screen.getByText("Copy link").closest("button")!;
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("resets to Copy link after 2 seconds", async () => {
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

    // Open drawer
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share match link" }));
    });

    // Click copy
    const copyBtn = screen.getByText("Copy link").closest("button")!;
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("Copy link")).toBeInTheDocument();
  });

  it("uses navigator.share when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    fakeTimers();

    render(<ShareButton title="Test Match" />);

    // Open drawer
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share match link" }));
    });

    // Click copy (which uses navigator.share when available)
    const copyBtn = screen.getByText("Copy link").closest("button")!;
    await act(async () => {
      fireEvent.click(copyBtn);
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

    // Open drawer
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share match link" }));
    });

    // Click copy
    const copyBtn = screen.getByText("Copy link").closest("button")!;
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(share).toHaveBeenCalled();

    // Button should NOT switch to "Copied" — abort was silently ignored
    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
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

    // Open drawer
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share match link" }));
    });

    // Click copy
    const copyBtn = screen.getByText("Copy link").closest("button")!;
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeText).toHaveBeenCalledWith(
      "https://example.com/match/22/42?competitors=1,2"
    );
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });
});
