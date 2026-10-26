/**
 * coupleLevels.ts — Couple level curve + couple-state reads (2026-10-26).
 *
 * SINGLE couple curve (coordinator decision, boss evidence: Lv.1 = 0~4000
 * hearts confirmed; every invitation-screenshot row 15200–81460 read Lv.2):
 *   Lv.1 0 ~ 4000 · Lv.2 4000 ~ 100000 · Lv.3 100000 ~ 200000 ·
 *   Lv.4 200000 ~ 350000 · Lv.5 350000 ~ 550000 · Lv.6 550000 ~ 800000 ·
 *   Lv.7 800000 ~ 1100000 · Lv.8 1100000 ~ 1500000 ·
 *   Lv.9 1500000 ~ 2000000 · Lv.max 2000000+
 * Thresholds are lower bounds: levelFor picks the HIGHEST level whose min
 * is <= the hearts value, so exactly 4000 hearts is Lv.2 (its range starts
 * at 4000) and 3999 is Lv.1. This matches the displayed ranges.
 *
 * Couple hearts = giftHearts + togetherHearts + pkHearts on
 * couples/{pairKey}; every field defaults to 0 when absent.
 *
 * Server-driven override: subscribeCoupleLevels reads RTDB
 * couple_config/levels when present and falls back to the defaults below
 * on missing/invalid data — never crashes. This module only READS; it
 * never writes couple_config (another owner publishes that node).
 *
 * Couple state shape (read-only; nodes do not exist yet in live data, so
 * every read handles null as "no couple"):
 *   userCouples/{uid} -> pairKey string, or an object carrying a pairKey /
 *     partnerUid field (both accepted; the node shape is not settled yet).
 *   couples/{pairKey} -> { giftHearts?, togetherHearts?, pkHearts?,
 *     hearts?, uidA?, uidB?, members? } — partnerUid is derived from the
 *     record fields when present, else from the pairKey's two parts.
 */

import { ref, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

// ─── Curve ───────────────────────────────────────────────────────────────────

export interface CoupleLevel {
  id: number; // 1..9, 10 = max
  min: number;
  max: number | null; // null = open-ended top level
}

export const DEFAULT_COUPLE_LEVELS: CoupleLevel[] = [
  { id: 1, min: 0, max: 4000 },
  { id: 2, min: 4000, max: 100000 },
  { id: 3, min: 100000, max: 200000 },
  { id: 4, min: 200000, max: 350000 },
  { id: 5, min: 350000, max: 550000 },
  { id: 6, min: 550000, max: 800000 },
  { id: 7, min: 800000, max: 1100000 },
  { id: 8, min: 1100000, max: 1500000 },
  { id: 9, min: 1500000, max: 2000000 },
  { id: 10, min: 2000000, max: null },
];

/** Display label for a level id: 10 renders as "max" (Lv.max). */
export function coupleLevelLabel(level: CoupleLevel): string {
  return level.id >= 10 ? 'max' : String(level.id);
}

/** "Lv.1" / "Lv.max". */
export function formatCoupleLevel(level: CoupleLevel): string {
  return `Lv.${coupleLevelLabel(level)}`;
}

/** "0 ~ 4000" for bounded levels, "2000000+" for the open-ended max level. */
export function coupleLevelRangeText(level: CoupleLevel): string {
  if (level.max === null) return `${formatHearts(level.min)}+`;
  return `${formatHearts(level.min)} ~ ${formatHearts(level.max)}`;
}

/** "Lv.1 · 0 ~ 4000" / "Lv.max · 2000000+". */
export function coupleLevelRangeLine(level: CoupleLevel): string {
  return `${formatCoupleLevel(level)} · ${coupleLevelRangeText(level)}`;
}

/** Thousands-separated hearts, e.g. 81460 -> "81,460". */
export function formatHearts(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return v.toLocaleString('en-US');
}

function sortedLevels(levels: CoupleLevel[]): CoupleLevel[] {
  return [...levels].sort((a, b) => a.min - b.min || a.id - b.id);
}

/**
 * Level for a hearts total: the highest level whose min is <= hearts.
 * Falls back to the first level for negative/NaN input.
 */
export function coupleLevelFor(hearts: number, levels: CoupleLevel[] = DEFAULT_COUPLE_LEVELS): CoupleLevel {
  const sorted = sortedLevels(levels.length > 0 ? levels : DEFAULT_COUPLE_LEVELS);
  const h = Number.isFinite(hearts) ? hearts : 0;
  let found = sorted[0];
  for (const l of sorted) {
    if (h >= l.min) found = l;
    else break;
  }
  return found;
}

/** 0..1 progress within the current level (1 at the max level). */
export function coupleLevelProgress(hearts: number, levels: CoupleLevel[] = DEFAULT_COUPLE_LEVELS): number {
  const l = coupleLevelFor(hearts, levels);
  if (l.max === null) return 1;
  const span = l.max - l.min;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (hearts - l.min) / span));
}

/** Validate a server-provided levels list; returns null when unusable. */
function parseLevels(raw: unknown): CoupleLevel[] | null {
  let entries: unknown[] = [];
  if (Array.isArray(raw)) entries = raw;
  else if (raw && typeof raw === 'object') {
    entries = Object.entries(raw as Record<string, unknown>)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => v);
  } else return null;
  const out: CoupleLevel[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown> | null;
    if (!e || typeof e !== 'object') return null;
    const min = typeof e.min === 'number' ? e.min : undefined;
    const max = e.max === null || e.max === undefined ? null : typeof e.max === 'number' ? e.max : undefined;
    if (min === undefined || max === undefined) return null;
    if (min < 0 || (max !== null && max <= min)) return null;
    out.push({ id: typeof e.id === 'number' ? e.id : i + 1, min, max });
  }
  if (out.length === 0) return null;
  // Mins must strictly increase, otherwise the curve is ambiguous.
  const sorted = sortedLevels(out);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min <= sorted[i - 1].min) return null;
  }
  return sorted;
}

