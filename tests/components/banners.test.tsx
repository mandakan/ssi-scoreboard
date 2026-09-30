import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { InstallBanner } from "@/components/install-banner";
import { UpdateBanner } from "@/components/update-banner";
import { PWAInstallProvider } from "@/lib/pwa-install";

const ABOVE_BAR = "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("banners sit above the bottom bar and below dialogs", () => {
  it("InstallBanner clears the bar plus safe-area inset and uses z-40", async () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) =>
        ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    render(
      <PWAInstallProvider>
        <InstallBanner />
      </PWAInstallProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
    });
    const banner = screen.getByRole("status");
    expect(banner).toHaveClass(ABOVE_BAR, "md:bottom-0", "z-40");
    expect(banner).not.toHaveClass("bottom-14");
  });

  it("UpdateBanner clears the bar plus safe-area inset and uses z-40", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "old-build");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildId: "new-build" }) }),
    );
    render(<UpdateBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const banner = screen.getByRole("status");
    expect(banner).toHaveClass(ABOVE_BAR, "md:bottom-0", "z-40");
    expect(banner).not.toHaveClass("bottom-14", "z-50");
  });
});
