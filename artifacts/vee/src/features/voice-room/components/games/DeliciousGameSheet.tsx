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
  DELICIOUS_CHIPS,
  DELICIOUS_FOOD_MAP,
  DELICIOUS_FOODS,
  DELICIOUS_SIDE_MAP,
  DELICIOUS_SIDES,
  placeDeliciousBet,
  subscribeDeliciousResults,
  subscribeDeliciousRound,
  subscribeMyDeliciousBets,
  subscribeMyDeliciousPayout,
  subscribeMyTodayPrize,
  type DeliciousBet,
  type DeliciousFoodId,
  type DeliciousResult,
  type DeliciousRound,
  type DeliciousSideId,
} from '../../services/deliciousService';

const { width: SW, height: SH } = Dimensions.get('window');
// Panel height: tall enough for the wheel, short enough that the room
// still shows dimmed above it (like the imo screenshot).
const PANEL_H = Math.min(SH * 0.78, 640);
const NON_WHEEL_H = 280;
const WHEEL_H = Math.max(280, PANEL_H - NON_WHEEL_H);
const TILE_W = Math.max(56, WHEEL_H / 4.6 / 1.12);
const TILE_H = TILE_W * 1.12;
const CIRCLE = TILE_W * 1.55;

type TilePos = { top: number; left?: DimensionValue; right?: DimensionValue; centered?: boolean };
const TILE_POS: Record<DeliciousFoodId, TilePos> = {
  hotdog: { top: 0, centered: true },
  tomato: { top: WHEEL_H * 0.17, left: '4%' },
  skewers: { top: WHEEL_H * 0.17, right: '4%' },
  cabbage: { top: WHEEL_H * 0.36, left: 0 },
  ham: { top: WHEEL_H * 0.36, right: 0 },
  corn: { top: WHEEL_H * 0.55, left: '4%' },
  steak: { top: WHEEL_H * 0.55, right: '4%' },
  carrot: { top: WHEEL_H * 0.78, centered: true },
};

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
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

  const myFoodTotals = useMemo(() => {
    const totals = new Map<DeliciousFoodId, number>();
    Object.values(myBets).forEach((b) => {
      if (b.kind === 'food' && b.food && b.status !== 'rejected') {
        totals.set(b.food, (totals.get(b.food) ?? 0) + b.amount);
      }
    });
    return totals;
  }, [myBets]);

  const mySideTotals = useMemo(() => {
    const totals = new Map<DeliciousSideId, number>();
    Object.values(myBets).forEach((b) => {
      if (b.kind === 'side' && b.side && b.status !== 'rejected') {
        totals.set(b.side, (totals.get(b.side) ?? 0) + b.amount);
      }
    });
    return totals;
  }, [myBets]);

  const myTotalStaked = useMemo(
    () => Object.values(myBets).filter((b) => b.status !== 'rejected').reduce((s, b) => s + b.amount, 0),
    [myBets],
  );

  const history = useMemo(() => {
    return Object.entries(results)
      .map(([n, r]) => ({ n: Number(n), food: r.winningFood }))
      .filter((h) => Number.isFinite(h.n))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
  }, [results]);

  const phase = round?.phase ?? null;
  const bettingOpen = phase === 'betting';
  const secondsLeft = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;
  const countDigit = phase === 'count' ? Math.min(3, Math.max(1, secondsLeft)) : null;
  const showResult = phase === 'result' && round && dismissedRound !== round.n;
  const result = round ? results[String(round.n)] : undefined;

  const viewerLine = useMemo(() => {
    if (!round || phase !== 'result') return null;
    if (myTotalStaked === 0) return "You didn't play this round.";
    if (myPayout != null && myPayout > 0) return `This round's winnings: ${formatNum(myPayout)}`;
    return 'No win this round.';
  }, [round, phase, myTotalStaked, myPayout]);

  async function onBetTarget(kind: 'food' | 'side', target: DeliciousFoodId | DeliciousSideId) {
    if (!round || !bettingOpen || placing) return;
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
    const food = DELICIOUS_FOOD_MAP[foodId];
    const pos = TILE_POS[foodId];
    const you = myFoodTotals.get(foodId) ?? 0;
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
          <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>Win {food.multiplier} Times</Text>
        </View>
        {you > 0 && (
          <View style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
              <Text style={{ color: '#FFD43B', fontSize: 11, fontWeight: '800' }}>You: {formatNum(you)}</Text>
            </View>
          </View>
        )}
      </Pressable>
    );
  }

  function renderSide(sideId: DeliciousSideId, align: 'left' | 'right') {
    const side = DELICIOUS_SIDE_MAP[sideId];
    const you = mySideTotals.get(sideId) ?? 0;
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
        <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginTop: 2 }}>{side.name}</Text>
        <Text style={{ color: '#FFD43B', fontSize: 12, fontWeight: '800' }}>{side.multiplier}×</Text>
        {you > 0 && (
          <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, marginTop: 2 }}>
            <Text style={{ color: '#FFD43B', fontSize: 11, fontWeight: '800' }}>You: {formatNum(you)}</Text>
          </View>
        )}
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
        paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, overflow: 'hidden',
      }}>
        {/* Header: X + real balance pill. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40 }}>
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 4 }}>
            <Feather name="x" size={26} color="#FFF" />
          </Pressable>
          <View style={{
            flexDirection: 'row', alignItems: 'center', backgroundColor: '#3D0A0A',
            borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#FF6B6B55',
          }}>
            <DiamondIcon size={18} />
            <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '800', marginLeft: 6 }}>{formatNum(balance)}</Text>
          </View>
        </View>

        {/* Wheel. */}
        <View style={{ height: WHEEL_H, marginTop: 4 }}>
          {DELICIOUS_FOODS.map((f) => renderFoodTile(f.id))}
          {/* Centre circle: pizza + Round + countdown. */}
          <View style={{
            position: 'absolute', left: '50%', top: '50%',
            width: CIRCLE, height: CIRCLE, marginLeft: -CIRCLE / 2, marginTop: -CIRCLE / 2,
            borderRadius: CIRCLE / 2, overflow: 'hidden', borderWidth: 3, borderColor: '#FFD43B',
            backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center',
          }}>
            <Image source={DELICIOUS_SIDE_MAP.pizza.image} style={{ position: 'absolute', width: CIRCLE, height: CIRCLE }} resizeMode="cover" />
            {round ? (
              <View style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>Round {round.n}</Text>
                <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>
                  {phase === 'betting' ? `${secondsLeft}s` : phase === 'count' ? '…' : phase === 'result' ? 'Result' : '…'}
                </Text>
              </View>
            ) : (
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                Starting game…
              </Text>
            )}
          </View>
          {/* 3-2-1 count overlay (winner NOT revealed during the count). */}
          {countDigit != null && (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFF', fontSize: 72, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 }}> {countDigit} </Text>
              <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>The result is coming</Text>
            </View>
          )}
          {phase === 'settling' && (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>The result is coming</Text>
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
            {history.map((h) => (
              <Image
                key={h.n}
                source={DELICIOUS_FOOD_MAP[h.food].image}
                style={{ width: 28, height: 28, borderRadius: 8, marginRight: 6 }}
              />
            ))}
          </ScrollView>
        </View>

        {/* Sides + Regular pill. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', height: 84, marginTop: 2 }}>
          {renderSide('salad', 'left')}
          <View style={{ backgroundColor: '#FF6B4A', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 8, marginTop: 14 }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>Regular</Text>
          </View>
          {renderSide('pizza', 'right')}
        </View>

        {/* Bet chips: amount first, then a food/side. */}
        <View style={{ flexDirection: 'row', gap: 8, height: 50 }}>
          {DELICIOUS_CHIPS.map((chip) => {
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
        <Text style={{ color: '#FFD9D9', fontSize: 12, textAlign: 'center', marginTop: 6, height: 18 }}>
          {!round
            ? 'Starting game…'
            : bettingOpen
              ? 'Tap an amount, then a food or side to bet'
              : 'Betting closed — wait for the next round'}
        </Text>
      </View>

      {/* CENTRED result pop-up (true screen centre, not a bottom sheet). */}
      {showResult && round && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{
            width: SW * 0.84, backgroundColor: '#7A1010', borderRadius: 20, padding: 20,
            borderWidth: 2, borderColor: '#FFD43B', alignItems: 'center',
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
            {round.winningFood && (
              <View style={{ width: 120, height: 120, borderRadius: 16, overflow: 'hidden', marginTop: 14, backgroundColor: '#F59E0B' }}>
                <Image source={DELICIOUS_FOOD_MAP[round.winningFood].image} style={{ width: 120, height: 120 }} resizeMode="cover" />
              </View>
            )}
            {round.winningFood && (
              <Text style={{ color: '#FFD43B', fontSize: 17, fontWeight: '800', marginTop: 10 }}>
                {DELICIOUS_FOOD_MAP[round.winningFood].name} — Win {DELICIOUS_FOOD_MAP[round.winningFood].multiplier} Times
              </Text>
            )}
            {round.winningSide && (
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', marginTop: 4 }}>
                Side: {DELICIOUS_SIDE_MAP[round.winningSide].name}
              </Text>
            )}
            {viewerLine && (
              <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800', marginTop: 10, textAlign: 'center' }}>
                {viewerLine}
              </Text>
            )}
            {result && result.biggest.length > 0 && (
              <View style={{ width: '100%', marginTop: 14 }}>
                <Text style={{ color: '#FFD9D9', fontSize: 13, fontWeight: '800', marginBottom: 6 }}>
                  This round's biggest winner
                </Text>
                {result.biggest.map((w, i) => (
                  <View key={`${w.uid}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
                    <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                      {i + 1}. {w.name}
                    </Text>
                    <DiamondIcon size={13} />
                    <Text style={{ color: '#FFD43B', fontSize: 14, fontWeight: '800', marginLeft: 4 }}>
                      {formatNum(w.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {result && result.biggest.length === 0 && (
              <Text style={{ color: '#FFD9D9', fontSize: 13, marginTop: 12 }}>No bets this round</Text>
            )}
          </View>
        </View>
      )}
    </Modal>
  );
}
