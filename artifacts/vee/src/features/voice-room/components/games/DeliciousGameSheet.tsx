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
 * NO Regular pill anywhere (boss 2026-10-26 02:06: removed — the gap
 * between Salad and Pizza stays clean); bet chips 5/50/100/1000/5000
 * (5k added boss 2026-10-26 02:08, from delicious/config, fallback matches).
 * BOTTOM REWORK 2026-10-26 (boss package 02:06-02:19): Top-10 Live
 * strip between the sides row and the chips (small 62px cards: rank +
 * DP + name + today's win, horizontal scroll, live from todayPrize);
 * max 6 distinct boxes per round per user (7th distinct target blocked);
 * Hot badge on the round's most-bet food, only in betting's last 10s
 * (crowd signal from delicious/totals — NEVER the drawn winner);
 * streak-bonus line in the result pop-up (delicious/bonuses).
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getDeliciousUserProfileOnce,
  getMyDeliciousBetsOnce,
  getMyDeliciousPayoutOnce,
  mergeDeliciousConfig,
  placeDeliciousBet,
  subscribeDeliciousConfig,
  subscribeDeliciousResults,
  subscribeDeliciousTotals,
  subscribeDeliciousTodayPrizeAll,
  subscribeDeliciousRound,
  subscribeMyDeliciousBets,
  subscribeMyDeliciousBonus,
  subscribeMyDeliciousPayout,
  subscribeMyTodayPrize,
  type DeliciousBet,
  type DeliciousBiggestWinner,
  type DeliciousBonus,
  type DeliciousConfigRaw,
  type DeliciousFood,
  type DeliciousFoodId,
  type DeliciousResult,
  type DeliciousRound,
  type DeliciousSide,
  type DeliciousSideId,
  type DeliciousTotals,
} from '../../services/deliciousService';

const { width: SW, height: SH } = Dimensions.get('window');
// Panel height: tall enough for the wheel, short enough that the room
// still shows dimmed above it (like the imo screenshot).
const PANEL_H = Math.min(SH * 0.84, 700);
// FIXES 2026-10-25: exact-fit panel (no bottom clipping on any screen)
// + bigger tiles (width decoupled from height so the wheel looks full).
// BOTTOM REWORK 2026-10-26: +102 for the Top-10 Live strip block
// (18 header + 2 + 80 scroll row incl. 7 top padding for the rank
// badges that overlap the card tops + 2 margins) between the sides
// row and the chips. The panel grows a little (0.78->0.84, cap 640->700)
// so the wheel keeps nearly its old size; the room still shows above.
const NON_WHEEL_H = 398;
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

// Tile rects are constants (wheel geometry never changes at runtime),
// so memoized tiles can take a stable rect prop and skip tick renders.
const TILE_RECTS = Object.fromEntries(
  DELICIOUS_FOODS.map((f) => [f.id, tileRect(f.id)]),
) as Record<DeliciousFoodId, { left: number; top: number; cx: number; cy: number }>;

/** F6: memoized spoke — pure function of foodId, never re-renders on ticks. */
const SpokeView = memo(function SpokeView({ foodId }: { foodId: DeliciousFoodId }) {
  const r = TILE_RECTS[foodId];
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
});

/** F6: memoized food tile — all props are primitives or stable refs, so
    500ms/130ms ticks skip it; it re-renders only when its own state
    changes (winner, spin highlight, own bet, own pending). The chip
    shows the paid + pending total; a still-unresolved tap adds the
    F1 "confirming…" line below the pill. */
