/**
 * Delicious service — real-diamond food betting wheel for Vee voice rooms
 * (2026-10-25, boss order: real game, Regular only, all English).
 *
 * GLOBAL GAME (boss correction 2026-10-25 21:20, SUPERSEDES the
 * per-room design): ONE single game instance for the whole app, at the
 * root RTDB node `delicious` — NOT rooms/{roomId}/delicious. Every user
 * in every room sees the same round number, countdown, and result. The
 * bot loop runs CONTINUOUSLY (30s betting + 3s count + 5s result, back
 * to back) regardless of viewers, so opening the sheet joins the current
 * global round. The sheet still opens over the user's current room
 * (backdrop only); roomId plays no part in game state.
 *
 * RULES (confirmed, see ~/workspace/delicious-app/ANALYSIS.md):
 *   • Bet order: AMOUNT FIRST, then target (food tile or side icon).
 *   • Chips: 5 / 50 / 100 / 1000 diamonds (boss's screenshot values).
 *   • Round cycle (bot-driven): 30s betting → 3s "The result is coming"
 *     count → 5s centred result pop-up → next round automatically.
 *   • Payout = Σ over winning bets of (bet × shown multiplier).
 *     Food multipliers are integers; side payouts are floored to whole
 *     diamonds (side multipliers are fractional: salad 1.25×, pizza 4.37×).
 *   • Side result is an INDEPENDENT server-side weighted draw
 *     (Salad 0.75 / Pizza 0.25) — WORKING ASSUMPTION, flagged for the boss
 *     to correct (if sides are instead tied to the winning food's group,
 *     the bot draw changes; this client does not change).
 *   • "Today's prize" = the viewing player's TOTAL WINNINGS TODAY in this
 *     game (boss-confirmed 2026-10-25), a real per-day accumulator.
 *
 * SAFETY (non-negotiable):
 *   • The client NEVER decides a winner and NEVER touches a wallet.
 *     It writes ONLY its own bet intents (status "pending").
 *     The VeeDelicious bot validates intents, debits the real wallet,
 *     draws food + side server-side, credits payouts, and writes results.
 *     There is no presence: the global loop runs continuously, so no
 *     heartbeat is needed or sent.
 *   • Bet intents are create-only: live rules deny any client edit of an
 *     existing bet (byte-unchanged branch covers identical offline
 *     retries). No bet change / cancel exists.
 *   • No demo anything: no demo balance, no placeholder winners, no
 *     client-side draw. If the bot is down, rounds simply do not advance
 *     and no money moves — the sheet shows the last known state.
 */
import {
  get,
  onValue,
  push,
  ref,
  set,
} from 'firebase/database';
import { database } from '@/src/config/firebase';

export type DeliciousFoodId =
  | 'tomato'
  | 'hotdog'
  | 'skewers'
  | 'cabbage'
  | 'ham'
  | 'corn'
  | 'carrot'
  | 'steak';

export type DeliciousSideId = 'salad' | 'pizza';

export type DeliciousPhase = 'betting' | 'settling' | 'count' | 'result';

export interface DeliciousFood {
  id: DeliciousFoodId;
  name: string;
  multiplier: number;
  image: any;
}

export const DELICIOUS_FOODS: DeliciousFood[] = [
  { id: 'tomato', name: 'Tomato', multiplier: 5, image: require('../../../../assets/images/delicious/tomato.png') },
  { id: 'hotdog', name: 'Hotdog', multiplier: 10, image: require('../../../../assets/images/delicious/hotdog.png') },
  { id: 'skewers', name: 'Skewers', multiplier: 15, image: require('../../../../assets/images/delicious/skewers.png') },
  { id: 'cabbage', name: 'Cabbage', multiplier: 5, image: require('../../../../assets/images/delicious/cabbage.png') },
  { id: 'ham', name: 'Ham', multiplier: 25, image: require('../../../../assets/images/delicious/ham.png') },
  { id: 'corn', name: 'Corn', multiplier: 5, image: require('../../../../assets/images/delicious/corn.png') },
  { id: 'carrot', name: 'Carrot', multiplier: 5, image: require('../../../../assets/images/delicious/carrot.png') },
  { id: 'steak', name: 'Steak', multiplier: 45, image: require('../../../../assets/images/delicious/steak.png') },
];

