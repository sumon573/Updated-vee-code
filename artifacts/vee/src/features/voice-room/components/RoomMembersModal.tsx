/**
 * RoomMembersModal — Live Audience, now the room's Rank page.
 *
 * Boss 2026-11-12 14:23–14:27 (five messages): "Live অডিয়েন্স পেজটা
 * পরিবর্তন করে এই পেজটা হবে, এটা রুমের রেংক" + "এই রুমে যে যত ব্যাংক সে
 * আগে লাইফ অডিয়েন্সে দেখাবে" + "Rank" + "যে যত বেশি ডায়মন্ড সেন্ডিং
 * করেছে এবং বেশি সময় দিয়েছে অথবা যার আইডি বেশি বড়, SVIP-দের
 * প্রায়োরিটি বেশি" + "rank অনুযায়ী যার আইডি যেমন সে আগে পরে এভাবে" +
 * "Page টা এরকমই হবে" (imo Room Rank screenshot, re-sent 14:27).
 *
 * The page is the imo Room Rank layout, exactly: the room stays visible
 * above a dark bottom sheet with three tabs (Online Rank / Weekly Rank /
 * Total Rank), a subtitle + "?" per tab, rank rows (rank number, DP, name,
 * badges below the name), and a pinned own-rank bar at the bottom.
 * Online Rank is the default tab and shows ONLY users live in this room
 * (= the Live Audience). Weekly/Total may show users not currently live.
 *
 * Ranking inside every tab is lexicographic, highest first (boss's order,
 * recorded so he can correct it):
 *   1. SVIP tier (5 → 1, then non-SVIP) — svip/{uid}.tier, one-shot get.
 *   2. Gift value in the tab's window — rooms/{roomId}/giftEvents, sum
 *      `coins` by `fromUid` (SENDER — "ডায়মন্ড সেন্ডিং করেছে", imo
 *      "contributed BY"). Online = all-time value of live users;
 *      Weekly = ts >= ISO week start (Monday 00:00 UTC); Total = all-time.
 *   3. Time in this room — roomMembers/{roomId}/{uid}.joinedAt
 *      (ms epoch); duration = now - joinedAt. The record is deleted on a
 *      real leave, so it is the current stay. Non-live users = 0.
 *   4. Existing member order (owner → admin → activity) as tiebreak.
 * Owner is NOT pinned first — pure rank order per his words ("rank
 * অনুযায়ী"). If he wants the owner pinned, it is a one-line change.
 *
 * Honest limit (recorded, not hidden): rooms/{roomId}/giftEvents is
 * trimmed to the last 50 events by VeeGuard, so Total/Weekly sums cover
 * only the retained events — exact for rooms with ≤50 gifts ever, older
 * gifts undercounted in busier rooms. No per-user per-room weekly
 * aggregation exists (global leaderboard_senders/{weekId} is all-rooms;
 * leaderboard_rooms/{weekId} is a per-room total, not per-user).
 *
 * What stays from the Live Audience redesign (boss 2026-11-11 22:44):
 * the 👤 role icon before the name (Feather "user", Owner GOLD #FFB300 /
 * Admin BLUE #42A5F5 / Member GREY #8A8A8E), the Muted/Speaking status,
 * the mic / mic-off icon, and row tap → profile popup. Badges below the
 * name are the user's top 2 granted badges (one-shot users/{uid}/badges,
 * Honor badge-order rule, expired/icon-less filtered out).
 *
 * Dark sheet (#000000, exactly like imo) — this supersedes the
 * 2026-10-23 light-theme order for this page. Sheet structure follows
 * RoomRankModal (Modal transparent + backdrop tap to close + drag
 * handle). No X button in the sheet (imo has none).
 *
 * All data is real (Firebase giftEvents + roomMembers + svip + badges).
 * No demo entries. Reads are one-shot gets when the sheet opens (no live
 * subscription, no poll, no interval); the sort is pure in-memory.
 */

