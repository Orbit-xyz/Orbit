/**
 * Computes remaining time breakdown for a grace period target timestamp.
 *
 * @param {string | number | Date} expiresAt
 * @param {number} [now=Date.now()]
 * @returns {{ days: number, hours: number, minutes: number, seconds: number, totalMs: number, isExpired: boolean }}
 */
export function computeRemainingTime(expiresAt, now = Date.now()) {
  const target = new Date(expiresAt).getTime();
  const diff = target - now;
  if (isNaN(diff) || diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, isExpired: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    days,
    hours,
    minutes,
    seconds,
    totalMs: diff,
    isExpired: false,
  };
}

/**
 * Formats remaining grace time into human-readable countdown string.
 *
 * @param {{ days: number, hours: number, minutes: number, seconds: number, totalMs: number, isExpired: boolean }} time
 * @returns {string}
 */
export function formatRemainingTime(time) {
  if (time.isExpired) return "Grace period expired";
  const parts = [];
  if (time.days > 0) parts.push(`${time.days}d`);
  if (time.hours > 0 || time.days > 0) parts.push(`${time.hours}h`);
  parts.push(`${time.minutes}m`);
  parts.push(`${time.seconds}s`);
  return parts.join(" ");
}
