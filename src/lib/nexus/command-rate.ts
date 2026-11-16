/** Per-process command limit. It does not apply across multiple servers. */

const WINDOW_MS = 60_000;
const LIMIT = 40;

const hits = new Map<string, number[]>();
let dropped = 0;

export function commandRateSnapshot(): { tracked: number; dropped: number; limit: number; windowMs: number } {
  return { tracked: hits.size, dropped, limit: LIMIT, windowMs: WINDOW_MS };
}

export function assertCommandRate(userId: string, now = Date.now()): void {
  const recent = (hits.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(userId, recent);
    throw new Error("Too many company commands. Wait a minute.");
  }
  recent.push(now);
  hits.set(userId, recent);
  for (const [key, stamps] of hits) {
    if (key === userId) continue;
    const live = stamps.filter((at) => now - at < WINDOW_MS);
    if (live.length === 0) {
      hits.delete(key);
      dropped += 1;
    }
  }
}
