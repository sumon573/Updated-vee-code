/**
 * Noble (Nobel) service — NOTE 10 (2026-10-11).
 *
 * Noble XP grows ONLY from real diamonds sent as gifts in voice rooms
 * (hooked in walletService.sendGiftViaFirebase). Self-gifts do NOT count
 * (anti-farming).
 *
 * Data model — users/{uid}/noble (single node, updated in ONE atomic
 * runTransaction per gift, so concurrent gifts can never double-count):
 *   xp                   lifetime XP (diamonds sent, excl. self-gifts)
 *   rankIndex            highest achieved rank (0=Knight … 9=SSKing)
 *   maintenanceRequired  XP that must be sent inside the current window
 *                        to keep the rank secured (= ceil(rankMinXP / 2);
 *                        e.g. Baron 1260 → 630, matching the IMO reference)
 *   maintenanceDeadline  epoch ms when the current 30-day window ends
 *   maintenanceXP        XP sent inside the current window
 *   lapsed               true when a window expired without meeting the
 *                        requirement — privileges are suspended until the
 *                        current window's requirement is met again
 *
 * Rank-ups grant REAL items (official source) via badgeService:
 *   Noble Nameplate → Honor → Nameplate tab (equippable)
 *   Noble Badge     → Honor → Badge tab (Verification section)
 *   Noble Avatar Frame (Count and above) → Decoration → Frames tab
 * Grants use fixed IDs (noble-plate-{rank} etc.) so concurrent rank-ups
 * are idempotent.
 *
 * Privileges that have no real code path yet (Noble Gift, Microphone
 * Ripple, Seat Priority) are flagged enforced:false and the UI shows
 * them honestly as locked — never as unlocked-but-dead.
 */
import { ref, onValue, get, runTransaction } from 'firebase/database';
import { database } from '../config/firebase';
import { grantBadge, grantFrame, grantNameplate } from './badgeService';

export const NOBLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type PrivilegeKey =
  | 'nameplate'
  | 'badge'
  | 'gift'
  | 'avatarFrame'
  | 'entryEffects'
  | 'micRipple'
  | 'seatPriority';

export interface PrivilegeDef {
  key: PrivilegeKey;
  name: string;
  icon: string;
  /** First rank index (0-based) that grants this privilege */
  minRankIndex: number;
  /** False when no real code path enforces this privilege yet */
  enforced: boolean;
}

export const PRIVILEGES: PrivilegeDef[] = [
  { key: 'nameplate',    name: 'Noble Nameplate',   icon: '🎖️', minRankIndex: 0, enforced: true  },
  { key: 'badge',        name: 'Noble Badge',       icon: '🛡️', minRankIndex: 1, enforced: true  },
  { key: 'gift',         name: 'Noble Gift',        icon: '🎁', minRankIndex: 1, enforced: false },
  { key: 'avatarFrame',  name: 'Avatar Frame',      icon: '🖼️', minRankIndex: 3, enforced: true  },
  { key: 'entryEffects', name: 'Fancy Entry Effects', icon: '✨', minRankIndex: 4, enforced: true },
  { key: 'micRipple',    name: 'Microphone Ripple', icon: '🎤', minRankIndex: 6, enforced: false },
  { key: 'seatPriority', name: 'Seat Priority',     icon: '💺', minRankIndex: 9, enforced: false },
];

export interface NobleRank {
  key: string;
  name: string;
  minXP: number;
  maxXP: number;
  color: string;
  privileges: PrivilegeKey[];
}

/**
 * Rank thresholds. Anchor points come from the IMO reference video
 * (Baron 1260~8399, Marquis 252000~587999, Royal Duke 1260K~4200K,
 * SSKing 42000K~1000000000000K); the in-between ranks interpolate
 * those anchors with non-overlapping contiguous ranges.
 */
