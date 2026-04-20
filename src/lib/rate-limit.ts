/**
 * In-memory rate limiter for login brute-force protection.
 * Tracks failed attempts per IP. Locks out after MAX_ATTEMPTS for LOCKOUT_DURATION.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

const attempts = new Map<string, AttemptRecord>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (
      record.lockedUntil && record.lockedUntil < now &&
      now - record.firstAttempt > LOCKOUT_DURATION_MS
    ) {
      attempts.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Check if an IP is currently locked out.
 * Returns the remaining lockout time in seconds, or 0 if not locked.
 */
export function checkRateLimit(ip: string): number {
  const record = attempts.get(ip);
  if (!record?.lockedUntil) return 0;

  const remaining = record.lockedUntil - Date.now();
  if (remaining <= 0) {
    attempts.delete(ip);
    return 0;
  }

  return Math.ceil(remaining / 1000);
}

/**
 * Record a failed login attempt. Returns true if the IP is now locked out.
 */
export function recordFailedAttempt(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record) {
    attempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: null });
    return false;
  }

  // Reset if window has expired
  if (now - record.firstAttempt > LOCKOUT_DURATION_MS) {
    attempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: null });
    return false;
  }

  record.count++;

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    return true;
  }

  return false;
}

/**
 * Clear failed attempts for an IP (call on successful login).
 */
export function clearAttempts(ip: string): void {
  attempts.delete(ip);
}
