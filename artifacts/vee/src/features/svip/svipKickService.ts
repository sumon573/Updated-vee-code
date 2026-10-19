/**
 * svipKickService — SVIP kick-out privilege (IMO model, 2026-10-19).
 *
 * IMO evidence (decompiled APK):
 * - SvipKickConfig: cost_svip_point / own_svip_point — kicking SPENDS points.
 * - "Insufficient SVIP points" / "Your SVIP Point:" — balance-gated.
 * - is_anti_kick — "Cannot block the user due to SVIP anti-kick privilege".
 * - is_level_less_than — "Unable to remove users of a higher SVIP level".
 *
 * Vee rules:
 * - Only SVIP tier 3+ (kickOut privilege) can kick.
 * - Each kick costs SVIP_KICK_COST_POINTS points (transaction-safe deduct).
 * - Cannot kick a user whose SVIP tier is HIGHER than the kicker's.
 * - Cannot kick a user with anti-kick unless the kicker outranks them.
 * - Kick = remove from seat + audience (temporary removal, NOT a
 *   permanent block — matches IMO's kick semantics).
 */
import { getErrorCause } from '@/src/utils/errorDisplay';
import { hasSvipPrivilege, isSvipActive, SvipState } from '@/src/features/svip/svipService';
import { spendSvipPoints } from '@/src/features/svip/svipPointsService';

/** Points charged per kick-out (server-driven later via svipConfig). */
export const SVIP_KICK_COST_POINTS = 50;

export type SvipKickResult =
  | { ok: true }
  | { ok: false; code: 'NO_PRIVILEGE' | 'INSUFFICIENT_POINTS' | 'HIGHER_TIER' | 'ANTI_KICK' | 'ERROR'; message: string };

async function getSvipState(uid: string): Promise<SvipState | null> {
  const { ref, get } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');
  try {
    const snap = await get(ref(database, `svip/${uid}`));
    const v = snap.val();
    if (!v || typeof v.tier !== 'number') return null;
    return {
      tier: v.tier || 0,
      expiry: typeof v.expiry === 'number' ? v.expiry : 0,
      points: typeof v.points === 'number' ? v.points : 0,
      updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Active SVIP tier number, or 0 when not an active member. */
export async function getActiveSvipTier(uid: string): Promise<number> {
  const s = await getSvipState(uid);
  return isSvipActive(s) ? s!.tier : 0;
}

/**
 * Whether `blockerUid`'s block/kick attempt on `targetUid` is stopped by
 * the target's anti-kick privilege (IMO: "Cannot block the user due to
 * SVIP anti-kick privilege"). Higher-tier blockers overrule anti-kick.
 */
export async function isAntiKickProtected(
  blockerUid: string,
  targetUid: string,
): Promise<boolean> {
  if (!targetUid || blockerUid === targetUid) return false;
  const [blockerTier, target] = await Promise.all([
    getActiveSvipTier(blockerUid),
    getSvipState(targetUid),
  ]);
  if (!hasSvipPrivilege(target, 'antiKick')) return false;
  // A strictly higher tier overrules anti-kick (IMO level hierarchy).
  return !(blockerTier > target!.tier);
}

/**
 * SVIP kick-out: spends points, enforces hierarchy + anti-kick, then
 * removes the target from seat and audience.
 */
export async function svipKickUser(
  roomId: string,
  kickerUid: string,
  targetUid: string,
  targetSeatIdx: number, // -1 when in audience
): Promise<SvipKickResult> {
  if (!roomId || !kickerUid || !targetUid || kickerUid === targetUid) {
    return { ok: false, code: 'ERROR', message: 'Invalid kick request.' };
  }
  try {
    const [kicker, target] = await Promise.all([
      getSvipState(kickerUid),
      getSvipState(targetUid),
    ]);
    if (!hasSvipPrivilege(kicker, 'kickOut')) {
      return { ok: false, code: 'NO_PRIVILEGE', message: 'Kick-out requires SVIP 3.' };
    }
    const kickerTier = kicker!.tier;
    const targetTier = isSvipActive(target) ? target!.tier : 0;

    // IMO: "Unable to remove users of a higher SVIP level"
    if (targetTier > kickerTier) {
      return { ok: false, code: 'HIGHER_TIER', message: 'Unable to remove users of a higher SVIP level.' };
    }
    // IMO: "Cannot block the user due to SVIP anti-kick privilege"
    if (hasSvipPrivilege(target, 'antiKick') && !(kickerTier > targetTier)) {
      return { ok: false, code: 'ANTI_KICK', message: 'Cannot remove this user due to SVIP anti-kick privilege.' };
    }
    // Spend points (transaction-safe; IMO: "Insufficient SVIP points").
    try {
      await spendSvipPoints(kickerUid, SVIP_KICK_COST_POINTS, `kick ${targetUid.slice(0, 8)}`);
    } catch (e) {
      if (e instanceof Error && e.message === 'INSUFFICIENT_POINTS') {
        return { ok: false, code: 'INSUFFICIENT_POINTS', message: 'Insufficient SVIP points.' };
      }
      throw e;
    }
    // Perform the removal.
    const { removeSeat, removeAudienceMember } = await import(
      '@/src/features/voice-room/services/firebaseRoomService'
    );
    if (targetSeatIdx >= 0) {
      await removeSeat(roomId, targetSeatIdx);
    }
    await removeAudienceMember(roomId, targetUid);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: 'ERROR', message: getErrorCause(e) };
  }
}
