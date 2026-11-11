/**
 * Entry-effect auto-use (2026-11-11, boss rule).
 *
 * ONE shared place for entry-effect ranking + auto-use — used by the
 * SVIP grant flow, the noble grant flow, and the Decoration load
 * reconcile. No other screen re-implements this.
 *
 * Rule: the HIGHEST-starred entry effect is ALWAYS the active one.
 * Priority, highest first: (1) SVIP 5-star, (2) Nobel 5-star,
 * (3) other 5-star, then lower stars in rank order (5 > 4 > 3 > 2 > 1).
 * Within the same star count, SVIP beats Nobel beats other; a final
 * newest-first tie-break keeps the pick deterministic.
 *
 * 2026-11-11 (boss, manual-choice override): auto-use is the DEFAULT,
 * but an explicit "Use" tap is an OVERRIDE that sticks. The tap writes
 * `users/{uid}/entryEffectManualChoice` = the chosen id alongside
 * `activeEntryEffect`. Every reconcile checks the marker FIRST: while
 * the manually-chosen effect is still held + valid, reconcile leaves
 * `activeEntryEffect` alone (and re-asserts it if something else moved
 * it) — a NEW higher grant, a noble re-grant, or a Decoration load must
 * NOT override it. Only when the manual choice is gone/expired/removed
 * does reconcile clear the marker and fall back to auto-use (highest).
 *
 * Source is derived from the grant's `source` field OR the id prefix
 * (`svip*` vs `noble-effect-*`) — never hardcoded per item — so
 * client-granted SVIP rewards (stored with source 'official') rank
 * and label exactly like server-granted ones (source 'svip').
 *
 * Safety: reconcile is a no-op when there are no entry effects, when
 * the highest-ranked one is already active, or when the write is not
 * needed. It never runs on render, never polls, never loops — only
 * on grant and on Decoration load.
 */
import { ref, get, set, update, remove } from 'firebase/database';
import { database } from '../config/firebase';
import { grantStars } from '../components/NobleStarPill';
import { isStillValid } from './badgeService';

/** RTDB field holding the user's explicit "Use" choice (an entry-effect id). */
export const MANUAL_ENTRY_EFFECT_FIELD = 'entryEffectManualChoice' as const;

/** Minimal shape an entry-effect grant carries (server + client grants). */
export interface EntryEffectGrantLike {
  id: string;
  source?: string;
  stars?: number;
  obtainedAt?: number;
  validity?: 'permanent' | number;
}

/** True for an SVIP entry effect: source 'svip', or an svip* id. */
export function isSvipEntryEffect(effect: { id: string; source?: string }): boolean {
  return effect.source === 'svip' || effect.id.startsWith('svip');
}

/** True for a Nobel entry effect: source 'noble', or a noble-effect-* id. */
export function isNobleEntryEffect(effect: { id: string; source?: string }): boolean {
  return effect.source === 'noble' || effect.id.startsWith('noble-effect-');
}

/** Source priority for the tie-break: SVIP (0) beats Nobel (1) beats other (2). */
function entryEffectSourceRank(effect: { id: string; source?: string }): number {
  if (isSvipEntryEffect(effect)) return 0;
  if (isNobleEntryEffect(effect)) return 1;
  return 2;
}

/**
 * Entry effects ranked best-first: most stars, then SVIP > Nobel >
 * other, then newest. Starless = 0 (never invented — grantStars
 * reads the server `stars` field, else the noble rank spec).
 */
export function rankEntryEffects<T extends EntryEffectGrantLike>(effects: T[]): T[] {
  return [...effects].sort((a, b) => {
    const aStars = grantStars(a) ?? 0;
    const bStars = grantStars(b) ?? 0;
    if (aStars !== bStars) return bStars - aStars;
    const aSrc = entryEffectSourceRank(a);
    const bSrc = entryEffectSourceRank(b);
    if (aSrc !== bSrc) return aSrc - bSrc;
    return (b.obtainedAt || 0) - (a.obtainedAt || 0);
  });
}

/**
 * The id that SHOULD be active, or null when nothing needs to change:
 * no entry effects held, the highest-ranked one already active, or the
 * stored active id points at an effect no longer held (fall back to the
 * highest-ranked one actually held).
 *
 * Manual-choice override (2026-11-11): when `manualChoiceId` names a
 * still-held + valid effect, THAT id is the answer — the manual choice
 * wins over the highest-ranked one. A manual choice that is no longer
 * held/valid is ignored here (reconcile clears the stale marker and
 * falls back to auto-use below).
 */
