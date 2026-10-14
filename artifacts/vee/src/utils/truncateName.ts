/**
 * Truncate display names to prevent UI mess from very long names.
 * 2026-10-14 (Sumon): name character limits across the app.
 *
 * Limits:
 * - Voice room seat: 6 chars
 * - Gift sender: 6 chars
 * - Everywhere else (profile, contacts, chat list, search, audience, etc.): 12 chars
 *
 * If name exceeds the limit, truncates and appends "...".
 * Empty/null/undefined names return "" (caller applies "Vee User" fallback).
 */
export const NAME_LIMITS = {
  SEAT: 6,
  GIFT: 6,
  STANDARD: 12,
} as const;

export function truncateName(name: string | null | undefined, limit: number): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit) + '...';
}

/** Voice room seat name: 6 chars max */
export function seatName(name: string | null | undefined): string {
  return truncateName(name, NAME_LIMITS.SEAT);
}

/** Gift sender name: 6 chars max */
export function giftName(name: string | null | undefined): string {
  return truncateName(name, NAME_LIMITS.GIFT);
}

/** Standard name (profile, contacts, chat, search, audience, etc.): 12 chars max */
export function truncateTo12(name: string | null | undefined): string {
  return truncateName(name, NAME_LIMITS.STANDARD);
}
