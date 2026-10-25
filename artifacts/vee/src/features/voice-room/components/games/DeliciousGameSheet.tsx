/**
 * DeliciousGameSheet — the REAL Delicious food betting wheel, as a sheet
 * over the voice room (2026-10-25, boss order).
 *
 * GLOBAL GAME (boss correction 2026-10-25 21:20): ONE game for the
 * whole app at root node `delicious` — every user in every room sees
 * the same round, countdown, and result. The bot loop runs continuously
 * regardless of viewers; opening the sheet joins the current round.
 * The sheet still opens over the user's room (backdrop only).
 *
 * Layout mirrors the boss's imo screenshot: the room stays faintly
 * visible behind a full-screen dim, and the dark-red panel is anchored
 * at the bottom (NOT a full page). Centre circle with pizza + "Round N"
 * + countdown; 8 orange food tiles in a ring (tomato 5×, hotdog 10×,
 * skewers 15×, cabbage 5×, ham 25×, corn 5×, carrot 5×, steak 45×);
 * Salad bottom-left, Pizza bottom-right (BOTH BETTABLE — 21:14
 * correction; side result is an independent server-side weighted draw);
 * "Today's prize" (the viewer's real total winnings today, boss-confirmed);
 * Regular pill ONLY (no Advanced anywhere); bet chips 5/50/100/1000.
 *
 * ALL STRINGS ARE HARDCODED ENGLISH (boss order: everything in the app
 * is English). No i18n keys are used for this game.
 *
 * REAL MONEY, NO DEMO: balance comes from subscribeWalletBalance; bets
 * are intents the VeeDelicious bot validates, debits, and settles. This
 * component draws NOTHING itself — no client-side winner, no demo
 * balance, no placeholder winners. If the bot is down, rounds simply do
 * not advance and no money moves. No presence heartbeat: the global
 * loop runs continuously, so none is needed.
 *
 * Result pop-up: an ABSOLUTE CENTRED overlay (true screen centre, NOT a
 * bottom sheet) — the decided reading of the boss's red mark on the
 * preview screenshot. It shows the winning food big, the winning side,
 * the viewer's winnings line, and the top-3 biggest winners.
 *
 * POLISH 2026-10-25: rules come from delicious/config (missing field =
 * today's value, never a crash); history button beside the X opens
 * today's real rounds; round numbers + Today's prize reset daily
 * (bot-side, Dhaka day); panel geometry fits exactly (NON_WHEEL_H 296,
 * exact-fit panel, no clipping).
 * FIXES 2026-10-25: You badges removed; "coming" text removed
 * everywhere; strip lags the pop-up; tiles enlarged; history =
 * viewer's own played rounds; pop-up = viewer spent/won big +
 * top-3 avatar row; whole sheet premium pass (no demo look).
 * FREEZE FIX: betting overrun shows a spinner + live elapsed timer
 * (never a frozen 0s, never a static '…'); pop-up auto-closes at
 * window end; strip joins then.
 * SPIN + TIMER 2026-10-26 (boss: no dead waits, no stalls): every
 * waiting state has MOTION + A NUMBER — settling/overrun shows a
 * spinning ring + seconds counting UP since betting closed, the
 * wheel tiles cycle a gold highlight roulette-style, and the 3s
 * count decelerates the highlight to LAND on the known winner.
 * PREVIEW GEOMETRY 2026-10-26 (boss: tiles exactly like the preview
 * source): tile centres + hub centre + spoke style follow the
 * preview file (hub 33% of wheel width at 50%/46%; tiles 21.5% of
 * wheel width, 1/1.06 aspect; spokes #FF5A3C at 0.4 opacity;
 * labels "Win N Times"), clamped into the wheel box so small
 * screens never clip and tiles never overlap (geometry script
 * proves it). Preview-page chrome (DEMO banner/balance, yellow
 * header, "preview-তে bet নেই" notes) is NEVER copied here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Alert,
  Dimensions,
  Image,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import {
  DELICIOUS_FOODS,
  DELICIOUS_SIDES,
  deliciousToday,
  getMyDeliciousBetsOnce,
  getMyDeliciousPayoutOnce,
  mergeDeliciousConfig,
  placeDeliciousBet,
  subscribeDeliciousConfig,
  subscribeDeliciousResults,
  subscribeDeliciousRound,
  subscribeMyDeliciousBets,
  subscribeMyDeliciousPayout,
  subscribeMyTodayPrize,
  type DeliciousBet,
  type DeliciousBiggestWinner,
  type DeliciousConfigRaw,
  type DeliciousFood,
  type DeliciousFoodId,
  type DeliciousResult,
  type DeliciousRound,
  type DeliciousSide,
  type DeliciousSideId,
} from '../../services/deliciousService';

const { width: SW, height: SH } = Dimensions.get('window');
// Panel height: tall enough for the wheel, short enough that the room
// still shows dimmed above it (like the imo screenshot).
const PANEL_H = Math.min(SH * 0.78, 640);
// FIXES 2026-10-25: exact-fit panel (no bottom clipping on any screen)
// + bigger tiles (width decoupled from height so the wheel looks full).
const NON_WHEEL_H = 296;
const WHEEL_H = PANEL_H - NON_WHEEL_H;
const WHEEL_W = SW - 24;
// PREVIEW GEOMETRY (from the preview source file, not the screenshot):
// tile width 21.5% of wheel width, aspect 1/1.06; hub 33% of wheel
// width centred at (50%, 46%) of the wheel box; tile centres at the
// preview's ring fractions. The live wheel box is often much wider
// than tall (unlike the preview's near-square wheel), so both sizes
// are ALSO capped by the box height: tile height ≤ 25% of wheel
// height (row pitch is 27.04% — this keeps same-column tiles apart)
// and hub diameter capped so the top/bottom tiles clear the hub.
// On phone-sized boxes the preview values bind exactly; on short
// screens the caps bind instead (tiles/hub shrink, never overlap).
// Centres are clamped into the wheel box so the top/bottom tiles
// never poke into the header on small screens (the geometry script
// proves no overlap after clamping, at every tested size).
const TILE_W = Math.min(WHEEL_W * 0.215, (WHEEL_H * 0.25) / 1.06);
const TILE_H = TILE_W * 1.06;
// Hub cap uses the CLAMPED hotdog geometry (its ideal top is negative
// on short boxes, so it sits at top 0 and its bottom edge is TILE_H
// below the wheel top; the hub must clear that edge by 4px).
const CIRCLE = Math.max(40, Math.min(WHEEL_W * 0.33, 2 * (0.46 * WHEEL_H - TILE_H - 4)));
const HUB_FRAC = { x: 0.50, y: 0.46 };
const TILE_CENTER_FRAC: Record<DeliciousFoodId, { x: number; y: number }> = {
  hotdog: { x: 0.50, y: 0.0936 },
  tomato: { x: 0.26, y: 0.1872 },
  skewers: { x: 0.74, y: 0.1872 },
  cabbage: { x: 0.145, y: 0.4576 },
  ham: { x: 0.855, y: 0.4576 },
  corn: { x: 0.26, y: 0.728 },
  steak: { x: 0.74, y: 0.728 },
  carrot: { x: 0.50, y: 0.8216 },
};
// Clockwise ring order from the top (for the roulette highlight).
const RING_ORDER: DeliciousFoodId[] = ['hotdog', 'skewers', 'ham', 'steak', 'carrot', 'corn', 'cabbage', 'tomato'];

function tileRect(foodId: DeliciousFoodId): { left: number; top: number; cx: number; cy: number } {
  const f = TILE_CENTER_FRAC[foodId];
  const left = Math.min(Math.max(f.x * WHEEL_W - TILE_W / 2, 0), WHEEL_W - TILE_W);
  const top = Math.min(Math.max(f.y * WHEEL_H - TILE_H / 2, 0), WHEEL_H - TILE_H);
  return { left, top, cx: left + TILE_W / 2, cy: top + TILE_H / 2 };
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

const RANK_COLORS = ['#FFD43B', '#C0C0C0', '#CD7F32'];

/** Top-3 winner avatar (FIX 9b, imo-type row): avatar circle with a
    rank badge, name + diamond win below. Missing/failed avatar ->
    plain initial circle — never a broken image, never a fake name. */