export function pickActiveEntryEffect(
  effects: EntryEffectGrantLike[],
  currentActiveId?: string | null,
  manualChoiceId?: string | null,
): string | null {
  const held = effects.filter((e) => isStillValid(e.validity));
  if (held.length === 0) return null;
  if (manualChoiceId) {
    const chosen = held.find((e) => e.id === manualChoiceId);
    if (chosen) {
      if (currentActiveId === chosen.id) return null;
      return chosen.id;
    }
  }
  const best = rankEntryEffects(held)[0];
  if (!best) return null;
  if (currentActiveId === best.id) return null;
  return best.id;
}

/**
 * Record an explicit "Use" tap: the chosen effect becomes active AND
 * is remembered as the manual choice, so later reconciles (new grant,
 * noble re-grant, Decoration load) do not override it. One atomic
 * multi-field write — active + marker can never disagree.
 */
export async function setManualEntryEffectChoice(uid: string, effectId: string): Promise<void> {
  if (!uid || !effectId) return;
  await update(ref(database, `users/${uid}`), {
    activeEntryEffect: effectId,
    entryEffectManualChoice: effectId,
  });
}

/** Clear the manual-choice marker (used when the chosen effect is gone). */
export async function clearManualEntryEffectChoice(uid: string): Promise<void> {
  if (!uid) return;
  try {
    await remove(ref(database, `users/${uid}/${MANUAL_ENTRY_EFFECT_FIELD}`));
  } catch { /* marker already gone — nothing to do */ }
}

/**
 * Set the highest-ranked held entry effect active when it is not
 * already. Returns the newly activated id, or null when no write
 * was needed. Never clears the active pointer when nothing is held.
 *
 * Manual-choice override (2026-11-11): a valid manual choice is
 * honoured instead of auto-use — if the active pointer drifted away
 * from it (e.g. a grant-time reconcile ran before the marker was
 * read), it is re-asserted here. When the manual choice is no longer
 * held/valid, the stale marker is cleared and auto-use picks the
 * highest remaining effect as the fallback.
 */
export async function reconcileActiveEntryEffect(
  uid: string,
  effects: EntryEffectGrantLike[],
  currentActiveId?: string | null,
  manualChoiceId?: string | null,
): Promise<string | null> {
  if (!uid) return null;
  const held = effects.filter((e) => isStillValid(e.validity));
  const manualValid = !!manualChoiceId && held.some((e) => e.id === manualChoiceId);
  if (manualChoiceId && !manualValid) {
    await clearManualEntryEffectChoice(uid);
  }
  const next = pickActiveEntryEffect(
    effects,
    currentActiveId,
    manualValid ? manualChoiceId : null,
  );
  if (!next) return null;
  try {
    await set(ref(database, `users/${uid}/activeEntryEffect`), next);
    return next;
  } catch {
    return null;
  }
}

/**
 * Read the user's held entry effects + stored active id from the DB
 * and reconcile. Safe to call on grant and on Decoration load.
 * Also reads the manual-choice marker so a grant-time reconcile
 * (incl. the noble re-grant of a higher effect) never overrides an
 * explicit "Use" choice.
 */
export async function reconcileActiveEntryEffectFromDb(uid: string): Promise<string | null> {
  if (!uid) return null;
  try {
    const [effectsSnap, activeSnap, manualSnap] = await Promise.all([
      get(ref(database, `users/${uid}/entryEffects`)),
      get(ref(database, `users/${uid}/activeEntryEffect`)),
      get(ref(database, `users/${uid}/${MANUAL_ENTRY_EFFECT_FIELD}`)),
    ]);
    const raw = effectsSnap.exists() ? effectsSnap.val() : null;
    const arr: unknown[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw as Record<string, unknown>)
        : [];
    const effects = arr.filter(
      (x): x is EntryEffectGrantLike =>
        !!x && typeof (x as EntryEffectGrantLike).id === 'string',
    );
    const activeVal = activeSnap.val();
    const activeId = typeof activeVal === 'string' ? activeVal : undefined;
    const manualVal = manualSnap.val();
    const manualId = typeof manualVal === 'string' ? manualVal : undefined;
    return await reconcileActiveEntryEffect(uid, effects, activeId, manualId);
  } catch {
    return null;
  }
}
