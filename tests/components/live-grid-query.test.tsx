import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchLiveGrid = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchLiveGrid: (...args: unknown[]) => fetchLiveGrid(...args),
}));

import { useLiveGridQuery } from "@/lib/queries";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useLiveGridQuery polling", () => {
  beforeEach(() => {
    fetchLiveGrid.mockReset();
    fetchLiveGrid.mockResolvedValue({ match_id: 1, stages: [], shooters: [], cells: {}, cacheInfo: { cachedAt: null } });
  });

  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  it("polls every 30s while live (default)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useLiveGridQuery("22", "1", [1, 2]), { wrapper: wrapper() });
    await waitFor(() => expect(fetchLiveGrid).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(fetchLiveGrid).toHaveBeenCalledTimes(2);
  });

  it("fetches once and never polls when not live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useLiveGridQuery("22", "1", [1, 2], { live: false }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(fetchLiveGrid).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchLiveGrid).toHaveBeenCalledTimes(1);
  });

  it("does not refetch on window focus when not live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useLiveGridQuery("22", "1", [1, 2], { live: false }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(fetchLiveGrid).toHaveBeenCalledTimes(1));
    // Past any staleTime, so a focus refetch would fire if it were enabled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(fetchLiveGrid).toHaveBeenCalledTimes(1);
  });
});
