import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 2026-10-26 (Event Engine v1): a user's active event effects, in REAL-TIME.
 *
 * Same architecture as useActiveFrame (2026-10-14): SeatCard listens DIRECTLY
 * to users/{uid}/eventEffects — no stale seat copies, no mapping bugs, admin
 * (bot) changes reflect LIVE. One shared ref-counted subscription per uid,
 * so a 10-seat room does not attach 10 listeners for the same uid.
 *
 * Server shape (bot-written): users/{uid}/eventEffects/{rewardId} = {
 *   type: 'vibe' | 'ripple' | ..., expiresAt?: number (ms), params?: {...} }
 * Expired entries are IGNORED by consumers (belt + suspenders: the bot also
 * cleans them, but a lagging bot must never show a dead effect).
 */

export interface EventEffect {
  type: string;
  expiresAt?: number;
  params?: Record<string, unknown>;
}

type EffectsMap = Record<string, EventEffect>;

function parseEffects(val: unknown): EffectsMap | null {
  if (!val || typeof val !== 'object') return null;
  const out: EffectsMap = {};
  for (const [id, raw] of Object.entries(val as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.type !== 'string' || !rec.type) continue;
    out[id] = {
      type: rec.type,
      expiresAt: typeof rec.expiresAt === 'number' ? rec.expiresAt : undefined,
      params: rec.params && typeof rec.params === 'object'
        ? (rec.params as Record<string, unknown>) : undefined,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

interface EffectsEntry {
  value: EffectsMap | null;
  refCount: number;
  listeners: Set<(v: EffectsMap | null) => void>;
  unsub: (() => void) | null;
}

const effectsCache = new Map<string, EffectsEntry>();

function ensureEffectsSubscription(uid: string): EffectsEntry {
  const existing = effectsCache.get(uid);
  if (existing) return existing;

  const entry: EffectsEntry = {
    value: null,
    refCount: 0,
    listeners: new Set(),
    unsub: null,
  };

  entry.unsub = onValue(ref(database, `users/${uid}/eventEffects`), (snap) => {
    const next = parseEffects(snap.val());
    const prevJson = JSON.stringify(entry.value);
    const nextJson = JSON.stringify(next);
    if (prevJson !== nextJson) {
      entry.value = next;
      for (const cb of entry.listeners) {
        try { cb(next); } catch { /* one bad listener must not break the rest */ }
      }
    }
  }, () => {
    // Fall back to no effects instead of a silently dead listener.
    if (entry.value !== null) {
      entry.value = null;
      for (const cb of entry.listeners) {
        try { cb(null); } catch { /* ignore */ }
      }
    }
  });

  effectsCache.set(uid, entry);
  return entry;
}

/** Subscribe to a uid's event effects. Ref-counted, change-only callbacks. */
export function subscribeEventEffects(
  uid: string,
  cb: (effects: EffectsMap | null) => void,
): () => void {
  const entry = ensureEffectsSubscription(uid);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.value);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try { entry.unsub?.(); } catch { /* ignore */ }
      effectsCache.delete(uid);
    }
  };
}

export function useEventEffects(uid: string | undefined | null): EffectsMap | null {
  const [effects, setEffects] = useState<EffectsMap | null>(() =>
    uid ? effectsCache.get(uid)?.value ?? null : null,
  );

  useEffect(() => {
    if (!uid) {
      setEffects(null);
      return;
    }
    return subscribeEventEffects(uid, setEffects);
  }, [uid]);

  return effects;
}

/** The active (unexpired) effect of a given type, or null. Latest-expiring wins. */
export function getActiveEffect(
  effects: EffectsMap | null | undefined,
  type: string,
  now: number = Date.now(),
): { id: string; effect: EventEffect } | null {
  if (!effects) return null;
  let best: { id: string; effect: EventEffect } | null = null;
  for (const [id, effect] of Object.entries(effects)) {
    if (effect.type !== type) continue;
    if (effect.expiresAt !== undefined && effect.expiresAt <= now) continue;
    if (!best) { best = { id, effect }; continue; }
    const bestExp = best.effect.expiresAt ?? 0;
    const thisExp = effect.expiresAt ?? 0;
    if (thisExp > bestExp) best = { id, effect };
  }
  return best;
}

/** Gradient colors from an effect's server params, or the fallback. */
export function effectColors(
  effect: EventEffect | null | undefined,
  fallback: string[],
): [string, string, ...string[]] {
  const colors = effect?.params?.colors;
  if (Array.isArray(colors)) {
    const clean = colors.filter((c): c is string => typeof c === 'string' && !!c);
    if (clean.length >= 2) return clean as [string, string, ...string[]];
  }
  const f = fallback.filter((c) => typeof c === 'string' && !!c);
  return (f.length >= 2 ? f : ['#F59E0B', '#EC4899', '#8B5CF6']) as [string, string, ...string[]];
}

/** Solid color from an effect's server params, or the fallback. */
export function effectColor(
  effect: EventEffect | null | undefined,
  fallback: string,
): string {
  const color = effect?.params?.color;
  return typeof color === 'string' && !!color ? color : fallback;
}
