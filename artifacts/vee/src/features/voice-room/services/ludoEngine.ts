/**
 * ludoEngine.ts — pure Ludu (Ludo) rules for Vee voice rooms (2026-10-25).
 *
 * Standard casual Ludo, no diamonds, no stakes. Board model (progress per
 * token, shared by every client so all players see the same board):
 *   -1 = in base, 0..51 = on the 52-cell track, 52..56 = home column,
 *   57 = finished (center).
 * Track index for progress p (0..51) = (startOffset[color] + p) % 52.
 * Start offsets: red 0, green 13, yellow 26, blue 39 (13 apart).
 * Safe squares (cannot be captured): the 4 starts + 4 stars
 *   = track indices [0, 8, 13, 21, 26, 34, 39, 47].
 *
 * Decided casual rules (boss spec 2026-10-25 covers only 2P/4P modes;
 * everything below is the common casual rule, noted here):
 * - Roll 6 to leave base. Exact roll required to finish (overshoot = no move).
 * - Extra turn on: rolling 6, capturing an opponent token, or bringing a
 *   token home (progress 57). Otherwise the turn passes.
 * - Capture: landing on a non-safe track cell sends every opponent token
 *   there back to base — UNLESS that cell holds 2+ tokens of one color
 *   (a stack/blockade is safe and cannot be captured).
 * - Own tokens may share a cell (stacking allowed, no blockade movement
 *   restriction — stacked tokens move independently).
 * - Win: first player with all 4 tokens at 57. Game ends immediately.
 * - 2-player mode seats: red vs yellow (opposites). 4-player: red, green,
 *   yellow, blue in seat order. Seat 0 is always the host.
 * - No move possible after a roll: the turn passes automatically.
 */

export type LuduColor = 'red' | 'green' | 'yellow' | 'blue';

export const LUDU_COLORS: Record<LuduColor, string> = {
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#EAB308',
  blue: '#3B82F6',
};

export const LUDU_COLOR_ORDER_4: LuduColor[] = ['red', 'green', 'yellow', 'blue'];
export const LUDU_COLOR_ORDER_2: LuduColor[] = ['red', 'yellow'];

const START_OFFSET: Record<LuduColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

export const SAFE_TRACK: number[] = [0, 8, 13, 21, 26, 34, 39, 47];

/** 52 track cells in travel order, (row, col) on the 15x15 board. */
export const TRACK_CELLS: ReadonlyArray<readonly [number, number]> = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];

/** Home-column cells (progress 52..56) per color, moving toward the center. */
export const HOME_CELLS: Record<LuduColor, ReadonlyArray<readonly [number, number]>> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

/** Base spots (progress -1): 4 token homes inside each 6x6 base corner. */
export const BASE_SPOTS: Record<LuduColor, ReadonlyArray<readonly [number, number]>> = {
  red: [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],
  green: [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],
  yellow: [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],
  blue: [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],
};

/** Token progress values: -1 base, 0..51 track, 52..56 home column, 57 finished. */
export type LuduPositions = Record<string, [number, number, number, number]>;

export interface LuduState {
  mode: 2 | 4;
  /** seat order (uids), seat 0 = host, fixed when the lobby starts. */
  seats: string[];
  colors: LuduColor[];
  positions: LuduPositions;
  turnUid: string | null;
  dice: number | null;
  diceRolled: boolean;
  moveSeq: number;
  winnerUid: string | null;
  log: string[];
}

export function initialLuduPositions(seats: string[]): LuduPositions {
  const out: LuduPositions = {};
  for (const uid of seats) out[uid] = [-1, -1, -1, -1];
  return out;
}

export function initialLuduState(mode: 2 | 4, seats: string[]): LuduState {
  return {
    mode,
    seats: [...seats],
    colors: (mode === 2 ? LUDU_COLOR_ORDER_2 : LUDU_COLOR_ORDER_4).slice(0, seats.length),
    positions: initialLuduPositions(seats),
    turnUid: seats[0] ?? null,
    dice: null,
    diceRolled: false,
    moveSeq: 0,
    winnerUid: null,
    log: [],
  };
}