import {
  memo, useCallback, useEffect, useMemo, useState,
} from 'react';
import {
  View, Text, Modal, Pressable, FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import type { Participant } from '@/src/features/voice-room/types/room';
import { VerifiedName } from '@/src/components/VerifiedName';
import { useIsKing } from '@/src/hooks/useNobleRank';
import { KingSparkle, KING_GOLD } from './KingShimmerName';
import type { GrantedBadge } from '@/src/data/honor';

import { C } from '../constants/theme';

type RankTab = 'online' | 'weekly' | 'total';

type Props = {
  visible: boolean;
  onClose: () => void;
  ownerId: string;
  /** NEW (rank page): room id for the one-shot giftEvents / roomMembers reads. */
  roomId: string;
  /** NEW (rank page): viewer's uid + name for the pinned own-rank bar. */
  myUid: string | null;
  myName: string | null;
  seats: (Participant | null)[];
  audience: Participant[];
  onManageMember: (m: Participant) => void;
};

// Dark sheet colours — the imo Room Rank sheet, exactly. (The old Live
// Audience page was light per the 2026-10-23 order; the boss's 14:27
// "Page টা এরকমই হবে" supersedes it with the dark imo design.)
const SHEET_BG = '#000000';
const SHEET_TEXT = '#FFFFFF';
const SHEET_SUB = '#AEAEB2';
const SHEET_MUTED = '#8E8E93';
const SHEET_DIVIDER = '#1C1C1E';
const SHEET_TAB_BLUE = '#2E7CF6';
const SHEET_GOLD = '#F59E0B';
const SHEET_PINNED_BG = '#1C1C1E';
const SHEET_MIC = '#4ADE80';
const SHEET_MIC_OFF = '#EF4444';

const RANK_MEDAL_COLORS = ['#F59E0B', '#94A3B8', '#B45309'];

function MemberAvatar({ p }: { p: Participant }) {
  if (p.photoURL) {
    return (
      <Image
        source={{ uri: p.photoURL }}
        style={{ width: 46, height: 46, borderRadius: 23 }}
        cachePolicy="memory-disk"
        recyclingKey={p.id}
      />
    );
  }
  return (
    <View style={{
      width: 46, height: 46, borderRadius: 23, backgroundColor: p.color || C.primary,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{p.initials}</Text>
    </View>
  );
}

// 2026-11-11 (boss, Live Audience redesign): the role is recognised by the
// 👤 ICON before the name — never by text ("লেখা না আইকন এ চেনা যাবে").
// Colours are the polished members-list colours (RoomInfoModal roleColor):
// GOLD = room owner ONLY, BLUE = admin, GREY = regular member. The icon is
// a clean vector (Feather "user"), never a raw 👤 emoji glyph. Kept
// unchanged by the 2026-11-12 rank-page order (boss confirmed 22:44).
const ROLE_ICON_GOLD = '#FFB300';
const ROLE_ICON_BLUE = '#42A5F5';
const ROLE_ICON_GREY = '#8A8A8E';

function RoleIcon({ role, isOwner }: { role: 'host' | 'admin' | 'member'; isOwner: boolean }) {
  const color = (isOwner || role === 'host') ? ROLE_ICON_GOLD
    : (role === 'admin' ? ROLE_ICON_BLUE : ROLE_ICON_GREY);
  return (
    <View style={{ marginRight: 6, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="user" size={15} color={color} />
    </View>
  );
}

// Rank number — top 3 get gold/silver/bronze medal circles (same as
// RoomRankModal's RankBadge); 4+ get a grey number. imo shows "-" for an
// unranked user; Vee shows the real rank number for every ranked row.
function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) {
    return (
      <View style={{ width: 28, alignItems: 'center' }}>
        <Text style={{ color: SHEET_MUTED, fontSize: 14, fontWeight: '800' }}>{rank}</Text>
      </View>
    );
  }
  return (
    <View style={{
      width: 26, height: 26, borderRadius: 13, backgroundColor: RANK_MEDAL_COLORS[rank - 1],
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>{rank}</Text>
    </View>
  );
}

function fmtCompact(n: number): string {
  if (n >= 999_500_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 999_500) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 999.5) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return `${n}`;
}

// ISO 8601 week start: Monday 00:00 UTC of the week containing `nowMs`.
// Matches getCurrentWeekId (src/utils/weekId.ts — ISO week, UTC-based).
function getWeekStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dayNum - 1), 0, 0, 0, 0);
}

type RankRowData = {
  p: Participant;
  /** Gift value (diamonds sent) in this tab's window. */
  sent: number;
  /** True when the user is live in the room right now. */
  isLive: boolean;
  /** Final tiebreak: index in the live member order (non-live = last). */
  tie: number;
};

const MemberRow = memo(function MemberRow({
  item, rank, sent, isLive, badges, ownerId, onPress, notInRoomText,
}: {
  item: Participant;
  rank: number;
  sent: number;
  isLive: boolean;
  badges: GrantedBadge[];
  ownerId: string;
  onPress: (p: Participant) => void;
  notInRoomText: string;
}) {
  // 2026-11-01 (batch56): King gold + shimmer on member names.
  const isKing = useIsKing((item as any).uid || item.id);
  // 2026-11-11 (boss, Live Audience redesign): GOLD = this row IS the room
  // owner (uid === ownerId) or role 'host' — same rule as RoomInfoModal.
  const isOwner = item.id === ownerId;
  const status = isLive
    ? (item.speaking ? 'Speaking…' : (item.muted || item.hostMuted) ? 'Muted' : 'In room')
    : notInRoomText;
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: SHEET_DIVIDER,
      }}
    >
      <View style={{ width: 28, alignItems: 'center', justifyContent: 'center' }}>
        <RankBadge rank={rank} />
      </View>
      <View style={{ marginLeft: 8 }}>
        <MemberAvatar p={item} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <RoleIcon role={item.role} isOwner={isOwner} />
          <View style={{ flexShrink: 1 }}>
            <VerifiedName
              name={item.name}
              uid={(item as any).uid || (item as any).id}
              nameStyle={{ color: isKing ? KING_GOLD : SHEET_TEXT, fontSize: 15, fontWeight: '700', flexShrink: 1 }}
              logoSize={15}
            />
          </View>
          {isKing ? <KingSparkle /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text style={{ color: SHEET_MUTED, fontSize: 12 }}>
            {status}
          </Text>
          {badges.map((b) => (
            <Image
              key={b.id}
              source={{ uri: b.icon }}
              style={{ width: 18, height: 18, borderRadius: 4, marginLeft: 6 }}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={b.id}
            />
          ))}
        </View>
      </View>
      <View style={{
        marginLeft: 8, alignItems: 'flex-end', justifyContent: 'center',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <DiamondIcon size={14} />
          <Text style={{ color: SHEET_GOLD, fontSize: 14, fontWeight: '800', marginLeft: 3 }}>
            {fmtCompact(sent)}
          </Text>
        </View>
        {isLive ? (
          <View style={{ marginTop: 5 }}>
            {(item.muted || item.hostMuted)
              ? <Feather name="mic-off" size={16} color={SHEET_MIC_OFF} />
              : <Feather name="mic" size={16} color={SHEET_MIC} />}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export default function RoomMembersModal({
  visible, onClose, ownerId, roomId, myUid, myName, seats, audience, onManageMember,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RankTab>('online');

  // Rank factors — all one-shot, loaded when the sheet opens. Fresh-at-open
  // (like RoomRankModal's Contribution load); the list itself stays live
  // for membership via the `all` memo below.
  const [sentTotal, setSentTotal] = useState<Map<string, number>>(new Map());
  const [sentWeek, setSentWeek] = useState<Map<string, number>>(new Map());
  const [senderMeta, setSenderMeta] = useState<Map<string, { name: string; photoURL?: string | null }>>(new Map());
  const [joinedAt, setJoinedAt] = useState<Map<string, number>>(new Map());
  const [svipTier, setSvipTier] = useState<Map<string, number>>(new Map());
  const [badgeMap, setBadgeMap] = useState<Map<string, GrantedBadge[]>>(new Map());

  const seatMembers = useMemo(
    () => seats.filter((s): s is Participant => s !== null),
    [seats],
  );

  const all = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of [...seatMembers, ...audience]) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return [...map.values()];
  }, [seatMembers, audience]);

  const liveIds = useMemo(() => new Set(all.map((p) => p.id)), [all]);

  // Factor data — one-shot gets when the sheet opens. `all` is intentionally
  // NOT in the dep list: the SVIP fetch uses the OPEN-TIME member snapshot
  // (a member who joins while the sheet is open ranks with tier 0 / sent 0 /
  // time 0 until the next open — same fresh-at-open rule as RoomRankModal).
  useEffect(() => {
    if (!visible || !roomId) return;
    let cancelled = false;
    (async () => {
      try {
        const [giftSnap, memberSnap] = await Promise.all([
          get(ref(database, `rooms/${roomId}/giftEvents`)).catch(() => null),
          get(ref(database, `roomMembers/${roomId}`)).catch(() => null),
        ]);
        if (cancelled) return;
        const total = new Map<string, number>();
        const week = new Map<string, number>();
        const meta = new Map<string, { name: string; photoURL?: string | null }>();
        const weekStart = getWeekStartMs(Date.now());
        if (giftSnap?.exists()) {
          giftSnap.forEach((c) => {
            const v = c.val() as {
              fromUid?: string; coins?: number; ts?: number;
              fromName?: string; fromAvatar?: string | null;
            };
            if (typeof v.fromUid !== 'string' || typeof v.coins !== 'number') return;
            total.set(v.fromUid, (total.get(v.fromUid) ?? 0) + v.coins);
            if (typeof v.ts === 'number' && v.ts >= weekStart) {
              week.set(v.fromUid, (week.get(v.fromUid) ?? 0) + v.coins);
            }
            if (!meta.has(v.fromUid) && typeof v.fromName === 'string') {
              meta.set(v.fromUid, { name: v.fromName, photoURL: v.fromAvatar ?? null });
            }
          });
        }
        const joined = new Map<string, number>();
        if (memberSnap?.exists()) {
          memberSnap.forEach((c) => {
            const v = c.val() as { joinedAt?: number };
            if (typeof v.joinedAt === 'number' && v.joinedAt > 0) {
              joined.set(c.key as string, v.joinedAt);
            }
          });
        }
        // SVIP tiers for the candidate set (live members + gift senders).
        // One-shot get per uid, cached in state for this open. An inactive
        // or expired SVIP counts as tier 0 (same rule as getActiveSvipTier).
        const candidates = new Set<string>([...all.map((p) => p.id), ...total.keys()]);
        const tiers = new Map<string, number>();
        await Promise.all([...candidates].map(async (uid) => {
          try {
            const s = await get(ref(database, `svip/${uid}`));
            const v = s.val();
            if (v && typeof v.tier === 'number') {
              const active = typeof v.expiry !== 'number' || v.expiry > Date.now();
              tiers.set(uid, active ? v.tier : 0);
            }
          } catch { /* tier 0 */ }
        }));
        if (cancelled) return;
        setSentTotal(total);
        setSentWeek(week);
        setSenderMeta(meta);
        setJoinedAt(joined);
        setSvipTier(tiers);
      } catch { /* every factor defaults to 0 — the list still renders */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, roomId]);

  // Ranked rows — pure in-memory sort. Re-sorts live as `all` changes
  // (members join/leave) and when factor data lands.
  const ranked = useMemo<RankRowData[]>(() => {
    const now = Date.now();
    const timeOf = (uid: string): number => {
      const j = joinedAt.get(uid);
      return (typeof j === 'number' && j > 0) ? Math.max(0, now - j) : 0;
    };
    const tierOf = (uid: string): number => svipTier.get(uid) ?? 0;
    const cmp = (a: RankRowData, b: RankRowData): number => {
      const ta = tierOf(a.p.id);
      const tb = tierOf(b.p.id);
      if (ta !== tb) return tb - ta;
      if (a.sent !== b.sent) return b.sent - a.sent;
      const da = timeOf(a.p.id);
      const db = timeOf(b.p.id);
      if (da !== db) return db - da;
      return a.tie - b.tie;
    };
    if (tab === 'online') {
      // Live Audience: EVERYONE live in the room, ranked. Zero-diamond /
      // zero-time / non-SVIP members appear at the bottom — nobody hidden.
      return all
        .map((p, i) => ({ p, sent: sentTotal.get(p.id) ?? 0, isLive: true, tie: i }))
        .sort(cmp);
    }
    // Weekly / Total: only users who sent gifts in the window (rank
    // history — may include users not live right now).
    const src = tab === 'weekly' ? sentWeek : sentTotal;
    const rows: RankRowData[] = [];
    src.forEach((sent, uid) => {
      if (sent <= 0) return;
      const liveIdx = all.findIndex((p) => p.id === uid);
      if (liveIdx >= 0) {
        rows.push({ p: all[liveIdx], sent, isLive: true, tie: liveIdx });
      } else {
        const meta = senderMeta.get(uid);
        const name = meta?.name || t('voiceRoom.rank.unknown');
        rows.push({
          p: {
            id: uid,
            name,
            initials: (name || '?').slice(0, 1),
            color: C.primary,
            photoURL: meta?.photoURL ?? undefined,
            speaking: false,
            muted: false,
            hostMuted: false,
            role: 'member',
          },
          sent,
          isLive: false,
          // Non-live rows tie-break by first-gift order (Map insertion
          // order — Array.sort is stable), after all live rows on a tie.
          tie: Number.MAX_SAFE_INTEGER,
        });
      }
    });
    return rows.sort(cmp);
  }, [tab, all, sentTotal, sentWeek, joinedAt, svipTier, senderMeta, t]);

  // Badges for the top 50 ranked rows — display only, never affects order.
  // One-shot users/{uid}/badges per uid, top 2 by the Honor badge-order
  // rule (rankBadges), expired/icon-less filtered out (same filters as
  // subscribeBadges). Cached in state for this open.
  useEffect(() => {
    if (!visible) return;
    const top = ranked.slice(0, 50);
    const missing = top.map((r) => r.p.id).filter((uid) => !badgeMap.has(uid));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { rankBadges, isStillValid } = await import('@/src/services/badgeService');
        const next = new Map(badgeMap);
        await Promise.all(missing.map(async (uid) => {
          try {
            const s = await get(ref(database, `users/${uid}/badges`));
            const v = s.val();
            if (!v || typeof v !== 'object') { next.set(uid, []); return; }
            const items = (Object.values(v) as GrantedBadge[])
              .filter((b) => b && typeof b.icon === 'string' && isStillValid((b as any).validity));
            next.set(uid, rankBadges(items).slice(0, 2));
          } catch { next.set(uid, []); }
        }));
        if (!cancelled) setBadgeMap(next);
      } catch { /* badges stay empty — rows still render */ }
    })();
    return () => { cancelled = true; };
  }, [visible, ranked, badgeMap]);

  // Pinned own-rank bar (imo: grey bar, always visible at the bottom).
  const myRank = useMemo(
    () => (myUid ? ranked.findIndex((r) => r.p.id === myUid) + 1 : -1),
    [ranked, myUid],
  );
  const myRow = myRank > 0 ? ranked[myRank - 1] : null;
  const myLive = myUid ? all.find((p) => p.id === myUid) ?? null : null;
  const myMeta = myUid ? senderMeta.get(myUid) : undefined;
  const myDisplayName = myLive?.name ?? myMeta?.name ?? myName ?? t('voiceRoom.rank.you');
  const myParticipant: Participant = myLive ?? {
    id: myUid ?? 'me',
    name: myDisplayName,
    initials: (myDisplayName || '?').slice(0, 1),
    color: C.primary,
    photoURL: myMeta?.photoURL ?? undefined,
    speaking: false,
    muted: false,
    hostMuted: false,
    role: 'member',
  };

  const TAB_NAMES: Record<RankTab, string> = {
    online: t('voiceRoom.rank.tab_online_rank'),
    weekly: t('voiceRoom.rank.tab_weekly_rank'),
    total: t('voiceRoom.rank.tab_total_rank'),
  };
  const SUBTITLES: Record<RankTab, string> = {
    online: t('voiceRoom.rank.subtitle_online'),
    weekly: t('voiceRoom.rank.subtitle_weekly'),
    total: t('voiceRoom.rank.subtitle_total'),
  };
  const EMPTY_TEXT: Record<RankTab, string> = {
    online: t('voiceRoom.rank.empty_online'),
    weekly: t('voiceRoom.rank.empty_weekly'),
    total: t('voiceRoom.rank.empty'),
  };

  const handleMemberPress = useCallback((p: Participant) => {
    onClose();
    onManageMember(p);
  }, [onClose, onManageMember]);

  const handleTabPress = useCallback((k: RankTab) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTab(k);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      {/* Bottom sheet over the room (RoomRankModal pattern) — black, like imo. */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '75%',
        backgroundColor: SHEET_BG, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      }}>
        <View style={{ paddingBottom: 28 }}>
          <View style={{
            width: 40, height: 4, borderRadius: 2,
            backgroundColor: '#3A3A3C', alignSelf: 'center', marginTop: 10,
          }} />
          {/* Tabs — imo style: text tabs, blue underline under the selected one. */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 8 }}>
            {(['online', 'weekly', 'total'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => handleTabPress(k)}
                style={{
                  flex: 1, alignItems: 'center', paddingVertical: 8,
                  borderBottomWidth: 2,
                  borderBottomColor: tab === k ? SHEET_TAB_BLUE : 'transparent',
                }}
              >
                <Text style={{
                  fontSize: 16, fontWeight: '600',
                  color: tab === k ? SHEET_TAB_BLUE : SHEET_MUTED,
                }}>
                  {TAB_NAMES[k]}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* Subtitle + "?" — imo verbatim for Online, equivalents for Weekly/Total. */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: SHEET_DIVIDER,
          }}>
            <Text style={{ flex: 1, color: SHEET_SUB, fontSize: 13, lineHeight: 19 }}>
              {SUBTITLES[tab]}
            </Text>
            <View style={{
              width: 22, height: 22, borderRadius: 11, marginLeft: 8,
              borderWidth: 1.5, borderColor: SHEET_MUTED,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: SHEET_SUB, fontSize: 13, fontWeight: '700' }}>?</Text>
            </View>
          </View>

          <FlatList
            data={ranked}
            keyExtractor={(r) => `m:${r.p.id}`}
            renderItem={({ item, index }) => (
              <MemberRow
                item={item.p}
                rank={index + 1}
                sent={item.sent}
                isLive={item.isLive}
                badges={badgeMap.get(item.p.id) ?? []}
                ownerId={ownerId}
                onPress={handleMemberPress}
                notInRoomText={t('voiceRoom.rank.not_in_room')}
              />
            )}
            windowSize={9}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            removeClippedSubviews
            updateCellsBatchingPeriod={50}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                <Feather name="users" size={40} color={SHEET_MUTED} />
                <Text style={{ color: SHEET_MUTED, fontSize: 14, marginTop: 12 }}>
                  {EMPTY_TEXT[tab]}
                </Text>
              </View>
            }
          />

          {/* Pinned own-rank bar — always visible (imo: grey bar at the bottom). */}
          {myUid ? (
            <View style={{
              marginHorizontal: 16, marginTop: 10, backgroundColor: SHEET_PINNED_BG,
              borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center',
            }}>
              {myRank > 0 ? (
                <RankBadge rank={myRank} />
              ) : (
                <View style={{ width: 28, alignItems: 'center' }}>
                  <Text style={{ color: SHEET_MUTED, fontSize: 14, fontWeight: '800' }}>—</Text>
                </View>
              )}
              <View style={{ marginLeft: 8 }}>
                <MemberAvatar p={myParticipant} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: SHEET_MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
                  {t('voiceRoom.rank.your_rank')}
                </Text>
                <Text style={{ color: SHEET_TEXT, fontSize: 15, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
                  {myDisplayName}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DiamondIcon size={14} />
                <Text style={{ color: SHEET_GOLD, fontSize: 14, fontWeight: '800', marginLeft: 3 }}>
                  {fmtCompact(myRow ? myRow.sent : 0)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
