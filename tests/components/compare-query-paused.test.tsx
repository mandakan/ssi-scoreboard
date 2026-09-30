import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchCompare = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchCompare: (...args: unknown[]) => fetchCompare(...args),
}));

import { useCompareQuery } from "@/lib/queries";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("useCompareQuery paused option", () => {
  beforeEach(() => {
    fetchCompare.mockReset();
    fetchCompare.mockResolvedValue({ cacheInfo: { cachedAt: null } });
  });
  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  it("has no refetchInterval or window-focus refetch when paused, same key", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const live = setup();
    const a = renderHook(() => useCompareQuery("22", "1", [1, 2], "live"), {
      wrapper: live.wrapper,
    });
    await waitFor(() => expect(fetchCompare).toHaveBeenCalledTimes(1));
    const liveQuery = live.client.getQueryCache().getAll()[0];
    expect((liveQuery.observers[0].options as { refetchInterval: unknown }).refetchInterval).toBe(30_000);
    a.unmount();

    fetchCompare.mockClear();
    const paused = setup();
    renderHook(() => useCompareQuery("22", "1", [1, 2], "live", { paused: true }), {
      wrapper: paused.wrapper,
    });
    await waitFor(() => expect(fetchCompare).toHaveBeenCalledTimes(1));
    const q = paused.client.getQueryCache().getAll()[0];
    const opts = q.observers[0].options as {
      refetchInterval: unknown;
      refetchOnWindowFocus: unknown;
    };
    expect(opts.refetchInterval).toBe(false);
    expect(opts.refetchOnWindowFocus).toBe(false);
    expect(q.queryKey).toEqual(liveQuery.queryKey);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchCompare).toHaveBeenCalledTimes(1);
  });
});