/**
 * Live couple-level curve: RTDB couple_config/levels when present and
 * valid, otherwise DEFAULT_COUPLE_LEVELS. Never throws, never emits
 * unusable data.
 */
export function subscribeCoupleLevels(cb: (levels: CoupleLevel[]) => void): () => void {
  try {
    return onValue(
      ref(database, 'couple_config/levels'),
      (snap) => {
        if (!snap.exists()) {
          cb(DEFAULT_COUPLE_LEVELS);
          return;
        }
        cb(parseLevels(snap.val()) ?? DEFAULT_COUPLE_LEVELS);
      },
      () => cb(DEFAULT_COUPLE_LEVELS),
    );
  } catch {
    cb(DEFAULT_COUPLE_LEVELS);
    return () => {};
  }
}

// ─── Couple state (read-only) ────────────────────────────────────────────────

export interface CoupleRecord {
  giftHearts?: number;
  togetherHearts?: number;
  pkHearts?: number;
  hearts?: number;
  uidA?: string;
  uidB?: string;
  members?: unknown;
  [key: string]: unknown;
}

export interface CoupleState {
  pairKey: string;
  partnerUid: string | null;
  giftHearts: number;
  togetherHearts: number;
  pkHearts: number;
  /** Total couple hearts (field sum, or the stored total when present). */
  hearts: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function partnerFromRecord(uid: string, pairKey: string, rec: CoupleRecord | null): string | null {
  if (rec) {
    const a = typeof rec.uidA === 'string' ? rec.uidA : null;
    const b = typeof rec.uidB === 'string' ? rec.uidB : null;
    if (a && b) return a === uid ? b : b === uid ? a : null;
    if (Array.isArray(rec.members)) {
      const others = (rec.members as unknown[]).filter(
        (m) => typeof m === 'string' && m !== uid,
      ) as string[];
      if (others.length > 0) return others[0];
    }
  }
  // Pair keys are two uids joined with '_' (same convention as intimacy).
  const parts = pairKey ? pairKey.split('_') : [];
  if (parts.length === 2) {
    if (parts[0] === uid) return parts[1];
    if (parts[1] === uid) return parts[0];
  }
  return null;
}

function stateFromRecord(
  uid: string,
  pairKey: string,
  partnerUid: string | null,
  rec: CoupleRecord | null,
): CoupleState {
  const giftHearts = num(rec?.giftHearts);
  const togetherHearts = num(rec?.togetherHearts);
  const pkHearts = num(rec?.pkHearts);
  const sum = giftHearts + togetherHearts + pkHearts;
  return {
    pairKey,
    partnerUid: partnerUid ?? partnerFromRecord(uid, pairKey, rec),
    giftHearts,
    togetherHearts,
    pkHearts,
    // A stored total wins only when no component fields are present.
    hearts: sum > 0 || rec == null ? sum : num(rec?.hearts),
  };
}

/**
 * Live couple state for a uid. Emits null when there is no couple
 * (userCouples node missing, or an entry with neither pairKey nor
 * partnerUid). Read-only; never writes. The inner couples/{pairKey}
 * subscription is re-created whenever the pointer changes and cleaned
 * up on unsubscribe.
 */
export function subscribeCoupleState(
  uid: string,
  cb: (state: CoupleState | null) => void,
): () => void {
  if (!uid) {
    cb(null);
    return () => {};
  }
  let innerUnsub: () => void = () => {};
  let outerDone = false;
  const cleanup = () => {
    innerUnsub();
    innerUnsub = () => {};
  };
  let outerUnsub: () => void = () => {};
  try {
    outerUnsub = onValue(
      ref(database, `userCouples/${uid}`),
      (snap) => {
        cleanup();
        if (!snap.exists()) {
          cb(null);
          return;
        }
        const v = snap.val() as unknown;
        let pairKey = '';
        let partnerUid: string | null = null;
        if (typeof v === 'string') {
          pairKey = v;
        } else if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          if (typeof o.pairKey === 'string') pairKey = o.pairKey;
          else if (typeof o.coupleId === 'string') pairKey = o.coupleId;
          else if (typeof o.key === 'string') pairKey = o.key;
          if (typeof o.partnerUid === 'string') partnerUid = o.partnerUid;
          else if (typeof o.partner === 'string') partnerUid = o.partner;
        }
        if (!pairKey && !partnerUid) {
          cb(null);
          return;
        }
        if (!pairKey) {
          // Pointer without a pair record: coupled, hearts unknown (0).
          cb(stateFromRecord(uid, '', partnerUid, null));
          return;
        }
        try {
          innerUnsub = onValue(
            ref(database, `couples/${pairKey}`),
            (csnap) => {
              const rec = csnap.exists() ? (csnap.val() as CoupleRecord) : null;
              cb(stateFromRecord(uid, pairKey, partnerUid, rec));
            },
            () => cb(stateFromRecord(uid, pairKey, partnerUid, null)),
          );
        } catch {
          cb(stateFromRecord(uid, pairKey, partnerUid, null));
        }
      },
      () => {
        if (!outerDone) cb(null);
      },
    );
  } catch {
    cb(null);
  }
  return () => {
    outerDone = true;
    cleanup();
    try {
      outerUnsub();
    } catch {}
  };
}