function WinnerAvatar({ winner, rank }: { winner: DeliciousBiggestWinner; rank: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const color = RANK_COLORS[rank - 1] ?? '#FFD43B';
  const initial = (winner.name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ width: 56, height: 56 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: color, overflow: 'hidden', backgroundColor: '#3D0A0A', alignItems: 'center', justifyContent: 'center' }}>
          {winner.avatar && !imgFailed ? (
            <Image source={{ uri: winner.avatar }} style={{ width: 56, height: 56 }} resizeMode="cover" onError={() => setImgFailed(true)} />
          ) : (
            <Text style={{ color: '#FFF', fontSize: 24, fontWeight: '800' }}>{initial}</Text>
          )}
        </View>
        <View style={{ position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#1F2937', fontSize: 11, fontWeight: '800' }}>{rank}</Text>
        </View>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 13, fontWeight: '700', marginTop: 6, textAlign: 'center', width: '100%' }}>{winner.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
        <DiamondIcon size={12} />
        <Text style={{ color: '#FFD43B', fontSize: 13, fontWeight: '800', marginLeft: 3 }}>{formatNum(winner.amount)}</Text>
      </View>
    </View>
  );
}

export function DeliciousGameSheet({ visible, myUid, onClose }: {
  visible: boolean;
  myUid: string;
  onClose: () => void;
}) {
  const [round, setRound] = useState<DeliciousRound | null>(null);
  const [results, setResults] = useState<Record<string, DeliciousResult>>({});
  const [myBets, setMyBets] = useState<Record<string, DeliciousBet>>({});
  const [myPayout, setMyPayout] = useState<number | null>(null);
  const [todayPrize, setTodayPrize] = useState<number>(0);
  const [balance, setBalance] = useState<number>(0);
  const [selectedAmount, setSelectedAmount] = useState<number>(5);
  const [now, setNow] = useState<number>(Date.now());
  const [dismissedRound, setDismissedRound] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [configRaw, setConfigRaw] = useState<DeliciousConfigRaw | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyWins, setHistoryWins] = useState<Record<number, number | null>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  // FIX 8: history shows ONLY rounds the viewer played (viewer-relative,
  // all users — keys off myUid, never a hardcoded user).
  const [playedRounds, setPlayedRounds] = useState<{ n: number; food: DeliciousFoodId; side: DeliciousSideId }[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const roundRef = useRef<DeliciousRound | null>(null);
  roundRef.current = round;
  // SPIN CLOCK state: spinTick drives the roulette highlight + the
  // spinner rotation; spinTickRef mirrors it for the count-start
  // capture effect; countStartRef freezes the count landing schedule.
  const [spinTick, setSpinTick] = useState(0);
  const spinTickRef = useRef(0);
  const countStartRef = useRef<{ n: number; startNow: number; startIdx: number } | null>(null);

  // Live clock for countdowns (500ms tick).
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [visible]);

  // Round + results subscriptions (global game — no roomId).
  useEffect(() => {
    if (!visible) return;
    const u1 = subscribeDeliciousRound(setRound);
    const u2 = subscribeDeliciousResults(setResults);
    return () => { u1(); u2(); };
  }, [visible]);

  // Live game rules (server-driven; missing = today's values).
  useEffect(() => {
    if (!visible) return;
    const u = subscribeDeliciousConfig(setConfigRaw);
    return () => { u(); };
  }, [visible]);

  // Own bets + payout for the CURRENT round (re-subscribe on round change).
  const roundN = round?.n ?? null;
  useEffect(() => {
    if (!visible || roundN == null || !myUid) return;
    const u1 = subscribeMyDeliciousBets(roundN, myUid, setMyBets);
    const u2 = subscribeMyDeliciousPayout(roundN, myUid, setMyPayout);
    return () => { u1(); u2(); };
  }, [visible, roundN, myUid]);

  // Own Today's prize + real wallet balance.
  useEffect(() => {
    if (!visible || !myUid) return;
    const u1 = subscribeMyTodayPrize(myUid, (e) => {
      // Only the entry for the global current day counts; a stale day
      // (bot has not reset yet) still shows its total until reset.
      setTodayPrize(e ? e.total : 0);
    });
    const u2 = subscribeWalletBalance(myUid, setBalance);
    return () => { u1(); u2(); };
  }, [visible, myUid]);


  // Reset the dismissed pop-up when a new round starts.
  useEffect(() => {
    setDismissedRound(null);
  }, [roundN]);

  // Effective rules: server config over today's hardcoded values.
  const config = useMemo(() => mergeDeliciousConfig(configRaw), [configRaw]);
  const effFoodMap = useMemo(() => {
    const m = {} as Record<DeliciousFoodId, DeliciousFood>;
    for (const f of DELICIOUS_FOODS) m[f.id] = { ...f, multiplier: config.foods[f.id] };
    return m;
  }, [config]);
  const effSideMap = useMemo(() => {
    const m = {} as Record<DeliciousSideId, DeliciousSide>;
    for (const s of DELICIOUS_SIDES) m[s.id] = { ...s, multiplier: config.sides[s.id].multiplier };
    return m;
  }, [config]);

  // If the server chips change under us, fall back to the first chip.
  useEffect(() => {
    if (!config.chips.includes(selectedAmount)) setSelectedAmount(config.chips[0]);
  }, [config, selectedAmount]);

  // FIX 9a: the viewer's real SPEND = only bets actually paid for
  // (confirmed or debited). Rejected / never-debited intents are not spend.
  const myPaidTotal = useMemo(
    () => Object.values(myBets).filter((b) => b.status === 'confirmed' || b.status === 'debited').reduce((s, b) => s + b.amount, 0),
    [myBets],
  );

  const todayStr = deliciousToday(now);

  const history = useMemo(() => {
    return Object.entries(results)
      .map(([n, r]) => ({ n: Number(n), food: r.winningFood }))
      .filter((h) => Number.isFinite(h.n) && results[String(h.n)]?.day === todayStr && !!effFoodMap[h.food])
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
  }, [results, todayStr, effFoodMap]);

  // Today's rounds for the history view (newest first, last 30).
  const todayRounds = useMemo(() => {
    return Object.entries(results)
      .map(([n, r]) => ({ n: Number(n), food: r.winningFood, side: r.winningSide }))
      .filter((h) => Number.isFinite(h.n) && results[String(h.n)]?.day === todayStr && !!effFoodMap[h.food] && !!effSideMap[h.side])
      .sort((a, b) => b.n - a.n)
      .slice(0, 30);
  }, [results, todayStr, effFoodMap, effSideMap]);

  const phase = round?.phase ?? null;
  const bettingOpen = phase === 'betting';
  // FREEZE FIX: once the betting clock hits zero the sheet must never
  // sit on a frozen "0s" with a "tap to bet" hint. Past endsAt, betting
  // is treated as closed (spinner + elapsed timer, closed hint, no new
  // bets) until the bot's count phase starts — typically under a second.
  const bettingOverrun = phase === 'betting' && round != null && now >= round.endsAt;
  const bettingActive = bettingOpen && !bettingOverrun;
  const secondsLeft = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;
  const countDigit = phase === 'count' ? Math.min(3, Math.max(1, secondsLeft)) : null;
  // The pop-up lives only inside its result window: once endsAt passes
  // it closes on its own (and the result joins the strip, below), so a
  // stalled bot can never leave a stale pop-up on screen.
  const resultWindowOver = phase === 'result' && round != null && now >= round.endsAt;
  const showResult = phase === 'result' && round && dismissedRound !== round.n && !resultWindowOver;
  const result = round ? results[String(round.n)] : undefined;
  const biggestWinners = result?.biggest ?? [];

  // SPIN + TIMER (boss: never a dead wait, never a stall look).
  // spinning = every phase where the user waits: settling, betting
  // overrun, count, and pre-round. While spinning, a 130ms clock
  // drives the roulette highlight, the spinner rotation, and the
  // elapsed counter (on top of the 500ms clock) — motion is always
  // visible, and no transition is ever delayed by this code: phase
  // changes still come from the realtime subscriptions alone.
  const spinning = phase === 'settling' || bettingOverrun || phase === 'count' || round == null;
  useEffect(() => {
    if (!visible || !spinning) return;
    const t = setInterval(() => {
      spinTickRef.current += 1;
      setSpinTick(spinTickRef.current);
      setNow(Date.now());
    }, 130);
    return () => clearInterval(t);
  }, [visible, spinning]);

  // COUNT LANDING: freeze the spin index + start time the moment the
  // count phase begins, so the deceleration below lands on the
  // already-known winner exactly at the count window's end.
  useEffect(() => {
    if (phase === 'count' && roundN != null) {
      if (!countStartRef.current || countStartRef.current.n !== roundN) {
        countStartRef.current = { n: roundN, startNow: Date.now(), startIdx: spinTickRef.current % 8 };
      }
    } else if (phase !== 'count') {
      countStartRef.current = null;
    }
  }, [phase, roundN]);

  // Winner known during count (results are written before the count
  // phase) — read it from the round or the results map, never guess.
  const winnerFood = round?.winningFood ?? (roundN != null ? results[String(roundN)]?.winningFood : undefined);
  // Seconds since betting closed (betting end is in the past during
  // overrun + settling, so this counts UP for the whole wait).
  const overrunElapsed = round ? Math.max(0, Math.floor((now - round.endsAt) / 1000)) : 0;
  // Roulette highlight: continuous cycling during settling/overrun;
  // during count it decelerates (ease-out) and lands on the winner.
  // During betting/result there is no spin highlight (betting tiles
  // stay clean; result uses the winner gold border instead).
  let spinHighlight: DeliciousFoodId | null = null;
  if (phase === 'settling' || bettingOverrun) {
    spinHighlight = RING_ORDER[spinTick % 8];
  } else if (phase === 'count' && winnerFood) {
    const cs = countStartRef.current;
    const winnerIdx = RING_ORDER.indexOf(winnerFood);
    if (cs && cs.n === roundN && winnerIdx >= 0) {
      const T = Math.max(500, (config.countSeconds ?? 3) * 1000);
      const progress = Math.min(1, Math.max(0, (Date.now() - cs.startNow) / T));
      let totalSteps = 12;
      while ((cs.startIdx + totalSteps) % 8 !== winnerIdx) totalSteps++;
      const eased = 1 - Math.pow(1 - progress, 2.5);
      // Land on the winner for the final ~8% of the count window
      // (holds there until the pop-up) — this guarantees the landing
      // regardless of 130ms tick alignment; before that the eased
      // curve decelerates the steps.
      const step = progress >= 0.92 ? totalSteps : Math.floor(eased * totalSteps);
      spinHighlight = RING_ORDER[(cs.startIdx + step) % 8];
    } else {
      spinHighlight = RING_ORDER[spinTick % 8];
    }
  }

  // FIX 9a: pop-up viewer block. Participated = paid at least one bet.
  // Spent = sum of paid bets; won = credited payout (0 when none).
  // Old code showed only "This round's winnings" (= the payout, and
  // only when > 0) and never the spend — that ambiguity is gone.
  const viewerParticipated = myPaidTotal > 0;
  const viewerWon = myPayout ?? 0;

  // FIX 3: the bottom Result strip must NOT show round N before round
  // N's result pop-up has been displayed. The strip includes round N
  // only once its pop-up was dismissed, or once a newer round started
  // (so its pop-up window is over). The History view is NOT filtered
  // this way (fix 8 filters it by played rounds instead).
  const stripHistory = useMemo(() => {
    return history.filter((h) => h.n !== roundN || (phase === 'result' && (dismissedRound === roundN || resultWindowOver)));
  }, [history, roundN, phase, dismissedRound, resultWindowOver]);

  // History view (FIX 8): one-time reads of the viewer's OWN bets +
  // payouts. Only rounds the viewer actually played (a confirmed or
  // debited bet) are listed — never-played rounds never appear, for ANY
  // viewer (the filter keys off myUid, the viewing user, never a
  // hardcoded id). Played-but-0-win rounds show "—". Real data only.
  async function openHistory() {
    setShowHistory(true);
    setHistoryReady(false);
    if (!myUid) {
      setPlayedRounds([]);
      setHistoryWins({});
      setHistoryReady(true);
      return;
    }
    setHistoryLoading(true);
    try {
      const betEntries = await Promise.all(
        todayRounds.map(async (h) => [h.n, await getMyDeliciousBetsOnce(h.n, myUid)] as const),
      );
      const played = todayRounds.filter((h) => {
        const bets = betEntries.find(([n]) => n === h.n)?.[1];
        return !!bets && Object.values(bets).some((b) => b.status === 'confirmed' || b.status === 'debited');
      });
      const winEntries = await Promise.all(
        played.map(async (h) => [h.n, await getMyDeliciousPayoutOnce(h.n, myUid)] as const),
      );
      const m: Record<number, number | null> = {};
      for (const [n, amt] of winEntries) m[n] = amt;
      setPlayedRounds(played);
      setHistoryWins(m);
    } catch (_) {
      setPlayedRounds([]);
      setHistoryWins({});
    } finally {
      setHistoryLoading(false);
      setHistoryReady(true);
    }
  }

  async function onBetTarget(kind: 'food' | 'side', target: DeliciousFoodId | DeliciousSideId) {
    if (!round || !bettingOpen || bettingOverrun || placing) return;
    if (balance < selectedAmount) {
      Alert.alert('Not enough diamonds', 'Your diamond balance is lower than the selected bet amount.');
      return;
    }
    setPlacing(true);
    try {
      await placeDeliciousBet(round.n, myUid, kind, target, selectedAmount);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (e) {
      Alert.alert('Bet failed', e instanceof Error ? e.message : 'Could not place the bet. Please try again.');
    } finally {
      setPlacing(false);
    }
  }

  // PREVIEW SPOKES: thin lines from the hub centre to each tile
  // centre, preview style (#FF5A3C at 0.4 opacity). Rendered BEFORE
  // the tiles and the hub, so both cover the spoke ends and only the
  // hub-edge-to-tile-edge segment shows — exactly like the preview.
  function renderSpoke(foodId: DeliciousFoodId) {
    const r = tileRect(foodId);
    const cx = HUB_FRAC.x * WHEEL_W;
    const cy = HUB_FRAC.y * WHEEL_H;
    const dx = r.cx - cx;
    const dy = r.cy - cy;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0) return null;
    const ux = dx / dist;
    const uy = dy / dist;
    const ex = cx + ux * (CIRCLE / 2 + 2);
    const ey = cy + uy * (CIRCLE / 2 + 2);
    const len = Math.hypot(r.cx - ex, r.cy - ey);
    const angle = (Math.atan2(r.cy - ey, r.cx - ex) * 180) / Math.PI;
    return (
      <View
        key={`spoke-${foodId}`}
        style={{
          position: 'absolute',
          left: (r.cx + ex) / 2 - len / 2,
          top: (r.cy + ey) / 2 - 1,
          width: len,
          height: 2,
          backgroundColor: '#FF5A3C',
          opacity: 0.4,
          transform: [{ rotate: `${angle}deg` }],
        }}
      />
    );
  }

  function renderFoodTile(foodId: DeliciousFoodId) {
    const food = effFoodMap[foodId];
    const r = tileRect(foodId);
    const isWinner = phase === 'result' && round?.winningFood === foodId;
    const dimmed = phase === 'result' && round?.winningFood !== foodId;
    const isSpinning = spinHighlight === foodId;
    const tileStyle: ViewStyle = {
      position: 'absolute',
      left: r.left,
      top: r.top,
      width: TILE_W,
      height: TILE_H,
      borderRadius: TILE_W * 0.18,
      overflow: 'hidden',
      backgroundColor: '#F59E0B',
      opacity: dimmed ? 0.45 : 1,
      borderWidth: isWinner || isSpinning ? 3 : 0,
      borderColor: isWinner || isSpinning ? '#FFD43B' : 'transparent',
    };
    return (
      <Pressable
        key={foodId}
        onPress={() => onBetTarget('food', foodId)}
        style={tileStyle}
      >
        <Image source={food.image} style={{ width: TILE_W, height: TILE_H }} resizeMode="cover" />
        {/* PREVIEW LABEL: "Win N Times" over the image (preview style:
            bottom 5%, full-bleed overhang, white bold with warm shadow,
            no dark bar) — replaces the old "Win N" bar. */}
        <View style={{ position: 'absolute', bottom: TILE_H * 0.05, left: -TILE_W * 0.06, right: -TILE_W * 0.06, alignItems: 'center' }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 13, fontWeight: '800', textShadowColor: '#B34A00', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>Win {food.multiplier} Times</Text>
        </View>
      </Pressable>
    );
  }

  function renderSide(sideId: DeliciousSideId, align: 'left' | 'right') {
    const side = effSideMap[sideId];
    const isWinner = phase === 'result' && round?.winningSide === sideId;
    const dimmed = phase === 'result' && round?.winningSide !== sideId;
    return (
      <Pressable
        onPress={() => onBetTarget('side', sideId)}
        style={{ alignItems: 'center', opacity: dimmed ? 0.45 : 1, width: 76 }}
      >
        <View style={{
          width: 64, height: 64, borderRadius: 32, overflow: 'hidden',
          borderWidth: isWinner ? 3 : 0, borderColor: isWinner ? '#FFD43B' : 'transparent',
          backgroundColor: '#F59E0B',
        }}>
          <Image source={side.image} style={{ width: 64, height: 64 }} resizeMode="cover" />
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginTop: 2 }}>{side.name}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFD43B', fontSize: 12, fontWeight: '800' }}>{side.multiplier}×</Text>
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Dim: the room stays faintly visible behind the sheet. The dim is
          NOT pressable — closing is via the X only, so a stray tap never
          drops the game view mid-round (bets live server-side anyway). */}
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: PANEL_H,
        backgroundColor: '#5B0F0F', borderTopLeftRadius: 20, borderTopRightRadius: 20,
        paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, overflow: 'hidden',
      }}>
        {/* Header: X + history + real balance pill. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 40 }}>
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 4 }}>
            <Feather name="x" size={26} color="#FFF" />
          </Pressable>
          <Pressable
            onPress={openHistory}
            hitSlop={10}
            style={{
              flexDirection: 'row', alignItems: 'center', marginLeft: 10,
              borderWidth: 1, borderColor: '#FFD43B88', backgroundColor: '#3D0A0A',
              borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7,
            }}
          >
            <Feather name="clock" size={16} color="#FFD43B" />
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800', marginLeft: 5 }}>History</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{
            flexDirection: 'row', alignItems: 'center', backgroundColor: '#3D0A0A',
            borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#FF6B6B55',
          }}>
            <DiamondIcon size={18} />
            <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '800', marginLeft: 6 }}>{formatNum(balance)}</Text>
          </View>
        </View>

        {/* Wheel: spokes (behind) + tiles + centre circle (hub). */}
        <View style={{ height: WHEEL_H, marginTop: 2 }}>
          {DELICIOUS_FOODS.map((f) => renderSpoke(f.id))}
          {DELICIOUS_FOODS.map((f) => renderFoodTile(f.id))}
          {/* Centre circle: pizza + Round + countdown (preview hub:
              33% of wheel width at 50%/46% of the wheel box). The
              second line is NEVER a static '…': betting shows the
              countdown, overrun/settling show a spinning ring + live
              elapsed seconds counting UP, count shows the digit,
              result shows "Result". */}
          <View style={{
            position: 'absolute', left: HUB_FRAC.x * WHEEL_W - CIRCLE / 2, top: HUB_FRAC.y * WHEEL_H - CIRCLE / 2,
            width: CIRCLE, height: CIRCLE,
            borderRadius: CIRCLE / 2, overflow: 'hidden', borderWidth: 3, borderColor: '#FFD43B',
            backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center',
          }}>
            <Image source={effSideMap.pizza.image} style={{ position: 'absolute', width: CIRCLE, height: CIRCLE }} resizeMode="cover" />
            {round ? (
              <View style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, width: CIRCLE - 16 }}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>Round {round.n}</Text>
                {bettingActive ? (
                  <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>{secondsLeft}s</Text>
                ) : phase === 'settling' || bettingOverrun ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFD43B', transform: [{ rotate: `${(spinTick * 27) % 360}deg` }] }} />
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 18, fontWeight: '800', marginLeft: 6 }}>+{overrunElapsed}s</Text>
                  </View>
                ) : phase === 'count' ? (
                  <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>{countDigit}</Text>
                ) : phase === 'result' ? (
                  <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>Result</Text>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFD43B', transform: [{ rotate: `${(spinTick * 27) % 360}deg` }] }} />
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 18, fontWeight: '800', marginLeft: 6 }}>+{overrunElapsed}s</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: CIRCLE - 12 }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFD43B', transform: [{ rotate: `${(spinTick * 27) % 360}deg` }] }} />
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginLeft: 6 }}>Starting game</Text>
              </View>
            )}
          </View>
          {/* 3-2-1 count overlay: clean digits ONLY (FIX 2 — the
              "coming" text is removed everywhere). During the count
              the tile highlight decelerates and lands on the winner
              (see spinHighlight); the settling phase shows the
              spinner + elapsed timer in the centre instead. */}
          {countDigit != null && (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFF', fontSize: 72, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 }}> {countDigit} </Text>
            </View>
          )}
        </View>

        {/* Today's prize (real accumulator) + history strip. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 26 }}>
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>Today's prize </Text>
          <DiamondIcon size={14} />
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginLeft: 4 }}>{formatNum(todayPrize)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 36 }}>
          <Text style={{ color: '#FFD9D9', fontSize: 12, fontWeight: '800', marginRight: 8 }}>Result</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {stripHistory.map((h) => (
              <Image
                key={h.n}
                source={effFoodMap[h.food].image}
                style={{ width: 28, height: 28, borderRadius: 8, marginRight: 6 }}
              />
            ))}
          </ScrollView>
        </View>

        {/* Sides + Regular pill. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', height: 108, marginTop: 2 }}>
          {renderSide('salad', 'left')}
          <View style={{ backgroundColor: '#FF6B4A', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 8, marginTop: 14 }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>Regular</Text>
          </View>
          {renderSide('pizza', 'right')}
        </View>

        {/* Bet chips: amount first, then a food/side. */}
        <View style={{ flexDirection: 'row', gap: 8, height: 44 }}>
          {config.chips.map((chip) => {
            const selected = selectedAmount === chip;
            return (
              <Pressable
                key={chip}
                onPress={() => { setSelectedAmount(chip); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: selected ? '#A5D8FF' : '#D7D7DE', borderRadius: 12,
                  borderWidth: selected ? 2 : 0, borderColor: selected ? '#FFF' : 'transparent',
                }}
              >
                <DiamondIcon size={14} />
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#1F2937', marginLeft: 4 }}>{chip}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFD9D9', fontSize: 12, textAlign: 'center', marginTop: 4, height: 16 }}>
          {!round
            ? 'Starting game'
            : bettingActive
              ? 'Tap an amount, then a food or side to bet'
              : 'Betting closed — wait for the next round'}
        </Text>
      </View>

      {/* History view over the sheet (today's rounds, real data only). */}
      {showHistory && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: PANEL_H,
          backgroundColor: '#5B0F0F', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', height: 40 }}>
            <Pressable onPress={() => setShowHistory(false)} hitSlop={12} style={{ padding: 4 }}>
              <Feather name="x" size={26} color="#FFF" />
            </Pressable>
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800', marginLeft: 10 }}>Today's History</Text>
            <View style={{ flex: 1 }} />
            {historyLoading && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#FFD9D9" />
                <Text style={{ color: '#FFD9D9', fontSize: 12, marginLeft: 6 }}>Loading</Text>
              </View>
            )}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, marginTop: 4 }}>
            {!historyReady ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 32 }}>
                <ActivityIndicator size="small" color="#FFD9D9" />
                <Text style={{ color: '#FFD9D9', fontSize: 14, marginLeft: 8 }}>Loading</Text>
              </View>
            ) : playedRounds.length === 0 ? (
              <Text style={{ color: '#FFD9D9', fontSize: 14, textAlign: 'center', marginTop: 32 }}>No played rounds yet today</Text>
            ) : playedRounds.map((h) => {
              const win = historyWins[h.n];
              return (
                <View key={h.n} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ffffff22' }}>
                  <Text style={{ color: '#FFD9D9', fontSize: 13, fontWeight: '800', width: 64 }}>Round {h.n}</Text>
                  <Image source={effFoodMap[h.food].image} style={{ width: 32, height: 32, borderRadius: 8 }} />
                  <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', marginLeft: 8, flex: 1 }} numberOfLines={1}>{effFoodMap[h.food].name}</Text>
                  <Text style={{ color: '#FFD9D9', fontSize: 13, marginRight: 10 }}>{effSideMap[h.side].name}</Text>
                  {win === undefined ? (
                    <ActivityIndicator size="small" color="#FFD9D9" />
                  ) : win != null && win > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <DiamondIcon size={13} />
                      <Text style={{ color: '#FFD43B', fontSize: 14, fontWeight: '800', marginLeft: 4 }}>+{formatNum(win)}</Text>
                    </View>
                  ) : (
                    <Text style={{ color: '#FFD9D9', fontSize: 13 }}>—</Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* CENTRED result pop-up (true screen centre, not a bottom sheet).
          FIX 9 (imo-type structure, Vee art + styling only): big
          winning-food image with glow overlapping the card top, title,
          viewer spent/won BIG (or "didn't participate"), food + side
          lines, then the top-3 biggest winners as avatar circles with
          rank badges. No-winner branch kept. */}
      {showResult && round && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ alignItems: 'center' }}>
            {round.winningFood && (
              <View style={{ width: 210, height: 210, alignItems: 'center', justifyContent: 'center', marginBottom: -105, zIndex: 2 }}>
                <View style={{ position: 'absolute', left: 0, top: 0, width: 210, height: 210, borderRadius: 105, backgroundColor: '#FFD43B11' }} />
                <View style={{ position: 'absolute', left: 15, top: 15, width: 180, height: 180, borderRadius: 90, backgroundColor: '#FFD43B22' }} />
                <View style={{ width: 140, height: 140, borderRadius: 24, overflow: 'hidden', backgroundColor: '#F59E0B', borderWidth: 2, borderColor: '#FFD43B' }}>
                  <Image source={effFoodMap[round.winningFood].image} style={{ width: 140, height: 140 }} resizeMode="cover" />
                </View>
              </View>
            )}
            <View style={{
              width: SW * 0.84, backgroundColor: '#7A1010', borderRadius: 20,
              padding: 20, paddingTop: round.winningFood ? 84 : 20,
              borderWidth: 2, borderColor: '#FFD43B', alignItems: 'center', zIndex: 1,
              elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
            }}>
              <Pressable
                onPress={() => setDismissedRound(round.n)}
                hitSlop={12}
                style={{ position: 'absolute', top: 10, right: 12 }}
              >
                <Feather name="x" size={22} color="#FFF" />
              </Pressable>
              <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '800', textAlign: 'center' }}>
                Result of Round {round.n}
              </Text>
              {viewerParticipated ? (
                <View style={{ alignItems: 'center', marginTop: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: '#FFF', fontSize: 19, fontWeight: '800' }}>You spent </Text>
                    <DiamondIcon size={18} />
                    <Text style={{ color: '#FFF', fontSize: 19, fontWeight: '800' }}> {formatNum(myPaidTotal)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ color: '#FFD43B', fontSize: 24, fontWeight: '800' }}>You won </Text>
                    <DiamondIcon size={22} />
                    <Text style={{ color: '#FFD43B', fontSize: 24, fontWeight: '800' }}> {formatNum(viewerWon)}</Text>
                  </View>
                </View>
              ) : (
                <Text style={{ color: '#FFD9D9', fontSize: 15, fontWeight: '700', marginTop: 10, textAlign: 'center' }}>
                  You didn't participate in this round
                </Text>
              )}
              {round.winningFood && (
                <Text style={{ color: '#FFD43B', fontSize: 16, fontWeight: '800', marginTop: 10, textAlign: 'center' }}>
                  {effFoodMap[round.winningFood].name} — Win {effFoodMap[round.winningFood].multiplier} Times
                </Text>
              )}
              {round.winningSide && (
                <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', marginTop: 4 }}>
                  Side: {effSideMap[round.winningSide].name}
                </Text>
              )}
              {result && biggestWinners.length > 0 && (
                <View style={{ width: '100%', marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#FFD9D9', fontSize: 13, fontWeight: '800', marginBottom: 10 }}>
                    This round's biggest winner
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', width: '100%' }}>
                    {biggestWinners.slice(0, 3).map((w, i) => (
                      <WinnerAvatar key={`${w.uid}-${i}`} winner={w} rank={i + 1} />
                    ))}
                  </View>
                </View>
              )}
              {result && biggestWinners.length === 0 && (
                <Text style={{ color: '#FFD9D9', fontSize: 13, marginTop: 12 }}>No bets this round</Text>
              )}
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}
