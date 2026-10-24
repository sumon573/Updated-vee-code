/**
 * roomPkService.ts — 1v1 PK (2026-10-25, boss concept).
 *
 * Two room users battle head-to-head; the audience sends diamonds (gifts)
 * and the diamond value is the score — higher score wins when the timer
 * ends. Scoring is authoritative: a VPS scorer (C:\vee-pk-bot\pk.cjs,
 * task VeePk) watches the room's giftFeed and totals `coins` per battler
 * inside the PK window (idempotent per gift key, so restarts never
 * double-count). Clients never write scores (live rules deny it).
 *
 * RTDB — roomPk/{roomId}:
 *   status: 'challenge' | 'active' | 'ended'
 *   challenger / opponent: { uid, name }
 *   createdAt, challengedAt, startedAt?, endsAt?
 *   scores: { totals: { uid: number }, scored: { giftKey: true } } (bot-only)
 *   winnerUid?: string | null, draw?: boolean (bot-only)
 * One PK per room at a time (rules: create only when no node exists).
 * Challenge expires after 60s, ended nodes are cleaned up by the scorer.
 */

import { ref, update, remove, onValue, get } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';

export const PK_DURATION_MS = 5 * 60 * 1000;
/** Host-pickable battle lengths (minutes) — the host sets it at start. */
export const PK_DURATION_OPTIONS_MIN = [3, 5, 10];
export const PK_DURATION_MIN_MS = 60 * 1000;
export const PK_DURATION_MAX_MS = 10 * 60 * 1000;
export const PK_CHALLENGE_TIMEOUT_MS = 60 * 1000;

export interface PkUser {
  uid: string;
  name: string;
}

export interface PkScores {
  totals: Record<string, number>;
}

export interface RoomPk {
  status: 'challenge' | 'active' | 'ended';
  challenger: PkUser;
  opponent: PkUser;
  createdAt: number;
  challengedAt: number;
  startedAt: number;
  endsAt: number;
  /** Host-chosen battle length (ms); 0 = legacy node (treated as 5 min). */
  durationMs: number;
  scores: PkScores | null;
  winnerUid: string | null;
  draw: boolean;
}

function pkRef(roomId: string) {
  return ref(database, `roomPk/${roomId}`);
}

/** Live PK state for a room (null when no PK). */
export function subscribeRoomPk(roomId: string, cb: (pk: RoomPk | null) => void): () => void {
  return onValue(pkRef(roomId), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    const v = snap.val() as any;
    if (!v || typeof v.status !== 'string' || !v.challenger || !v.opponent) {
      cb(null);
      return;
    }
    cb({
      status: v.status,
      challenger: v.challenger,
      opponent: v.opponent,
      createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
      challengedAt: typeof v.challengedAt === 'number' ? v.challengedAt : 0,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0,
      endsAt: typeof v.endsAt === 'number' ? v.endsAt : 0,
      durationMs: typeof v.durationMs === 'number' ? v.durationMs : 0,
      scores: (v.scores as PkScores) || null,
      winnerUid: typeof v.winnerUid === 'string' ? v.winnerUid : null,
      draw: v.draw === true,
    });
  });
}

/** Send a PK challenge (fails if a PK already exists — rules backstop).
 * durationMs is the host-chosen battle length (clamped 1–10 min). */
export async function challengeToPk(
  roomId: string,
  challenger: PkUser,
  opponent: PkUser,
  durationMs: number,
): Promise<void> {
  const now = Date.now();
  const dur = Math.min(PK_DURATION_MAX_MS, Math.max(PK_DURATION_MIN_MS, durationMs || PK_DURATION_MS));
  await update(pkRef(roomId), {
    status: 'challenge',
    challenger,
    opponent,
    createdAt: now,
    challengedAt: now,
    durationMs: dur,
  });
}

/** Opponent accepts: the battle starts for the host-chosen duration. */
export async function acceptPk(roomId: string): Promise<void> {
  const now = Date.now();
  const snap = await get(pkRef(roomId));
  const stored = snap.val()?.durationMs as number | undefined;
  const dur = Math.min(
    PK_DURATION_MAX_MS,
    Math.max(PK_DURATION_MIN_MS, typeof stored === 'number' && stored > 0 ? stored : PK_DURATION_MS),
  );
  await update(pkRef(roomId), {
    status: 'active',
    startedAt: now,
    endsAt: now + dur,
  });
}

/** Decline a challenge / cancel your own / owner-admin clear. */
export async function removePk(roomId: string): Promise<void> {
  await remove(pkRef(roomId));
}

/** Current signed-in user as a PK participant. */
export function myPkUser(myUid: string, myName: string): PkUser {
  return { uid: myUid, name: myName };
}

export function pkScoreOf(pk: RoomPk | null, uid: string): number {
  return pk?.scores?.totals?.[uid] ?? 0;
}

/** Compact diamond count, matching the gift cards (1.2k / 1.5k). */
export function formatPkScore(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Battle length label, e.g. 5 min (legacy nodes read as 5 min). */
export function formatPkDuration(pk: RoomPk | null): string {
  const ms = pk && pk.durationMs > 0 ? pk.durationMs : PK_DURATION_MS;
  return `${Math.round(ms / 60000)} min`;
}

export function currentUid(): string {
  return auth.currentUser?.uid ?? 'anonymous';
}
