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
 * FREEZE FIX: betting overrun shows '…' + closed hint (never a frozen
 * 0s); pop-up auto-closes at window end; strip joins then.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Alert,
  Dimensions,
  Image,
  type ViewStyle,
  type DimensionValue,
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
const TILE_H = WHEEL_H * 0.19;
const TILE_W = Math.max(48, Math.min(WHEEL_W * 0.26, TILE_H * 1.5));
const CIRCLE = TILE_W * 1.55;

type TilePos = { top: number; left?: DimensionValue; right?: DimensionValue; centered?: boolean };
const TILE_POS: Record<DeliciousFoodId, TilePos> = {
  hotdog: { top: 0, centered: true },
  tomato: { top: WHEEL_H * 0.20, left: 0 },
  skewers: { top: WHEEL_H * 0.20, right: 0 },
  cabbage: { top: WHEEL_H * 0.40, left: 0 },
  ham: { top: WHEEL_H * 0.40, right: 0 },
  corn: { top: WHEEL_H * 0.60, left: 0 },
  steak: { top: WHEEL_H * 0.60, right: 0 },
  carrot: { top: WHEEL_H * 0.80, centered: true },
};

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
  // is treated as closed (centre "…", closed hint, no new bets) until
  // the bot's count phase starts — typically under a second.
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

  function renderFoodTile(foodId: DeliciousFoodId) {
    const food = effFoodMap[foodId];
    const pos = TILE_POS[foodId];
    const isWinner = phase === 'result' && round?.winningFood === foodId;
    const dimmed = phase === 'result' && round?.winningFood !== foodId;
    const tileStyle: ViewStyle = {
      position: 'absolute',
      top: pos.top,
      width: TILE_W,
      height: TILE_H,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: '#F59E0B',
      opacity: dimmed ? 0.45 : 1,
      borderWidth: isWinner ? 3 : 0,
      borderColor: isWinner ? '#FFD43B' : 'transparent',
    };
    if (pos.centered) { tileStyle.left = '50%'; tileStyle.marginLeft = -TILE_W / 2; }
    else if (pos.left !== undefined) tileStyle.left = pos.left;
    else if (pos.right !== undefined) tileStyle.right = pos.right;
    return (
      <Pressable
        key={foodId}
        onPress={() => onBetTarget('food', foodId)}
        style={tileStyle}
      >
        <Image source={food.image} style={{ width: TILE_W, height: TILE_H }} resizeMode="cover" />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.35)', paddingVertical: 2, alignItems: 'center' }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>Win {food.multiplier}</Text>
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

        {/* Wheel. */}
        <View style={{ height: WHEEL_H, marginTop: 2 }}>
          {DELICIOUS_FOODS.map((f) => renderFoodTile(f.id))}
          {/* Centre circle: pizza + Round + countdown. */}
          <View style={{
            position: 'absolute', left: '50%', top: '50%',
            width: CIRCLE, height: CIRCLE, marginLeft: -CIRCLE / 2, marginTop: -CIRCLE / 2,
            borderRadius: CIRCLE / 2, overflow: 'hidden', borderWidth: 3, borderColor: '#FFD43B',
            backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center',
          }}>
            <Image source={effSideMap.pizza.image} style={{ position: 'absolute', width: CIRCLE, height: CIRCLE }} resizeMode="cover" />
            {round ? (
              <View style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, width: CIRCLE - 16 }}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>Round {round.n}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>
                  {phase === 'betting' ? (bettingOverrun ? '…' : `${secondsLeft}s`) : phase === 'count' ? '…' : phase === 'result' ? 'Result' : '…'}
                </Text>
              </View>
            ) : (
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 14, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: CIRCLE - 12 }}>
                Starting game…
              </Text>
            )}
          </View>
          {/* 3-2-1 count overlay: clean digits ONLY (FIX 2 — the
              "coming" text is removed everywhere; the winner is NOT
              revealed during the count). The settling phase shows no
              overlay at all now — just the centre circle. */}
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
            ? 'Starting game…'
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
              <Text style={{ color: '#FFD9D9', fontSize: 12 }}>Loading…</Text>
            )}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, marginTop: 4 }}>
            {!historyReady ? (
              <Text style={{ color: '#FFD9D9', fontSize: 14, textAlign: 'center', marginTop: 32 }}>Loading…</Text>
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
                    <Text style={{ color: '#FFD9D9', fontSize: 13 }}>…</Text>
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
