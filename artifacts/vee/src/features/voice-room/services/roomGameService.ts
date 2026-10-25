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
 *   - Ludu (2026-10-25, boss order): FREE game, no diamonds, no stakes.
 *     Host picks 2-player or 4-player mode → lobby (slots fill by member
 *     self-join) → host starts when full → turn-based board, state synced
 *     in the game node. RULES DEPENDENCY (must be deployed — see the
 *     deploy report): the live games validate allowlist needs 'ludu', and
 *     the $gameId write needs a turn-gated branch so the current player
 *     (not just owner/admin) can advance the board: seated player AND
 *     old turnUid === writer AND new moveSeq === old moveSeq + 1.
 *     Join (players/$uid self-write), lobby Start/End (owner/admin) and
 *     room-chat system messages already pass the CURRENT live rules.
 */

import {
  ref, set, update, remove, get, push,
  onValue, runTransaction,
} from 'firebase/database';
import { database } from '@/src/config/firebase';
import { initialLuduState, nextTurnUid, type LuduState } from './ludoEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GameType = 'vote' | 'turntable' | 'luckybag' | 'ludu';
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
  /** ludu */
  luduMode?: 2 | 4;
  ludu?: LuduState | null;
}

export type NewGameInput =
  | { type: 'vote'; title: string; candidates: GameCandidate[]; endsAt: number | null }
  | { type: 'turntable'; title: string; segments: TurntableSegment[]; maxSpinsPerUser: number }
  | { type: 'luckybag'; title: string; entranceFee: number; jackpotGiftId: string; jackpotGiftName: string }
  | { type: 'ludu'; title: string; mode: 2 | 4; hostPhotoURL?: string | null };

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
  } else if (input.type === 'ludu') {
    // Lobby first: status 'lobby' until the host presses Start with full
    // slots. `ts` satisfies the live games validate (type/hostUid/status/ts).
    payload = {
      ...base, type: 'ludu', title: input.title, status: 'lobby' as GameStatus,
      ts: Date.now(), luduMode: input.mode, ludu: null, winnerUid: null, endsAt: null,
      players: { [hostUid]: { uid: hostUid, name: hostName, photoURL: input.hostPhotoURL ?? null, ts: Date.now() } },
    };
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

/**
 * Newest live Ludu lobby/active game hosted by uid in this room, or
 * null. 2026-10-25 (boss: no duplicate lobbies) — creating while the
 * host already has a live lobby reopens it instead of adding another
 * LIVE NOW row.
 */
export async function findMyLiveLuduGame(roomId: string, hostUid: string): Promise<string | null> {
  const snap = await get(gamesRef(roomId));
  if (!snap.exists()) return null;
  let bestId: string | null = null;
  let bestTs = -1;
  snap.forEach((c) => {
    const g = c.val() as RoomGame;
    if (g.type === 'ludu' && g.hostUid === hostUid && (g.status === 'lobby' || g.status === 'active')) {
      const ts = g.createdAt ?? 0;
      if (ts > bestTs) { bestTs = ts; bestId = c.key!; }
    }
  });
  return bestId;
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

// ─── Ludu ────────────────────────────────────────────────────────────────────

/**
 * Ludu turn moves run as RTDB transactions on the game node so two clients
 * can never apply conflicting moves: the write commits only when the
 * writer is still the turn player AND moveSeq still matches the state the
 * client computed from (stale clients abort and re-read via subscription).
 * The dice value is generated OUTSIDE the transaction (a retry must never
 * re-roll) and the transaction only validates + applies it.
 * NOTE: member writes to the game node need the turn-gated live-rules
 * branch (see the file header) — without it, only owner/admin writes land.
 */

function luduGameRef(roomId: string, gameId: string) {
  return ref(database, `rooms/${roomId}/games/${gameId}`);
}

/** Join a ludu lobby (self-write to players/$uid — allowed by live rules).
 *  NOTE: the value MUST carry uid: the live players/$uid validate requires
 *  newData.uid === auth.uid. (Lucky bag's join omits uid and therefore
 *  fails that validate — flagged to the parent, not changed here.) */
export interface LuduPlayer {
  uid: string;
  name: string;
  photoURL?: string | null;
  ts: number;
}

export async function joinLuduGame(
  roomId: string,
  gameId: string,
  uid: string,
  player: LuduPlayer,
): Promise<void> {
  await set(ref(database, `rooms/${roomId}/games/${gameId}/players/${uid}`), { ...player, ts: Date.now() });
}

/** Host starts a full lobby: snapshots seats, inits the board, status active. */
export async function startLuduGame(
  roomId: string,
  gameId: string,
  mode: 2 | 4,
  seats: string[],
): Promise<void> {
  await update(luduGameRef(roomId, gameId), {
    status: 'active',
    ludu: initialLuduState(mode, seats),
  });
}

async function luduTx(
  roomId: string,
  gameId: string,
  uid: string,
  expectedSeq: number,
  check: (cur: any) => boolean,
  apply: (cur: any) => void,
): Promise<boolean> {
  const res = await runTransaction(luduGameRef(roomId, gameId), (cur: any) => {
    if (!cur || typeof cur !== 'object' || cur.type !== 'ludu' || cur.status !== 'active') return;
    const ludu = cur.ludu;
    if (!ludu || typeof ludu !== 'object') return;
    if (ludu.turnUid !== uid || ludu.moveSeq !== expectedSeq || ludu.winnerUid) return;
    if (!check(cur)) return;
    apply(cur);
    return cur;
  });
  return res.committed;
}

function luduLog(cur: any, entry: string): void {
  const prev = Array.isArray(cur.ludu.log) ? cur.ludu.log : [];
  cur.ludu.log = [...prev, entry].slice(-8);
}

/** Current player records a pre-rolled dice value (1..6). */
export async function rollLuduDice(
  roomId: string,
  gameId: string,
  uid: string,
  expectedSeq: number,
  dice: number,
  logEntry: string,
): Promise<boolean> {
  if (dice < 1 || dice > 6) return false;
  return luduTx(
    roomId, gameId, uid, expectedSeq,
    (cur) => !cur.ludu.diceRolled,
    (cur) => {
      cur.ludu.dice = dice;
      cur.ludu.diceRolled = true;
      cur.ludu.moveSeq += 1;
      luduLog(cur, logEntry);
    },
  );
}

export interface LuduMoveApply {
  positions: import('./ludoEngine').LuduPositions;
  extraTurn: boolean;
  finished: boolean;
  winnerName: string | null;
  logEntry: string;
}

/** Current player applies a pre-computed move (positions from ludoEngine). */
export async function moveLuduToken(
  roomId: string,
  gameId: string,
  uid: string,
  expectedSeq: number,
  expectedDice: number,
  move: LuduMoveApply,
): Promise<boolean> {
  return luduTx(
    roomId, gameId, uid, expectedSeq,
    (cur) => cur.ludu.diceRolled === true && cur.ludu.dice === expectedDice,
    (cur) => {
      cur.ludu.positions = move.positions;
      cur.ludu.dice = null;
      cur.ludu.diceRolled = false;
      cur.ludu.moveSeq += 1;
      luduLog(cur, move.logEntry);
      if (move.finished) {
        cur.status = 'ended';
        cur.winnerUid = uid;
        cur.winnerName = move.winnerName;
        cur.ludu.winnerUid = uid;
        cur.ludu.turnUid = null;
      } else if (move.extraTurn) {
        cur.ludu.turnUid = uid;
      } else {
        cur.ludu.turnUid = nextTurnUid(cur.ludu, uid);
      }
    },
  );
}

/** Current player passes (rolled but no token can move). */
export async function passLuduTurn(
  roomId: string,
  gameId: string,
  uid: string,
  expectedSeq: number,
  logEntry: string,
): Promise<boolean> {
  return luduTx(
    roomId, gameId, uid, expectedSeq,
    (cur) => cur.ludu.diceRolled === true,
    (cur) => {
      cur.ludu.turnUid = nextTurnUid(cur.ludu, uid);
      cur.ludu.dice = null;
      cur.ludu.diceRolled = false;
      cur.ludu.moveSeq += 1;
      luduLog(cur, logEntry);
    },
  );
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