export interface DeliciousSide {
  id: DeliciousSideId;
  name: string;
  multiplier: number;
  image: any;
}

// Side odds observed on Bigo (same engine). imo never shows side odds on
// screen — the app shows them anyway so real-money bets have visible
// payout terms (flagged deviation, see ANALYSIS.md §5.2).
export const DELICIOUS_SIDES: DeliciousSide[] = [
  { id: 'salad', name: 'Salad', multiplier: 1.25, image: require('../../../../assets/images/delicious/salad.png') },
  { id: 'pizza', name: 'Pizza', multiplier: 4.37, image: require('../../../../assets/images/delicious/pizza.png') },
];

export const DELICIOUS_CHIPS = [5, 50, 100, 1000];

export const DELICIOUS_FOOD_MAP: Record<DeliciousFoodId, DeliciousFood> =
  Object.fromEntries(DELICIOUS_FOODS.map((f) => [f.id, f])) as Record<DeliciousFoodId, DeliciousFood>;

export const DELICIOUS_SIDE_MAP: Record<DeliciousSideId, DeliciousSide> =
  Object.fromEntries(DELICIOUS_SIDES.map((s) => [s.id, s])) as Record<DeliciousSideId, DeliciousSide>;

export interface DeliciousRound {
  n: number;
  phase: DeliciousPhase;
  endsAt: number;
  winningFood: DeliciousFoodId | null;
  winningSide: DeliciousSideId | null;
  settled: boolean;
}

export interface DeliciousBet {
  kind: 'food' | 'side';
  food?: DeliciousFoodId;
  side?: DeliciousSideId;
  amount: number;
  status: 'pending' | 'confirmed' | 'rejected';
  reason?: string;
  createdAt: number;
}

export interface DeliciousBiggestWinner {
  uid: string;
  name: string;
  amount: number;
}

export interface DeliciousResult {
  winningFood: DeliciousFoodId;
  winningSide: DeliciousSideId;
  biggest: DeliciousBiggestWinner[];
  settledAt: number;
  day: string;
}

// Server-driven rules (POLISH 2026-10-25): delicious/config holds the
// live rules. All fields optional; a missing node/field falls back to
// today's values, NEVER a crash. Clients only READ config (live rules
// deny client writes); the boss/admin edits it directly in RTDB.
export interface DeliciousConfigRaw {
  bettingSeconds?: number;
  countSeconds?: number;
  resultSeconds?: number;
  chips?: number[];
  foods?: Record<string, number>;
  sides?: Record<string, { multiplier?: number; weight?: number }>;
}

export interface DeliciousConfig {
  bettingSeconds: number;
  countSeconds: number;
  resultSeconds: number;
  chips: number[];
  foods: Record<DeliciousFoodId, number>;
  sides: Record<DeliciousSideId, { multiplier: number; weight: number }>;
}

export const DELICIOUS_DEFAULT_CONFIG: DeliciousConfig = {
  bettingSeconds: 30,
  countSeconds: 3,
  resultSeconds: 5,
  chips: [5, 50, 100, 1000],
  foods: { tomato: 5, hotdog: 10, skewers: 15, cabbage: 5, ham: 25, corn: 5, carrot: 5, steak: 45 },
  sides: { salad: { multiplier: 1.25, weight: 0.75 }, pizza: { multiplier: 4.37, weight: 0.25 } },
};

export function mergeDeliciousConfig(raw: DeliciousConfigRaw | null): DeliciousConfig {
  const c = raw && typeof raw === 'object' ? raw : {};
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d;
  const chips = Array.isArray(c.chips) && c.chips.length > 0 &&
    c.chips.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)
    ? [...c.chips] : [...DELICIOUS_DEFAULT_CONFIG.chips];
  const foods = {} as Record<DeliciousFoodId, number>;
  (Object.keys(DELICIOUS_DEFAULT_CONFIG.foods) as DeliciousFoodId[]).forEach((id) => {
    foods[id] = num(c.foods && c.foods[id], DELICIOUS_DEFAULT_CONFIG.foods[id]);
  });
  const sides = {} as DeliciousConfig['sides'];
  (Object.keys(DELICIOUS_DEFAULT_CONFIG.sides) as DeliciousSideId[]).forEach((id) => {
    const r = c.sides && c.sides[id];
    sides[id] = {
      multiplier: num(r && r.multiplier, DELICIOUS_DEFAULT_CONFIG.sides[id].multiplier),
      weight: num(r && r.weight, DELICIOUS_DEFAULT_CONFIG.sides[id].weight),
    };
  });
  return {
    bettingSeconds: num(c.bettingSeconds, DELICIOUS_DEFAULT_CONFIG.bettingSeconds),
    countSeconds: num(c.countSeconds, DELICIOUS_DEFAULT_CONFIG.countSeconds),
    resultSeconds: num(c.resultSeconds, DELICIOUS_DEFAULT_CONFIG.resultSeconds),
    chips, foods, sides,
  };
}