export function colorOf(state: LuduState, uid: string): LuduColor {
  const idx = state.seats.indexOf(uid);
  return state.colors[idx >= 0 ? idx : 0];
}

function trackIndexOf(color: LuduColor, progress: number): number {
  return (START_OFFSET[color] + progress) % 52;
}

/** Board cell (row, col, fractional for base spots) for one token. */
export function cellOf(state: LuduState, uid: string, tokenIdx: number): readonly [number, number] {
  const color = colorOf(state, uid);
  const p = state.positions[uid]?.[tokenIdx] ?? -1;
  if (p === -1) return BASE_SPOTS[color][tokenIdx];
  if (p <= 51) return TRACK_CELLS[trackIndexOf(color, p)];
  if (p <= 56) return HOME_CELLS[color][p - 52];
  return [7, 7]; // finished — center
}

/** Can this token move with this dice value? */
export function canMoveToken(state: LuduState, uid: string, tokenIdx: number, dice: number): boolean {
  const p = state.positions[uid]?.[tokenIdx];
  if (p === undefined || p === 57) return false;
  if (p === -1) return dice === 6;
  return p + dice <= 57;
}

/** All movable token indices for a player with this dice value. */
export function movableTokens(state: LuduState, uid: string, dice: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (canMoveToken(state, uid, i, dice)) out.push(i);
  }
  return out;
}

export interface MoveResult {
  positions: LuduPositions;
  captured: Array<{ uid: string; tokenIdx: number }>;
  finished: boolean;
  extraTurn: boolean;
}

/**
 * Pure move computation: apply `dice` to `uid`'s token `tokenIdx`.
 * Returns null when the move is illegal (caller must validate turn + dice).
 */
export function applyMove(state: LuduState, uid: string, tokenIdx: number, dice: number): MoveResult | null {
  if (!canMoveToken(state, uid, tokenIdx, dice)) return null;
  const color = colorOf(state, uid);
  const positions: LuduPositions = {};
  for (const [k, v] of Object.entries(state.positions)) positions[k] = [...v] as [number, number, number, number];
  const from = positions[uid][tokenIdx];
  const to = from === -1 ? 0 : from + dice;
  positions[uid][tokenIdx] = to;

  const captured: Array<{ uid: string; tokenIdx: number }> = [];
  let extraTurn = dice === 6 || to === 57;
  if (to >= 0 && to <= 51) {
    const track = trackIndexOf(color, to);
    if (!SAFE_TRACK.includes(track)) {
      // Opponent stacks of 2+ on this cell are safe (blockade); single
      // tokens (and only single tokens) get captured.
      const occupants = new Map<string, number[]>();
      for (const [otherUid, toks] of Object.entries(positions)) {
        if (otherUid === uid) continue;
        const otherColor = colorOf(state, otherUid);
        toks.forEach((p, i) => {
          if (p >= 0 && p <= 51 && trackIndexOf(otherColor, p) === track) {
            const list = occupants.get(otherUid) ?? [];
            list.push(i);
            occupants.set(otherUid, list);
          }
        });
      }
      for (const [otherUid, idxs] of occupants) {
        if (idxs.length === 1) {
          positions[otherUid][idxs[0]] = -1;
          captured.push({ uid: otherUid, tokenIdx: idxs[0] });
        }
      }
      if (captured.length > 0) extraTurn = true;
    }
  }

  const finished = positions[uid].every((p) => p === 57);
  return { positions, captured, finished, extraTurn };
}

/** Next seat uid after `uid` in seat order (wraps). */
export function nextTurnUid(state: LuduState, uid: string): string | null {
  const idx = state.seats.indexOf(uid);
  if (idx < 0 || state.seats.length === 0) return null;
  return state.seats[(idx + 1) % state.seats.length];
}

export function appendLog(log: string[], entry: string, max = 8): string[] {
  return [...log, entry].slice(-max);
}
