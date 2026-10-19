/**
 * ISO 8601 week id, e.g. "2026-W42".
 * Used to bucket weekly leaderboard stats (leaderboard_senders / leaderboard)
 * so each week's ranking resets automatically — no reset job needed.
 * UTC-based so every client computes the same week id.
 */
export function getCurrentWeekId(d: Date = new Date()): string {
  // 2026-10-19 polish: the old code built the UTC date from LOCAL
  // year/month/date — two clients in different timezones could compute
  // different week ids for the same instant near midnight. UTC components
  // so every client on earth agrees on the current week.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO: Thursday of the current week determines the week-year.
  const dayNum = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
