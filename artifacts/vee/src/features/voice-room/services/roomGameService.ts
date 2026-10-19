/**
 * roomGameService.ts — IMO voice-room games, ported to Vee (2026-10-19).
 *
 * IMO evidence: voiceroom/playgames/ (votegame, turntable, luckybag, bombgame,
 * auction, teampknew, grouppk, treasurebox, couple) + analytics vr_game,
 * vr_vote_game_*, vr_turntable_result. Behavior ported; Vee's own code.
 *
 * Game state lives in RTDB: rooms/{roomId}/games/{gameId} (host-authoritative).
 * RULES DEPENDENCY (must be deployed — see report): rooms/$roomId/games node:
 *   - create/delete: room owner or admin only
 *   - players/$uid, spinsUsed/$uid: the user themself
 *   - everything else: owner/admin
 *
 * Diamond movements NEVER bypass the wallet rules:
 *   - Vote: votes are gift diamonds (IMO-exact: "vote by gifting"), tallied
 *     from the existing rooms/{roomId}/giftEvents node. No payouts.
 *   - Turntable: prizes are CATALOG GIFTS auto-sent to the winner through the
 *     normal gift pipeline (VPS /wallet/send-gift → Firebase fallback), so
 *     debit/credit/commission stay server-authoritative. No minting.
 *   - Lucky bag: entrance fee (a gift-price amount) is paid by SENDING that
 *     gift to the host (normal gift flow — host receives 70%); the winner's
 *     jackpot is a gift the host sends back. Vee adaptation of IMO's jackpot
 *     (IMO: 100% to winner; Vee: via gift pipeline with standard commission).
 */

import {
  ref, set, update, remove, get, push,
  onValue, runTransaction,
} from 'firebase/database';
import { database } from '@/src/config/firebase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GameType = 'vote' | 'turntable' | 'luckybag';
export type GameStatus = 'lobby' | 'active' | 'ended';

export interface GameCandidate {
  uid: string;
  name: string;
  photoURL?: string | null;
}

export interface TurntableSegment {
  label: string;
  /** catalog gift id awarded on landing here; null = no prize (fun segment) */
  giftId: string | null;
  giftName?: string;
}

export interface LuckyBagPlayer {
  name: string;
  photoURL?: string | null;
  ts: number;
}

export interface SpinResult {
  uid: string;
  name: string;
  segmentIndex: number;
  ts: number;
}

export interface RoomGame {
  id: string;
  type: GameType;
  status: GameStatus;
  title: string;
  hostUid: string;
  hostName: string;
  createdAt: number;
  endsAt: number | null;
  /** vote: candidates (votes tallied live from giftEvents) */
  candidates?: GameCandidate[];
  winnerUid?: string | null;
  winnerName?: string | null;
  /** turntable */
  segments?: TurntableSegment[];
  maxSpinsPerUser?: number;
  spinsUsed?: Record<string, number>;
  lastResult?: SpinResult | null;
  /** luckybag */
  entranceFee?: number;
  players?: Record<string, LuckyBagPlayer>;
  jackpotGiftId?: string | null;
  jackpotGiftName?: string | null;
}

export type NewGameInput =
  | { type: 'vote'; title: string; candidates: GameCandidate[]; endsAt: number | null }
  | { type: 'turntable'; title: string; segments: TurntableSegment[]; maxSpinsPerUser: number }
  | { type: 'luckybag'; title: string; entranceFee: number; jackpotGiftId: string; jackpotGiftName: string };

// ─── CRUD ────────────────────────────────────────────────────────────────────

function gamesRef(roomId: string) {
  return ref(database, `rooms/${roomId}/games`);
}

/** Host creates a game (lobby → active immediately). Returns game id. */
export async function createGame(
  roomId: string,
  hostUid: string,
  hostName: string,
  input: NewGameInput,
): Promise<string> {
  const gameRef = push(gamesRef(roomId));
  const base = {
    id: gameRef.key!,
    status: 'active' as GameStatus,
    hostUid,
    hostName,
    createdAt: Date.now(),
  };
  let payload: Record<string, unknown>;
  if (input.type === 'vote') {
    payload = { ...base, type: 'vote', title: input.title, candidates: input.candidates, endsAt: input.endsAt ?? null, winnerUid: null };
  } else if (input.type === 'turntable') {
    payload = { ...base, type: 'turntable', title: input.title, segments: input.segments, maxSpinsPerUser: input.maxSpinsPerUser, spinsUsed: {}, lastResult: null, endsAt: null };
  } else {
    payload = { ...base, type: 'luckybag', title: input.title, entranceFee: input.entranceFee, players: {}, jackpotGiftId: input.jackpotGiftId, jackpotGiftName: input.jackpotGiftName, winnerUid: null, endsAt: null };
  }
  await set(gameRef, payload);
  return gameRef.key!;
}