export const NOBLE_RANKS: NobleRank[] = [
  { key: 'knight',    name: 'Knight',     minXP: 0,         maxXP: 1259,       color: '#8BC34A', privileges: ['nameplate'] },
  { key: 'baron',     name: 'Baron',      minXP: 1260,      maxXP: 8399,       color: '#26A69A', privileges: ['nameplate', 'badge', 'gift'] },
  { key: 'viscount',  name: 'Viscount',   minXP: 8400,      maxXP: 41999,      color: '#42A5F5', privileges: ['nameplate', 'badge', 'gift'] },
  { key: 'count',     name: 'Count',      minXP: 42000,     maxXP: 251999,     color: '#7E57C2', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame'] },
  { key: 'marquis',   name: 'Marquis',    minXP: 252000,    maxXP: 587999,    color: '#EC407A', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects'] },
  { key: 'duke',      name: 'Duke',       minXP: 588000,    maxXP: 1259999,   color: '#FF7043', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects'] },
  { key: 'royalDuke', name: 'Royal Duke', minXP: 1260000,   maxXP: 4200000,   color: '#FFA000', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple'] },
  { key: 'king',      name: 'King',       minXP: 4200001,   maxXP: 41999999,  color: '#FBC02D', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple'] },
  { key: 'sking',     name: 'SKing',      minXP: 42000000,  maxXP: 419999999, color: '#E65100', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple'] },
  { key: 'ssking',    name: 'SSKing',     minXP: 420000000, maxXP: Number.MAX_SAFE_INTEGER, color: '#BF360C',
    privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'seatPriority'] },
];

export interface NobleState {
  xp: number;
  rankIndex: number;
  maintenanceRequired: number;
  maintenanceDeadline: number;
  maintenanceXP: number;
  lapsed: boolean;
}

export function rankIndexForXP(xp: number): number {
  for (let i = NOBLE_RANKS.length - 1; i >= 0; i--) {
    if (xp >= NOBLE_RANKS[i].minXP) return i;
  }
  return 0;
}

/** XP that must be sent inside a 30-day window to keep a rank secured. */
export function maintenanceFor(rankIndex: number): number {
  const minXP = NOBLE_RANKS[Math.max(0, Math.min(rankIndex, NOBLE_RANKS.length - 1))].minXP;
  return Math.ceil(minXP / 2);
}

function coerceState(raw: unknown): NobleState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.xp !== 'number' || typeof s.rankIndex !== 'number') return null;
  return {
    xp: s.xp,
    rankIndex: Math.max(0, Math.min(9, Math.floor(s.rankIndex))),
    maintenanceRequired: typeof s.maintenanceRequired === 'number' ? s.maintenanceRequired : 0,
    maintenanceDeadline: typeof s.maintenanceDeadline === 'number' ? s.maintenanceDeadline : 0,
    maintenanceXP: typeof s.maintenanceXP === 'number' ? s.maintenanceXP : 0,
    lapsed: s.lapsed === true,
  };
}

/**
 * Pure transaction body: apply one gift's XP to the noble state.
 * Handles first-gift init, 30-day window rollover (with lapse marking),
 * rank-ups (fresh maintenance window) and un-lapsing.
 */
function applyNobleGift(cur: unknown, price: number, now: number): NobleState {
  let s: NobleState = coerceState(cur) ?? {
    xp: 0,
    rankIndex: 0,
    maintenanceRequired: maintenanceFor(0),
    maintenanceDeadline: now + NOBLE_WINDOW_MS,
    maintenanceXP: 0,
    lapsed: false,
  };
  // Roll over expired windows (guard caps very long absences).
  let guard = 0;
  while (now > s.maintenanceDeadline && guard++ < 240) {
    const prev: NobleState = s;
    const maintained: boolean = prev.maintenanceXP >= prev.maintenanceRequired;
    s = {
      xp: prev.xp,
      rankIndex: prev.rankIndex,
      maintenanceRequired: prev.maintenanceRequired,
      maintenanceDeadline: prev.maintenanceDeadline + NOBLE_WINDOW_MS,
      maintenanceXP: 0,
      lapsed: !maintained,
    };
  }
  const xp = s.xp + price;
  const maxRank = rankIndexForXP(xp);
  if (maxRank > s.rankIndex) {
    // RANK UP — fresh 30-day window; this gift counts toward it.
    return {
      xp,
      rankIndex: maxRank,
      maintenanceRequired: maintenanceFor(maxRank),
      maintenanceDeadline: now + NOBLE_WINDOW_MS,
      maintenanceXP: price,
      lapsed: false,
    };
  }
  const maintenanceXP = s.maintenanceXP + price;
  // Un-lapse as soon as the current window's requirement is met again.
  const lapsed: boolean = s.lapsed && maintenanceXP < s.maintenanceRequired;
  return {
    xp,
    rankIndex: s.rankIndex,
    maintenanceRequired: s.maintenanceRequired,
    maintenanceDeadline: s.maintenanceDeadline,
    maintenanceXP,
    lapsed,
  };
}

/** Grant the real items a noble rank bestows (idempotent fixed IDs). */
async function grantNobleRankItems(uid: string, rankIndex: number): Promise<void> {
  const rank = NOBLE_RANKS[rankIndex];
  if (!rank) return;
  const now = Date.now();
  const desc = `Noble privilege — earned by reaching ${rank.name} rank.`;
  await grantNameplate(uid, {
    id: `noble-plate-${rank.key}`,
    name: `${rank.name} Nameplate`,
    icon: '🎖️',
    obtainedAt: now,
    validity: 'permanent',
    source: 'official',
    description: desc,
    grantedBy: 'noble-system',
  });
  await grantBadge(uid, {
    id: `noble-badge-${rank.key}`,
    name: `${rank.name} Noble`,
    icon: '👑',
    obtainedAt: now,
    validity: 'permanent',
    source: 'official',
    description: desc,
    howToGet: 'Send diamonds as gifts in voice rooms to earn Noble XP.',
    grantedBy: 'noble-system',
  });
  if (rank.privileges.includes('avatarFrame')) {
    await grantFrame(uid, {
      id: `noble-frame-${rank.key}`,
      name: `${rank.name} Frame`,
      icon: '🖼️',
      obtainedAt: now,
      validity: 'permanent',
      source: 'official',
      description: desc,
      grantedBy: 'noble-system',
    });
  }
}

/**
 * Record one gift's diamonds toward Noble XP. Call ONLY for completed,
 * non-replayed, non-self gifts (the caller guarantees this).
 * Atomic via runTransaction — concurrent gifts never double-count.
 */
export async function recordNobleXP(uid: string, price: number): Promise<void> {
  if (!uid || !(price > 0)) return;
  const nobleRef = ref(database, `users/${uid}/noble`);
  let existed = false;
  let prevRank = 0;
  try {
    const snap = await get(nobleRef);
    existed = snap.exists();
    if (existed) prevRank = coerceState(snap.val())?.rankIndex ?? 0;
  } catch {
    // Read failed — the transaction below still applies safely.
  }
  const now = Date.now();
  const result = await runTransaction(nobleRef, (cur) => applyNobleGift(cur, price, now));
  if (!result.committed) return;
  const next = coerceState(result.snapshot.val());
  const nextRank = next?.rankIndex ?? 0;
  // First gift (node created → Knight) or any rank-up: grant rank items.
  if (next && (nextRank > prevRank || !existed)) {
    try {
      await grantNobleRankItems(uid, nextRank);
    } catch {
      // Non-critical — items will be granted on the next rank-up / gift.
    }
  }
}

/** One-shot read of a user's noble state (null when never earned XP). */
export async function getNobleState(uid: string): Promise<NobleState | null> {
  const snap = await get(ref(database, `users/${uid}/noble`));
  return snap.exists() ? coerceState(snap.val()) : null;
}

/** Live-subscribe to a user's noble state. */
export function subscribeNoble(
  uid: string,
  callback: (state: NobleState | null) => void,
  onError?: (e: unknown) => void,
): () => void {
  return onValue(
    ref(database, `users/${uid}/noble`),
    (snap) => {
      try {
        callback(snap.exists() ? coerceState(snap.val()) : null);
      } catch {
        // Malformed data — keep the last good state.
      }
    },
    (e) => {
      if (onError) onError(e);
    },
  );
}

/**
 * True when a noble privilege is genuinely active for the user:
 * rank reached, privilege has a real code path, and maintenance not lapsed.
 */
export function hasPrivilege(state: NobleState | null, key: PrivilegeKey): boolean {
  if (!state || state.lapsed) return false;
  const p = PRIVILEGES.find((d) => d.key === key);
  return !!p && p.enforced && state.rankIndex >= p.minRankIndex;
}

/** "1260", "12K", "4.2M" — matches the IMO reference formatting. */
export function formatXP(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  return `${Math.floor(n)}`;
}

/** "YYYY-MM-DD HH:mm" — matches the IMO deadline format. */
export function formatDeadline(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => `${x}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
