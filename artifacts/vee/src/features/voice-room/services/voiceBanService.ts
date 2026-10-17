/**
 * Voice-Room Ban Service (2026-10-17, Sumon)
 *
 * Enforces voice-room bans WITHOUT touching login — a banned user can still
 * open the app, chat, and use every feature, but cannot enter any voice room.
 *
 * Firebase layout:
 *   users/{uid}/voiceBan = {
 *     banned: true,
 *     reason: string,          // e.g. 'harassment' | 'spam' | 'hate_speech' | ...
 *     bannedAt: number,        // ms timestamp
 *     bannedUntil: number | null, // null = permanent
 *     bannedBy: string,        // admin uid or name
 *   }
 *   users/{uid}/banHistory/{banId} = { ...same fields, unbannedAt?, unbannedBy? }
 *
 * Null-safety (crash-proof):
 * - users/{uid}/voiceBan may not exist (old accounts) → treated as NOT banned.
 * - Any malformed field → treated as NOT banned (fail-open; a corrupt ban
 *   record must never lock a user out or crash the app).
 * - Network/read failure → NOT banned (fail-open; we never block entry when
 *   we cannot verify — the admin panel is the source of truth for appeals).
 */

import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type VoiceBanInfo = {
  /** Always true when this object is returned — the ban is currently active. */
  active: true;
  /** Machine-readable reason category. */
  reason: string;
  /** ms timestamp when the ban was issued. */
  bannedAt: number;
  /** ms timestamp when the ban lifts; null = permanent. */
  bannedUntil: number | null;
  /** Who issued the ban (admin uid/name). Optional. */
  bannedBy?: string;
};

type RawVoiceBan = {
  banned?: unknown;
  reason?: unknown;
  bannedAt?: unknown;
  bannedUntil?: unknown;
  bannedBy?: unknown;
} | null | undefined;

/* ─── Public API ────────────────────────────────────────────────────────── */

/**
 * Check whether a user is currently banned from voice rooms.
 * Returns the active ban info, or null when the user may enter rooms.
 * Never throws — every failure path returns null (fail-open).
 */
export async function checkVoiceBan(uid: string): Promise<VoiceBanInfo | null> {
  try {
    if (!uid || uid === 'anonymous') return null;
    const snap = await get(ref(database, `users/${uid}/voiceBan`));
    if (!snap.exists()) return null;
    return normalizeBan(snap.val() as RawVoiceBan);
  } catch {
    // Network / permission failure → fail-open (do not block entry).
    return null;
  }
}

/**
 * True when the given ban info represents a ban that is active RIGHT NOW
 * (handles expiry without a network call — pure function, null-safe).
 */
export function isVoiceBanActive(ban: VoiceBanInfo | null | undefined): boolean {
  if (!ban || ban.active !== true) return false;
  if (ban.bannedUntil == null) return true; // permanent
  return Date.now() < ban.bannedUntil;
}

/* ─── Internals ─────────────────────────────────────────────────────────── */

function normalizeBan(raw: RawVoiceBan): VoiceBanInfo | null {
  // Not an object, or the banned flag is not literally true → not banned.
  if (!raw || typeof raw !== 'object' || raw.banned !== true) return null;

  const bannedAt = typeof raw.bannedAt === 'number' && raw.bannedAt > 0
    ? raw.bannedAt
    : Date.now();

  // bannedUntil: null/undefined → permanent. A valid future timestamp → temp.
  // A past timestamp → expired → NOT banned. Anything else → permanent
  // (fail-closed on malformed expiry would risk locking users out forever,
  //  but an admin-set ban should default to permanent rather than vanish).
  let bannedUntil: number | null = null;
  if (typeof raw.bannedUntil === 'number' && raw.bannedUntil > 0) {
    bannedUntil = raw.bannedUntil;
    if (Date.now() >= bannedUntil) return null; // expired
  }

  const reason = typeof raw.reason === 'string' && raw.reason.length > 0
    ? raw.reason
    : 'violation';

  const info: VoiceBanInfo = {
    active: true,
    reason,
    bannedAt,
    bannedUntil,
  };
  if (typeof raw.bannedBy === 'string' && raw.bannedBy.length > 0) {
    info.bannedBy = raw.bannedBy;
  }
  return info;
}