const FoodTileView = memo(function FoodTileView(props: {
  food: DeliciousFood;
  rect: { left: number; top: number; cx: number; cy: number };
  isWinner: boolean;
  isSpinning: boolean;
  spinActive: boolean;
  resultDimmed: boolean;
  myBet: number;
  myPending: number;
  onBet: (kind: 'food' | 'side', target: DeliciousFoodId | DeliciousSideId) => void;
}) {
  const { food, rect: r, isWinner, isSpinning, spinActive, resultDimmed, myBet, myPending, onBet } = props;
  const spinDimmed = spinActive && !isSpinning;
  const dimmed = resultDimmed || spinDimmed;
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
    borderWidth: isSpinning ? 5 : isWinner ? 3 : 0,
    borderColor: isSpinning ? '#FFF3B0' : isWinner ? '#FFD43B' : 'transparent',
    ...(isSpinning ? {
      transform: [{ scale: 1.12 }],
      zIndex: 2,
      shadowColor: '#FFD43B',
      shadowOpacity: 0.9,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    } : null),
  };
  return (
    <Pressable
      onPress={() => onBet('food', food.id)}
      style={tileStyle}
    >
      <Image source={food.image} style={{ width: TILE_W, height: TILE_H }} resizeMode="cover" />
      <View style={{ position: 'absolute', bottom: TILE_H * 0.05, left: -TILE_W * 0.06, right: -TILE_W * 0.06, alignItems: 'center' }}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 13, fontWeight: '800', textShadowColor: '#B34A00', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>Win {food.multiplier} Times</Text>
      </View>
      {isSpinning && (
        <View style={{ position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{
            backgroundColor: '#3D0A0A', borderWidth: 1.5, borderColor: '#FFD43B',
            borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
          }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFD43B', fontSize: 16, fontWeight: '800' }}>{food.multiplier}x</Text>
          </View>
        </View>
      )}
      {myBet > 0 && (
        <View style={{ position: 'absolute', top: TILE_H * 0.44, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: '#3D0A0A', borderWidth: 1, borderColor: '#FFD43B',
            borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2,
          }}>
            <DiamondIcon size={11} />
            <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 12, fontWeight: '800', marginLeft: 3 }}>{formatNum(myBet)}</Text>
          </View>
          {myPending > 0 && (
            <Text style={{ color: '#FFD43B', fontSize: 10, fontWeight: '800', marginTop: 2 }}>confirming…</Text>
          )}
        </View>
      )}
    </Pressable>
  );
});

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

/** Chips-row label ONLY (boss 2026-10-26 02:24, Round 147 screenshot):
    1000 -> "1k", 5000 -> "5k"; 5/50/100 stay exactly as they are, so
    the row has space and looks nice. Display format ONLY — the bet
    amount stays the numeric chip value (selection, balance check and
    the placed bet all use the number). Non-round thousands fall back
    to the plain number, never a misleading label. Tile bet chips keep
    their comma format (formatNum) — this touches the chips row only. */
function formatChipLabel(chip: number): string {
  if (chip >= 1000 && chip % 1000 === 0) return `${chip / 1000}k`;
  return `${chip}`;
}

const RANK_COLORS = ['#FFD43B', '#C0C0C0', '#CD7F32'];

/** Top-3 winner avatar (FIX 9b, imo-type row): avatar circle with a
    rank badge, name + diamond win below. Missing/failed avatar ->
    plain initial circle — never a broken image, never a fake name. */
const WinnerAvatar = memo(function WinnerAvatar({ winner, rank }: { winner: DeliciousBiggestWinner; rank: number }) {
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
});

const TOP10_RANK_STYLE: Record<number, { bg: string; fg: string; border: string }> = {
  1: { bg: '#FFD43B', fg: '#1F2937', border: '#FFD43B' },
  2: { bg: '#E5E7EB', fg: '#1F2937', border: '#E5E7EB' },
  3: { bg: '#D08A4E', fg: '#FFF', border: '#D08A4E' },
};

/** Top-10 Live strip card (boss 2026-10-26 02:06, compacted 02:17):
    62px wide, 32px DP, 10px name + win — small enough that the strip
    stays slim, still readable. Rank badge on top (1 gold, 2 silver,
    3 bronze, 4-10 plain dark). Photo from the strip profile cache;
    missing/failed photo -> plain initial circle — never a broken
    image, never a fake name. */
