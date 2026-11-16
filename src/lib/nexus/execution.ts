/** Lease and retry rules. No database and no clock of its own. */

export const MAX_ATTEMPTS = 3;
export const LEASE_SECONDS = 90;

export function retryDelayMs(attempt: number): number {
  const step = Math.max(0, attempt - 1);
  return Math.min(8_000, 250 * 2 ** step);
}

export function mayCommit(input: { heldFence: string; workerFence: string; leaseUntilMs: number; nowMs: number }): boolean {
  return input.heldFence.length > 0 && input.heldFence === input.workerFence && input.leaseUntilMs > input.nowMs;
}

export function nextStatus(attempt: number, maxAttempts = MAX_ATTEMPTS): "retry" | "dead" {
  return attempt >= maxAttempts ? "dead" : "retry";
}