/** Dhaka calendar date YYYY-MM-DD (client safety net for day filtering). */
export function deliciousToday(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

// Global node — one game for the whole app (boss correction 2026-10-25).
function base() {
  return 'delicious';
}

/** Live round state (bot-written). Null until the bot starts a round. */
export function subscribeDeliciousRound(
  cb: (round: DeliciousRound | null) => void,
): () => void {
  return onValue(ref(database, `${base()}/round`), (snap) => {
    cb(snap.exists() ? (snap.val() as DeliciousRound) : null);
  });
}

/** All settled results for the room (client takes the last 10 by round). */
export function subscribeDeliciousResults(
  cb: (results: Record<string, DeliciousResult>) => void,
): () => void {
  return onValue(ref(database, `${base()}/results`), (snap) => {
    cb(snap.exists() ? (snap.val() as Record<string, DeliciousResult>) : {});
  });
}

/** The viewer's own bets for one round (all betIds under their uid). */
export function subscribeMyDeliciousBets(
  roundN: number,
  uid: string,
  cb: (bets: Record<string, DeliciousBet>) => void,
): () => void {
  return onValue(ref(database, `${base()}/bets/${roundN}/${uid}`), (snap) => {
    cb(snap.exists() ? (snap.val() as Record<string, DeliciousBet>) : {});
  });
}

/** The viewer's credited payout for one round (bot-written, winners only). */
export function subscribeMyDeliciousPayout(
  roundN: number,
  uid: string,
  cb: (amount: number | null) => void,
): () => void {
  return onValue(ref(database, `${base()}/payouts/${roundN}/${uid}`), (snap) => {
    cb(snap.exists() ? (snap.val() as number) : null);
  });
}

/** The viewer's Today's prize accumulator (total winnings today). */
export function subscribeMyTodayPrize(
  uid: string,
  cb: (entry: { total: number; day: string } | null) => void,
): () => void {
  return onValue(ref(database, `${base()}/todayPrize/${uid}`), (snap) => {
    cb(snap.exists() ? (snap.val() as { total: number; day: string }) : null);
  });
}

/** Live game rules (server-written config; null until published). */
export function subscribeDeliciousConfig(
  cb: (raw: DeliciousConfigRaw | null) => void,
): () => void {
  return onValue(ref(database, `${base()}/config`), (snap) => {
    cb(snap.exists() ? (snap.val() as DeliciousConfigRaw) : null);
  });
}

/** One-time read of the viewer's credited payout for one round (history view). */
export async function getMyDeliciousPayoutOnce(
  roundN: number,
  uid: string,
): Promise<number | null> {
  const snap = await get(ref(database, `${base()}/payouts/${roundN}/${uid}`));
  return snap.exists() ? (snap.val() as number) : null;
}

/**
 * Place ONE bet intent. Caller must already enforce: betting phase open,
 * amount is a valid chip, balance covers the amount. The intent is only a
 * request — the bot validates, debits, and flips it to "confirmed" (or
 * "rejected"). Throws on RTDB errors (e.g. rules denial) so the UI can
 * show an honest error instead of a fake confirmation.
 */
export async function placeDeliciousBet(
  roundN: number,
  uid: string,
  kind: 'food' | 'side',
  target: DeliciousFoodId | DeliciousSideId,
  amount: number,
): Promise<void> {
  const betsRef = ref(database, `${base()}/bets/${roundN}/${uid}`);
  const betRef = push(betsRef);
  const bet: DeliciousBet =
    kind === 'food'
      ? { kind, food: target as DeliciousFoodId, amount, status: 'pending', createdAt: Date.now() }
      : { kind, side: target as DeliciousSideId, amount, status: 'pending', createdAt: Date.now() };
  await set(betRef, bet);
}