const Top10Card = memo(function Top10Card({ rank, name, photo, total }: {
  rank: number;
  name: string | null;
  photo: string | null;
  total: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const rs = TOP10_RANK_STYLE[rank] ?? { bg: '#3D0A0A', fg: '#FFF', border: '#FFFFFF33' };
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={{ width: 62, alignItems: 'center', paddingHorizontal: 2, paddingTop: 7, paddingBottom: 5, marginRight: 8, backgroundColor: '#3D0A0A', borderWidth: 1, borderColor: '#FFD43B55', borderRadius: 12 }}>
      <View style={{ position: 'absolute', top: -6, left: 0, right: 0, alignItems: 'center' }}>
        <View style={{ backgroundColor: rs.bg, borderWidth: 1, borderColor: rs.border, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
          <Text style={{ color: rs.fg, fontSize: 9, fontWeight: '800' }}>{rank}</Text>
        </View>
      </View>
      <View style={{ width: 32, height: 32, borderRadius: 16, overflow: 'hidden', backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' }}>
        {photo && !imgFailed ? (
          <Image source={{ uri: photo }} style={{ width: 32, height: 32 }} resizeMode="cover" onError={() => setImgFailed(true)} />
        ) : (
          <Text style={{ color: '#3D0A0A', fontSize: 15, fontWeight: '900' }}>{initial}</Text>
        )}
      </View>
      <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 10, fontWeight: '700', marginTop: 2, width: '100%', textAlign: 'center' }}>{name ?? '—'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
        <DiamondIcon size={10} />
        <Text numberOfLines={1} style={{ color: '#FFD43B', fontSize: 10, fontWeight: '800', marginLeft: 2 }}>{formatNum(total)}</Text>
      </View>
    </View>
  );
});

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
  // BOTTOM REWORK 2026-10-26: everyone's todayPrize (strip), the
  // bot's per-food totals (Hot), the viewer's streak bonus (pop-up),
  // and the strip's per-uid profile cache (name + photo, fetched once).
  const [todayPrizeAll, setTodayPrizeAll] = useState<Record<string, { total: number; day: string }>>({});
  const [totals, setTotals] = useState<DeliciousTotals | null>(null);
  const [myBonus, setMyBonus] = useState<DeliciousBonus | null>(null);
  const [profiles, setProfiles] = useState<Record<string, { name: string | null; photo: string | null }>>({});
  const [balance, setBalance] = useState<number>(0);
  const [selectedAmount, setSelectedAmount] = useState<number>(5);
  const [now, setNow] = useState<number>(Date.now());
  const [dismissedRound, setDismissedRound] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  // F1 rejection notice: a bot-rejected tap used to vanish silently
  // (the optimistic chip just dropped). Any NEW rejection in the
  // current round shows a brief banner below (auto-dismisses).
  const [rejectNotice, setRejectNotice] = useState<string | null>(null);
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
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
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

  // BOTTOM REWORK 2026-10-26: strip totals + Hot totals (global,
  // visible-gated like the rest).
  useEffect(() => {
    if (!visible) return;
    const u1 = subscribeDeliciousTodayPrizeAll(setTodayPrizeAll);
    const u2 = subscribeDeliciousTotals(setTotals);
    return () => { u1(); u2(); };
  }, [visible]);

  // Streak bonus for the CURRENT round (re-subscribe on round change).
  useEffect(() => {
    if (!visible || roundN == null || !myUid) return;
    const u = subscribeMyDeliciousBonus(roundN, myUid, setMyBonus);
    return () => { u(); };
  }, [visible, roundN, myUid]);


  // Reset the dismissed pop-up when a new round starts.
  useEffect(() => {
    setDismissedRound(null);
  }, [roundN]);

  // F1: watch for NEW rejections in the current round. The first
  // snapshot per round only seeds the seen set (no stale notice on
  // open); later snapshots diff against it. 'late' -> the too-late
  // wording; other reasons (insufficient/invalid/max-boxes) -> the
  // generic wording. Never implies a rejected tap was charged.
  const rejectSeenRef = useRef<{ n: number | null; ids: Set<string>; init: boolean }>({ n: null, ids: new Set(), init: false });
  useEffect(() => {
    if (roundN == null) return;
    if (rejectSeenRef.current.n !== roundN) {
      rejectSeenRef.current = { n: roundN, ids: new Set(), init: false };
    }
    const rejected = Object.entries(myBets).filter(([, b]) => b.status === 'rejected');
    if (!rejectSeenRef.current.init) {
      rejected.forEach(([id]) => rejectSeenRef.current.ids.add(id));
      rejectSeenRef.current.init = true;
      return;
    }
    const fresh = rejected.filter(([id]) => !rejectSeenRef.current.ids.has(id));
    if (fresh.length > 0) {
      fresh.forEach(([id]) => rejectSeenRef.current.ids.add(id));
      const anyLate = fresh.some(([, b]) => (b.reason ?? '').toLowerCase().includes('late'));
      setRejectNotice(anyLate ? 'Bet missed — too late, not charged' : 'Bet missed — not charged');
    }
  }, [myBets, roundN]);
  useEffect(() => {
    if (rejectNotice == null) return;
    const t = setTimeout(() => setRejectNotice(null), 3500);
    return () => clearTimeout(t);
  }, [rejectNotice]);

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

  // BET CHIP (boss 01:34 + timing 01:37): the user's own paid amount per
  // target, shown ON the tile itself. Subscribed baseline = paid bets
  // only (debited/confirmed, same definition as myPaidTotal — pending
  // intents and rejected/refunded bets never count).
  const myBetByTarget = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of Object.values(myBets)) {
      if (b.status !== 'confirmed' && b.status !== 'debited') continue;
      if (b.kind === 'food' && b.food) m[`food:${b.food}`] = (m[`food:${b.food}`] ?? 0) + b.amount;
      else if (b.kind === 'side' && b.side) m[`side:${b.side}`] = (m[`side:${b.side}`] ?? 0) + b.amount;
    }
    return m;
  }, [myBets]);

  // Rejected totals per target (same shape) — needed so a bot-rejected
  // tap stops inflating the chip the moment the rejection lands.
  // There is no expiry: entries live until the round changes, so a
  // burst tap charged late at settle can never drop the chip mid-round.
  const myRejectedByTarget = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of Object.values(myBets)) {
      if (b.status !== 'rejected') continue;
      if (b.kind === 'food' && b.food) m[`food:${b.food}`] = (m[`food:${b.food}`] ?? 0) + b.amount;
      else if (b.kind === 'side' && b.side) m[`side:${b.side}`] = (m[`side:${b.side}`] ?? 0) + b.amount;
    }
    return m;
  }, [myBets]);

  // Optimistic entries: added the instant the user taps (same frame, no
  // network wait). The displayed chip is DERIVED (see displayBetByTarget):
  // paid + still-unresolved taps, where resolved = paid growth +
  // rejected growth since the first unresolved tap. Deriving during
  // render (never effect-synced state) means a confirm can never paint
  // one frame of paid + optimistic double, and a reject-then-confirm
  // sequence on the same target can never over-count: the rejected
  // tap's amount cancels against rejected growth the moment the
  // rejection lands. A failed write rolls back immediately; entries
  // live until the round changes (no mid-round expiry), so a burst tap
  // charged late at settle can never drop the chip mid-round.
  type OptEntry = { id: number; amount: number };
  const [optByTarget, setOptByTarget] = useState<Record<string, { baseline: number; rejectedBaseline: number; entries: OptEntry[] }>>({});
  const optIdRef = useRef(0);
  // A new round starts with no bets of its own — stale entries must
  // never inflate it.
  useEffect(() => {
    setOptByTarget({});
  }, [roundN]);
  // Prune only: once a target's taps are fully resolved (derived
  // pending == 0), drop its entries and re-base on current totals, so a
  // later tap never inherits a stale baseline. Display correctness
  // never depends on this effect (displayBetByTarget derives it), so
  // pruning can never paint a flicker frame.
  useEffect(() => {
    setOptByTarget((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const q = next[key];
        if (q.entries.length === 0) continue;
        const paidGrowth = Math.max(0, (myBetByTarget[key] ?? 0) - q.baseline);
        const rejGrowth = Math.max(0, (myRejectedByTarget[key] ?? 0) - (q.rejectedBaseline ?? 0));
        const pending = Math.max(0, q.entries.reduce((s, e) => s + e.amount, 0) - paidGrowth - rejGrowth);
        if (pending === 0) {
          next[key] = { baseline: myBetByTarget[key] ?? 0, rejectedBaseline: myRejectedByTarget[key] ?? 0, entries: [] };
          changed = true;
        }
      }
      if (!changed) return prev;
      return next;
    });
  }, [myBetByTarget, myRejectedByTarget]);
  // Displayed chip amount, DERIVED during render (never effect-synced):
  // subscribed paid total + still-unresolved taps, where unresolved =
  // total optimistic taps − paid growth − rejected growth since the
  // first unresolved tap (floored at 0). A confirm paints exactly the
  // paid total on the first frame (no double frame); a rejection
  // cancels its tap the moment it lands (no 15s over-count); a
  // reject-then-confirm pair on the same target nets to the paid total.
  const displayBetByTarget = useMemo(() => {
    const m = { ...myBetByTarget };
    for (const [key, q] of Object.entries(optByTarget)) {
      const paidGrowth = Math.max(0, (myBetByTarget[key] ?? 0) - q.baseline);
      const rejGrowth = Math.max(0, (myRejectedByTarget[key] ?? 0) - (q.rejectedBaseline ?? 0));
      const pending = Math.max(0, q.entries.reduce((s, e) => s + e.amount, 0) - paidGrowth - rejGrowth);
      if (pending > 0) m[key] = (m[key] ?? 0) + pending;
    }
    return m;
  }, [myBetByTarget, myRejectedByTarget, optByTarget]);

  // TOP-10 LIVE STRIP (boss 2026-10-26 02:06): everyone's todayPrize,
  // total > 0 only, sorted desc, top 10. Updates live as todayPrize
  // changes; shown in EVERY phase. Only 9 users have totals today —
  // the 10th card fills naturally when someone wins.
  const top10 = useMemo(() => {
    return Object.entries(todayPrizeAll)
      .map(([uid, e]) => ({ uid, total: typeof e?.total === 'number' ? e.total : 0 }))
      .filter((e) => Number.isFinite(e.total) && e.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [todayPrizeAll]);
  // Strip profiles: one-time fetch per uid, cached for the sheet's
  // lifetime (names/photos change rarely; totals change live via the
  // subscription above). Keyed on the uid SET, so a totals-only update
  // never refetches. A failed fetch simply leaves the uid uncached
  // (initial circle) until the set changes — never a crash, never a
  // fake name.
  const top10UidsKey = top10.map((t) => t.uid).join(',');
  useEffect(() => {
    if (!visible || top10.length === 0) return;
    let cancelled = false;
    (async () => {
      const missing = top10.filter((t) => !(t.uid in profilesRef.current));
      if (missing.length === 0) return;
      const fetched = await Promise.all(
        missing.map(async (t) => {
          try {
            return [t.uid, await getDeliciousUserProfileOnce(t.uid)] as const;
          } catch (_) {
            return [t.uid, { name: null, photo: null }] as const;
          }
        }),
      );
      if (cancelled) return;
      setProfiles((prev) => {
        const next = { ...prev };
        for (const [uid, p] of fetched) next[uid] = p;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, top10UidsKey]);

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
  // F1 (2026-10-27, round 849): intake closes 2s before the server
  // window ends (phone time). Taps in that margin look open on the
  // countdown but can still miss the bot's settle read, so they are
  // refused visibly in onBetTarget instead of silently dropping the
  // chip. bettingActive is deliberately NOT changed: the countdown
  // keeps showing the server clock (2s/1s) and the Hot badge keeps
  // its own gate; only intake is gated.
  const bettingIntakeClosed = phase === 'betting' && round != null && round.endsAt - now <= 2000;
  const secondsLeft = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;
  // F4 (2026-10-27, boss: no extra second after the 3s count):
  // the digit may reach 0 (3,2,1,0) instead of sticking at 1 while
  // the server flips count -> result. The overlay gate is
  // `countDigit != null`, so 0 still renders (it is not null).
  const countDigit = phase === 'count' ? Math.min(3, Math.max(0, secondsLeft)) : null;
  // The pop-up lives only inside its result window: once endsAt passes
  // it closes on its own (and the result joins the strip, below), so a
  // stalled bot can never leave a stale pop-up on screen.
  const resultWindowOver = phase === 'result' && round != null && now >= round.endsAt;
  // F4: the result is already written at settle (bot: phase -> count
  // only after settle, with a fresh count endsAt; count -> result
  // refreshes endsAt again), so the pop-up can show the moment the
  // count window ends instead of waiting ~0.5-1.5s for the server's
  // count -> result flip — that wait was the "extra second". The
  // pop-up then stays through the result window (fresh endsAt) and
  // still auto-closes at its end; dismissing during count-end keeps
  // it dismissed when the phase flips.
  const countEnded = phase === 'count' && round != null && now >= round.endsAt;
  const showResult = (phase === 'result' || countEnded) && round && dismissedRound !== round.n && !resultWindowOver;
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
  // HOT BADGE (boss 2026-10-26 02:12 + timing 02:15): the food with the
  // HIGHEST total confirmed bets in delicious/totals for THIS round —
  // a crowd signal so users can roughly guess, NEVER the drawn winner
  // (round.winningFood / results are deliberately never read here).
  // Gated hard: betting phase only (bettingActive excludes overrun),
  // totals.n must match the current round, and the badge appears ONLY
  // once <= 10s of betting remain (20s elapsed of the 30s window).
  // Missing/mismatched/zero totals = NO badge, never a crash, never a
  // guessed badge. Ties keep the first food in DELICIOUS_FOODS order.
  const hotFoodId: DeliciousFoodId | null = useMemo(() => {
    if (!bettingActive || !round || !totals) return null;
    if (totals.n !== round.n) return null;
    if (round.endsAt - now > 10 * 1000) return null;
    const foods = totals.foods;
    if (!foods || typeof foods !== 'object') return null;
    let best: DeliciousFoodId | null = null;
    let bestTotal = 0;
    for (const f of DELICIOUS_FOODS) {
      const t = foods[f.id];
      if (typeof t === 'number' && Number.isFinite(t) && t > bestTotal) {
        bestTotal = t;
        best = f.id;
      }
    }
    return best;
  }, [bettingActive, round, totals, now]);
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

  // F1: once-per-round throttle for the closed-intake alert, so a
  // mashing finger cannot stack dialogs.
  const bettingClosedAlertRef = useRef<{ n: number | null; shown: boolean }>({ n: null, shown: false });
  const onBetTarget = useCallback(async (kind: 'food' | 'side', target: DeliciousFoodId | DeliciousSideId) => {
    if (!round || !bettingOpen || placing) return;
    if (bettingIntakeClosed) {
      if (bettingClosedAlertRef.current.n !== round.n || !bettingClosedAlertRef.current.shown) {
        bettingClosedAlertRef.current = { n: round.n, shown: true };
        Alert.alert('Betting closed', 'Too late for this round — not charged.');
      }
      return;
    }
    // MAX-6-BOXES RULE (boss 2026-10-26 02:06): at most 6 DISTINCT
    // boxes per round (8 foods + 2 sides). Distinct targets among the
    // user's paid bets PLUS optimistic pending taps (so rapid taps
    // can't slip a 7th box past the subscription). Betting MORE on an
    // already-bet box is always allowed. A 7th DISTINCT target is
    // blocked with a clear message — no bet placed, no chip added.
    const targetKey = kind === 'side' ? `side:${target}` : `food:${target}`;
    const distinctBetBoxes = Object.values(displayBetByTarget).filter((v) => v > 0).length;
    if ((displayBetByTarget[targetKey] ?? 0) <= 0 && distinctBetBoxes >= 6) {
      Alert.alert("You can't bet on more than 6 boxes");
      return;
    }
    // BALANCE GUARD (boss 2026-10-26 03:21: rapid taps must never drop the
    // chip): the wallet subscription lags bot debits, so `balance` alone
    // still covers taps the bot has not charged yet. Subtract every
    // still-unresolved optimistic tap (display − paid per target, same
    // derivation as the chip) before comparing — an over-balance rapid
    // tap is blocked BEFORE any entry exists, so its chip never appears
    // and therefore never has to come back down.
    const pendingTotal = Object.keys(displayBetByTarget).reduce((s, k) => s + Math.max(0, (displayBetByTarget[k] ?? 0) - (myBetByTarget[k] ?? 0)), 0);
    if (balance - pendingTotal < selectedAmount) {
      Alert.alert('Not enough diamonds', 'Your diamond balance is lower than the selected bet amount.');
      return;
    }
    setPlacing(true);
    // BET CHIP optimistic add (boss 01:37: tap → chip updates in the
    // same frame, no network wait). The entry reconciles when the
    // subscription confirms the bet, rolls back at once on write
    // failure, and lives until the round changes — there is NO
    // mid-round expiry (boss 2026-10-26 03:21: rapid taps must never
    // drop the chip): a burst tap charged late at settle (up to ~38s
    // after the tap) used to hit the old 15s expiry and drop the chip
    // mid-round, then jump back up at settle. Entries clear on round
    // change (optByTarget resets on roundN), so no phantom can stick
    // past its round either.
    optIdRef.current += 1;
    const optId = optIdRef.current;
    const dropOptEntry = () => {
      setOptByTarget((prev) => {
        const q = prev[targetKey];
        if (!q) return prev;
        const entries = q.entries.filter((e) => e.id !== optId);
        if (entries.length === q.entries.length) return prev;
        return { ...prev, [targetKey]: { baseline: q.baseline, rejectedBaseline: q.rejectedBaseline ?? 0, entries } };
      });
    };
    setOptByTarget((prev) => {
      const q = prev[targetKey];
      const baseline = q && q.entries.length > 0 ? q.baseline : (myBetByTarget[targetKey] ?? 0);
      const rejectedBaseline = q && q.entries.length > 0 ? (q.rejectedBaseline ?? 0) : (myRejectedByTarget[targetKey] ?? 0);
      return { ...prev, [targetKey]: { baseline, rejectedBaseline, entries: [...(q?.entries ?? []), { id: optId, amount: selectedAmount }] } };
    });
    try {
      await placeDeliciousBet(round.n, myUid, kind, target, selectedAmount);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (e) {
      dropOptEntry();
      Alert.alert('Bet failed', e instanceof Error ? e.message : 'Could not place the bet. Please try again.');
    } finally {
      setPlacing(false);
    }
  }, [round, bettingOpen, bettingIntakeClosed, placing, displayBetByTarget, myBetByTarget, myRejectedByTarget, selectedAmount, balance, myUid]);

  // PREVIEW SPOKES: thin lines from the hub centre to each tile
  // centre, preview style (#FF5A3C at 0.4 opacity). Rendered BEFORE
  // the tiles and the hub, so both cover the spoke ends and only the
  // hub-edge-to-tile-edge segment shows — exactly like the preview.
  function renderSpoke(foodId: DeliciousFoodId) {
    return <SpokeView key={`spoke-${foodId}`} foodId={foodId} />;
  }

  function renderFoodTile(foodId: DeliciousFoodId) {
    const food = effFoodMap[foodId];
    return (
      <FoodTileView
        key={foodId}
        food={food}
        rect={TILE_RECTS[foodId]}
        isWinner={phase === 'result' && round?.winningFood === foodId}
        isSpinning={spinHighlight === foodId}
        spinActive={spinHighlight != null}
        resultDimmed={phase === 'result' && round?.winningFood !== foodId}
        myBet={displayBetByTarget[`food:${foodId}`] ?? 0}
        myPending={Math.max(0, (displayBetByTarget[`food:${foodId}`] ?? 0) - (myBetByTarget[`food:${foodId}`] ?? 0))}
        onBet={onBetTarget}
      />
    );
  }

  // HOT BADGE render: a SIBLING of the tiles, not inside one — tiles
  // have overflow hidden, so a badge above a tile would clip. Rendered
  // in the wheel container (which is overflow visible; the panel still
  // bounds everything). pointerEvents="none" so it can never block the
  // tile's bet tap. Positioned above the hot tile's rect; the top is
  // deliberately NOT clamped to 0 — for a top-row tile the badge sits
  // in the header row's empty centre, clear of the X/History/balance
  // controls. zIndex 3 keeps it above tiles (spin uses 2).
  function renderHotBadge() {
    if (!hotFoodId) return null;
    const r = tileRect(hotFoodId);
    const BADGE_W = 48;
    const left = Math.min(Math.max(r.cx - BADGE_W / 2, 0), WHEEL_W - BADGE_W);
    return (
      <View
        key="hot-badge"
        pointerEvents="none"
        style={{ position: 'absolute', left, top: r.top - 24, width: BADGE_W, alignItems: 'center', zIndex: 3 }}
      >
        <View style={{ backgroundColor: '#FF6B35', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
          <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '900' }}>Hot</Text>
        </View>
        <View style={{ width: 8, height: 8, backgroundColor: '#FF6B35', transform: [{ rotate: '45deg' }], marginTop: -4 }} />
      </View>
    );
  }

  function renderSide(sideId: DeliciousSideId, align: 'left' | 'right') {
    const side = effSideMap[sideId];
    const isWinner = phase === 'result' && round?.winningSide === sideId;
    const dimmed = phase === 'result' && round?.winningSide !== sideId;
    const mySideBet = displayBetByTarget[`side:${sideId}`] ?? 0;
    const mySidePending = Math.max(0, mySideBet - (myBetByTarget[`side:${sideId}`] ?? 0));
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
          {/* BET CHIP (boss 01:34): the user's OWN total bet on this
              side, ON the side circle itself — bottom edge, inside the
              circle, so it never touches the name / multiplier lines
              below. Visible in every phase while the total > 0. */}
          {mySideBet > 0 && (
            <View style={{ position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center' }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#3D0A0A', borderWidth: 1, borderColor: '#FFD43B',
                borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2,
              }}>
                <DiamondIcon size={11} />
                <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 12, fontWeight: '800', marginLeft: 3 }}>{formatNum(mySideBet)}</Text>
              </View>
            </View>
          )}
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFF', fontSize: 14, fontWeight: '800', marginTop: 2 }}>{side.name}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFD43B', fontSize: 12, fontWeight: '800' }}>{side.multiplier}×</Text>
        {mySidePending > 0 && (
          <Text style={{ color: '#FFD43B', fontSize: 10, fontWeight: '800', marginTop: 1 }}>confirming…</Text>
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

        {/* F1 rejection notice: brief, non-blocking, auto-dismisses. */}
        {rejectNotice != null && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 52, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
            <View style={{ backgroundColor: '#3D0A0A', borderWidth: 1, borderColor: '#FFD43B', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: '#FFD43B', fontSize: 12, fontWeight: '800' }}>{rejectNotice}</Text>
            </View>
          </View>
        )}

        {/* Wheel: spokes (behind) + tiles + Hot badge + centre circle (hub).
            overflow visible so the Hot badge can sit above a top-row tile. */}
        <View style={{ height: WHEEL_H, marginTop: 2, overflow: 'visible' }}>
          {DELICIOUS_FOODS.map((f) => renderSpoke(f.id))}
          {DELICIOUS_FOODS.map((f) => renderFoodTile(f.id))}
          {renderHotBadge()}
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

        {/* Sides — Regular pill REMOVED (boss 2026-10-26 02:06).
            Salad left, Pizza right, clean gap in the middle. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', height: 108, marginTop: 2 }}>
          {renderSide('salad', 'left')}
          {renderSide('pizza', 'right')}
        </View>

        {/* TOP-10 LIVE STRIP (boss 2026-10-26 02:06, compacted 02:17):
            small cards, horizontal scroll, live from todayPrize. Shown
            in EVERY phase. Empty (no winners yet) = one honest line,
            never a placeholder card. */}
        <View style={{ marginTop: 2, marginBottom: 2 }}>
          <Text style={{ color: '#FFD43B', fontSize: 13, fontWeight: '800', height: 18 }}>Top 10 Live</Text>
          {top10.length === 0 ? (
            <View style={{ height: 80, justifyContent: 'center' }}>
              <Text style={{ color: '#FFD9D9', fontSize: 12 }}>No winners yet today</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ height: 80 }}
              contentContainerStyle={{ paddingTop: 7 }}
            >
              {top10.map((t, i) => (
                <Top10Card
                  key={t.uid}
                  rank={i + 1}
                  name={profiles[t.uid]?.name ?? null}
                  photo={profiles[t.uid]?.photo ?? null}
                  total={t.total}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* Bet chips: amount first, then a food/side. */}
        <View style={{ flexDirection: 'row', gap: 6, height: 44 }}>
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
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 17, fontWeight: '800', color: '#1F2937', marginLeft: 4 }}>{formatChipLabel(chip)}</Text>
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
                  {/* STREAK BONUS (boss 2026-10-26 01:24, bot v7 live):
                      the Pass 3.5 bonus credited for this round, if
                      any. Missing = no line, never a crash. */}
                  {myBonus != null && myBonus.amount > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ color: '#FFD43B', fontSize: 16, fontWeight: '800' }}>Streak bonus +</Text>
                      <DiamondIcon size={16} />
                      <Text style={{ color: '#FFD43B', fontSize: 16, fontWeight: '800' }}> {formatNum(myBonus.amount)}</Text>
                    </View>
                  )}
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
                <Text style={{ color: '#FFD9D9', fontSize: 13, marginTop: 12 }}>No winners this round</Text>
              )}
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}
