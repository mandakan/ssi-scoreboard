// Default background-work scheduler — Node.js / Docker target.
// In Node.js the process stays alive as long as there are pending promises,
// so fire-and-forget is safe and waitUntil is not needed.
export function afterResponse(promise: Promise<void>): void {
  void promise;
}
