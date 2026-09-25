import { config } from "./config.js";

/**
 * In-memory per-user game lock.
 * Prevents concurrent spam bets (rapid tapping, double requests during dice animations).
 * key: userId, value: lock expiry timestamp
 */
export const activeGameLocks = new Map<number, number>();

export function acquireLock(userId: number): boolean {
  const now = Date.now();
  const expiry = activeGameLocks.get(userId);
  if (expiry && now < expiry) return false; // lock still active
  activeGameLocks.set(userId, now + config.GAME_LOCK_MS);
  return true;
}

export function releaseLock(userId: number): void {
  activeGameLocks.delete(userId);
}

/** Auto-purge stale entries every minute */
setInterval(() => {
  const now = Date.now();
  for (const [uid, expiry] of activeGameLocks) {
    if (now >= expiry) activeGameLocks.delete(uid);
  }
}, 60_000);