/** Live list of a room's games (newest first). */
export function subscribeGames(roomId: string, cb: (games: RoomGame[]) => void): () => void {
  return onValue(gamesRef(roomId), (snap) => {
    const out: RoomGame[] = [];
    if (snap.exists()) {
      snap.forEach((c) => {
        out.push({ ...(c.val() as RoomGame), id: c.key! });
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

/** Live single game. */
export function subscribeGame(roomId: string, gameId: string, cb: (game: RoomGame | null) => void): () => void {
  return onValue(ref(database, `rooms/${roomId}/games/${gameId}`), (snap) => {
    cb(snap.exists() ? ({ ...(snap.val() as RoomGame), id: snap.key! }) : null);
  });
}

/** Host ends a game (optionally declaring a winner). */
export async function endGame(roomId: string, gameId: string, winnerUid: string | null = null, winnerName: string | null = null): Promise<void> {
  await update(ref(database, `rooms/${roomId}/games/${gameId}`), {
    status: 'ended',
    winnerUid,
    winnerName,
  });
}

/** Host deletes a game entirely. */
export async function deleteGame(roomId: string, gameId: string): Promise<void> {
  await remove(ref(database, `rooms/${roomId}/games/${gameId}`));
}

// ─── Turntable spins ─────────────────────────────────────────────────────────

/**
 * Atomically consume one spin for uid. Returns false when the user has no
 * spins left (maxSpinsPerUser reached).
 */
export async function consumeSpin(roomId: string, gameId: string, uid: string, maxSpins: number): Promise<boolean> {
  const spinRef = ref(database, `rooms/${roomId}/games/${gameId}/spinsUsed/${uid}`);
  const res = await runTransaction(spinRef, (cur) => {
    const used = typeof cur === 'number' ? cur : 0;
    if (used >= maxSpins) return; // abort
    return used + 1;
  });
  return res.committed;
}

/** Record the visible spin result (host or spinner writes; last writer wins). */
export async function recordSpinResult(roomId: string, gameId: string, result: SpinResult): Promise<void> {
  await set(ref(database, `rooms/${roomId}/games/${gameId}/lastResult`), result);
}

// ─── Lucky bag ───────────────────────────────────────────────────────────────

/** Player joins the lucky bag AFTER paying the entrance fee (via gift to host). */
export async function joinLuckyBag(
  roomId: string,
  gameId: string,
  uid: string,
  player: LuckyBagPlayer,
): Promise<void> {
  await set(ref(database, `rooms/${roomId}/games/${gameId}/players/${uid}`), { ...player, ts: Date.now() });
}

/** Draw a random winner from players (host only). Returns the winner uid or null. */
export async function drawLuckyWinner(roomId: string, gameId: string): Promise<{ uid: string; name: string } | null> {
  const snap = await get(ref(database, `rooms/${roomId}/games/${gameId}/players`));
  if (!snap.exists()) return null;
  const entries = Object.entries(snap.val() as Record<string, LuckyBagPlayer>);
  if (entries.length === 0) return null;
  const [uid, p] = entries[Math.floor(Math.random() * entries.length)];
  await update(ref(database, `rooms/${roomId}/games/${gameId}`), {
    status: 'ended',
    winnerUid: uid,
    winnerName: p.name,
  });
  return { uid, name: p.name };
}

// ─── Vote tally (from existing giftEvents — no gift-flow changes) ────────────

export interface VoteTally { uid: string; coins: number; giftCount: number }

/**
 * Tally vote-coins per candidate from rooms/{roomId}/giftEvents within the
 * game window. IMO-exact: votes ARE gift diamonds ("vote by gifting").
 */
export function subscribeVoteTally(
  roomId: string,
  game: RoomGame,
  cb: (tally: VoteTally[]) => void,
): () => void {
  const candidateUids = new Set((game.candidates ?? []).map((c) => c.uid));
  const from = game.createdAt;
  const to = game.endsAt ?? Date.now() + 10 * 365 * 86400_000;
  return onValue(ref(database, `rooms/${roomId}/giftEvents`), (snap) => {
    const map = new Map<string, VoteTally>();
    if (snap.exists()) {
      snap.forEach((c) => {
        const v = c.val() as { toUid?: string; coins?: number; ts?: number };
        if (
          typeof v.toUid === 'string' && candidateUids.has(v.toUid) &&
          typeof v.ts === 'number' && v.ts >= from && v.ts <= to
        ) {
          const cur = map.get(v.toUid) ?? { uid: v.toUid, coins: 0, giftCount: 0 };
          cur.coins += typeof v.coins === 'number' ? v.coins : 0;
          cur.giftCount += 1;
          map.set(v.toUid, cur);
        }
      });
    }
    cb(
      (game.candidates ?? []).map((c) => map.get(c.uid) ?? { uid: c.uid, coins: 0, giftCount: 0 }),
    );
  });
}
