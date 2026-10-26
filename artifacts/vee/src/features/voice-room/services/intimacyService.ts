/**
 * intimacyService.ts — IMO intimacy/relationship system, ported to Vee (2026-10-19).
 *
 * IMO evidence:
 * - voiceroom/intimacyrelation/data/IntimacyBean {anon_id, num} — intimacy value per pair
 * - voiceroom/revenue/intimacy/IntimacyLevelConfig {level_id, min_value, max_value, ...}
 *   — levels with value thresholds, icons, privileges
 * - IMO behavior: intimacy grows when two users interact (gifts); levels unlock
 *   visual privileges; entry view lists relationships, puzzle-style detail UI.
 *
 * Vee backend: intimacy/{pairKey} = { value, updatedAt }, where pairKey is the two
 * uids sorted and joined with '_'. Growth: +gift diamond price per gift sent
 * between the pair (self-gifts excluded — anti-farming, mirrors noble XP).
 * RULES DEPENDENCY (must be deployed — see report): intimacy/$pairKey —
 *   .read: auth != null; .write: auth.uid is one of the two uids in the key
 *   (client increments own pair only; validate value only grows).
 */

import { ref, onValue, runTransaction, get } from 'firebase/database';
import { database } from '@/src/config/firebase';

// ─── Levels (IMO-exact shape: level_id + min/max value) ───────────────────────

export interface IntimacyLevel {
  id: number;
  min: number;
  max: number | null; // null = open-ended top level
}

export const INTIMACY_LEVELS: IntimacyLevel[] = [
  { id: 1, min: 0, max: 99 },
  { id: 2, min: 100, max: 499 },
  { id: 3, min: 500, max: 1499 },
  { id: 4, min: 1500, max: 2999 },
  { id: 5, min: 3000, max: 5999 },
  { id: 6, min: 6000, max: 11999 },
  { id: 7, min: 12000, max: 24999 },
  { id: 8, min: 25000, max: 49999 },
  { id: 9, min: 50000, max: 99999 },
  { id: 10, min: 100000, max: null },
];

export function intimacyLevelFor(value: number): IntimacyLevel {
  for (const l of INTIMACY_LEVELS) {
    if (value >= l.min && (l.max === null || value <= l.max)) return l;
  }
  return INTIMACY_LEVELS[INTIMACY_LEVELS.length - 1];
}

/** 0..1 progress within the current level (for the progress bar / puzzle fill). */
export function intimacyProgress(value: number): number {
  const l = intimacyLevelFor(value);
  if (l.max === null) return 1;
  const span = l.max - l.min + 1;
  return Math.min(1, Math.max(0, (value - l.min + 1) / span));
}

// ─── Pair key ────────────────────────────────────────────────────────────────

/** Deterministic pair key — same regardless of direction. */
export function intimacyPairKey(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface IntimacyRecord {
  value: number;
  updatedAt: number;
}

/**
 * Add intimacy between two users (fire-and-forget from the gift pipeline).
 * Self-pairs are ignored (anti-farming).
 */
export async function recordIntimacy(fromUid: string, toUid: string, amount: number): Promise<void> {
  if (!fromUid || !toUid || fromUid === toUid) return;
  if (!(amount > 0)) return;
  const key = intimacyPairKey(fromUid, toUid);
  try {
    await runTransaction(ref(database, `intimacy/${key}`), (cur: unknown) => {
      const curVal = cur as Partial<IntimacyRecord> | null;
      const prev = curVal && typeof curVal.value === 'number' ? curVal.value : 0;
      return { value: prev + Math.floor(amount), updatedAt: Date.now() };
    });
  } catch {
    // Non-critical — gift stands; intimacy for this gift is lost.
  }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Live intimacy record for one pair. */
export function subscribeIntimacy(
  uidA: string,
  uidB: string,
  cb: (rec: IntimacyRecord) => void,
): () => void {
  const key = intimacyPairKey(uidA, uidB);
  return onValue(
    ref(database, `intimacy/${key}`),
    (snap) => {
      const v = snap.val() as Partial<IntimacyRecord> | null;
      cb({
        value: v && typeof v.value === 'number' ? v.value : 0,
        updatedAt: v && typeof v.updatedAt === 'number' ? v.updatedAt : 0,
      });
    },
    () => cb({ value: 0, updatedAt: 0 }),
  );
}

export interface IntimacyEntry {
  pairKey: string;
  otherUid: string;
  value: number;
  updatedAt: number;
}

/**
 * All intimacy pairs involving uid (for the entry list). Scans the intimacy
 * node once per subscribe — pairs are keyed uidA_uidB so we filter by prefix
 * membership client-side. Fine at Vee's scale (one small node per pair).
 */
export function subscribeMyIntimacies(
  uid: string,
  cb: (entries: IntimacyEntry[]) => void,
): () => void {
  return onValue(
    ref(database, 'intimacy'),
    (snap) => {
      const out: IntimacyEntry[] = [];
      if (snap.exists()) {
        snap.forEach((c) => {
          const key = c.key ?? '';
          const parts = key.split('_');
          if (parts.length === 2 && (parts[0] === uid || parts[1] === uid)) {
            const v = c.val() as Partial<IntimacyRecord>;
            out.push({
              pairKey: key,
              otherUid: parts[0] === uid ? parts[1] : parts[0],
              value: typeof v.value === 'number' ? v.value : 0,
              updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
            });
          }
        });
      }
      out.sort((a, b) => b.value - a.value);
      cb(out);
    },
    () => cb([]),
  );
}

/** Resolve a display name/photo for a uid (best-effort, cached by caller). */
export async function fetchPeerProfile(uid: string): Promise<{ name: string; photoURL: string | null }> {
  try {
    const snap = await get(ref(database, `users/${uid}`));
    if (snap.exists()) {
      const v = snap.val() as { displayName?: string; name?: string; photoURL?: string };
      return {
        // 2026-10-26 (boss: one name only): nickname first — displayName
        // first used to show the Google name next to the nickname.
        name: v.name?.trim() || v.displayName?.trim() || '',
        photoURL: typeof v.photoURL === 'string' ? v.photoURL : null,
      };
    }
  } catch {
    // fall through
  }
  return { name: '', photoURL: null };
}
