// Small concurrency-limited variant of Promise.allSettled.
//
// Added after the 2026-08-15 SSI incident: an uncapped Promise.allSettled over
// per-window upstream queries let a single request open 100+ concurrent
// connections to the SSI GraphQL API. Any fan-out against an upstream we do
// not own should go through this helper instead.

export async function allSettledWithLimit<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, tasks.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
