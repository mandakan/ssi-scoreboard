import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { WhatsNewProvider, useWhatsNew } from "@/components/whats-new-provider";
import { BottomNav } from "@/components/bottom-nav";
import { SiteHeader } from "@/components/site-header";
import { RELEASES } from "@/lib/releases";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/hooks/use-my-identity", () => ({
  useMyIdentity: () => ({ identity: null }),
}));
vi.mock("@/components/tracked-shooters-sheet", () => ({
  TrackedShootersSheet: () => null,
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/app-logo", () => ({ AppLogo: () => null }));

const KEY = "whats-new-seen-id";

function Probe() {
  const { open, setOpen, hasUnseen } = useWhatsNew();
  return (
    <div>
      <span data-testid="unseen">{String(hasUnseen)}</span>
      <span data-testid="open">{String(open)}</span>
      <button onClick={() => setOpen(true)}>probe-open</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <WhatsNewProvider>
      <Probe />
    </WhatsNewProvider>,
  );
}

async function flush() {
  await act(async () => {
    vi.runAllTimers();
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WhatsNewProvider", () => {
  it("reports unseen and does not auto-open the dialog", async () => {
    renderProbe();
    await flush();
    expect(screen.getByTestId("unseen").textContent).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports seen when the stored id is the latest", async () => {
    localStorage.setItem(KEY, RELEASES[0].id);
    renderProbe();
    await flush();
    expect(screen.getByTestId("unseen").textContent).toBe("false");
  });

  it("opens on demand and clears hasUnseen on close without a reload", async () => {
    renderProbe();
    await flush();
    fireEvent.click(screen.getByText("probe-open"));
    await flush();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await flush();
    expect(localStorage.getItem(KEY)).toBe(RELEASES[0].id);
    expect(screen.getByTestId("unseen").textContent).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows only the latest when one release was missed", async () => {
    localStorage.setItem(KEY, RELEASES[1].id);
    renderProbe();
    fireEvent.click(screen.getByText("probe-open"));
    await flush();
    expect(screen.getByRole("dialog").textContent).toContain(
      RELEASES[0].title ?? "",
    );
    expect(screen.queryByText(/updates since your last visit/)).toBeNull();
  });

  it("shows every missed release when several were missed", async () => {
    localStorage.setItem(KEY, RELEASES[2].id);
    renderProbe();
    fireEvent.click(screen.getByText("probe-open"));
    await flush();
    expect(screen.getByText("2 updates since your last visit")).toBeTruthy();
  });
});

describe("What's new dots", () => {
  it("BottomNav More button and sheet row carry the dot only when unseen", async () => {
    render(
      <WhatsNewProvider>
        <BottomNav />
      </WhatsNewProvider>,
    );
    await flush();
    const more = screen.getByRole("button", { name: "More, new release notes" });
    fireEvent.click(more);
    await flush();
    const row = screen.getByRole("button", { name: /What's new/ });
    expect(row.textContent).toContain("New");
    fireEvent.click(row);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await flush();
    expect(screen.getByRole("button", { name: "More", hidden: true })).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
  });

  it("BottomNav has no dot when seen", async () => {
    localStorage.setItem(KEY, RELEASES[0].id);
    render(
      <WhatsNewProvider>
        <BottomNav />
      </WhatsNewProvider>,
    );
    await flush();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new release notes/ })).toBeNull();
  });

  it("SiteHeader shows a What's new button with the dot only when unseen", async () => {
    const { unmount } = render(
      <WhatsNewProvider>
        <SiteHeader />
      </WhatsNewProvider>,
    );
    await flush();
    expect(
      screen.getByRole("button", { name: "What's new, new release notes" }),
    ).toBeTruthy();
    unmount();
    localStorage.setItem(KEY, RELEASES[0].id);
    render(
      <WhatsNewProvider>
        <SiteHeader />
      </WhatsNewProvider>,
    );
    await flush();
    expect(screen.getByRole("button", { name: "What's new" })).toBeTruthy();
  });
});
