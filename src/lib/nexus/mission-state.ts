/** In-memory mission status changes only after the write that represents the commit has returned. */

export function applyTransition<T extends { status: string }>(mission: T, to: string, write: () => void): void {
  write();
  mission.status = to;
}
