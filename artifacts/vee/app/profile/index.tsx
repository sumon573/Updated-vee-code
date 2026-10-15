/**
 * Profile — IMO-style (light mode)
 * Exact IMO layout: cover, avatar, badges, sections, Edit button
 * All data real from Firebase; all buttons functional
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Alert, Modal, Image, Pressable, FlatList, Animated } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import MistNameplate from '@/src/components/MistNameplate';
import { NOBLE_REWARDS_CATALOG } from '@/src/services/nobleRewardsCatalog';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, getUser, VeeUser } from '@/src/services/userService';
import { uploadProfilePhoto, deleteCloudinaryAsset } from '@/src/services/cloudinaryService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import { subscribeBadges, subscribeFrames, subscribeNameplates, type GrantedFrame, type GrantedNameplate } from '@/src/services/badgeService';
import { hasOfficialBadge, getOfficialBadgeIconUrl } from '@/src/services/verifiedService';
import { GrantedBadge } from '@/src/data/honor';
import { subscribeFollowCounts, followUser, unfollowUser, subscribeIsFollowing } from '@/src/services/followService';
import {
  sendFriendRequest, cancelFriendRequest, acceptFriendRequest, rejectFriendRequest,
  subscribeFriendStatus, FriendStatus } from '@/src/services/friendRequestService';
import { buildChatId } from '@/src/features/chat/services/firebaseDmService';
import {
  unblockUser, getBlockDirection,
  subscribeBlockedUsers, BlockDirection } from '@/src/services/blockService';
import { subscribeMyRoomsCombined } from '@/src/features/voice-room/services/firebaseRoomService';
import { usePrivateRoomGate } from '@/src/components/PrivateRoomGate';
import AnimatedFrame from '@/src/components/AnimatedFrame';
import { subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import { subscribeNoble, NOBLE_RANKS, type NobleState } from '@/src/services/nobleService';
import { useTranslation } from 'react-i18next';

// Gift emojis — canonical catalog, matches api-server GIFT_CATALOG + GiftsModal
const GIFTS: Record<string, string> = {
  '1': '💝', '2': '🌹', '3': '🎁', '4': '💎',
  '5': '🏆', '6': '🚀', '7': '👑', '8': '🎆' };

// Gift diamond prices (for ranking "big gifts" in the 1-line preview)
const GIFT_RANK_PRICE: Record<string, number> = {
  '1': 10, '2': 25, '3': 50, '4': 100,
  '5': 200, '6': 500, '7': 1000, '8': 2000 };

// IMO light-mode colors
const C = {
  bg: '#FFFFFF',
  text: '#000000',
  muted: '#8E8E93',
  mutedLight: '#C7C7CC',
  border: '#E5E5EA',
  card: '#F2F2F7',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  green: '#34C759' } as const;

// ─── Section Header (IMO style: title left, count + arrow right) ───

function SectionHeader({ title, count, onPress }: { title: string; count?: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {count !== undefined && (
          <Text style={{ fontSize: 15, color: C.muted, marginRight: 4 }}>{count}</Text>
        )}
        <Feather name="chevron-right" size={18} color={C.mutedLight} />
      </View>
    </Pressable>
  );
}

// ─── Badge Pill (IMO style) ───

// ─── Premium Level Badge (2026-10-12, Sumon concept) ───
// Tiers: 1-30 Bronze, 31-60 Silver, 61-99 Gold, 100 Max.
// Each tier has its own premium gradient; the level NUMBER shows inside.
// Subtle drifting mist particles (winter-fog style) for the premium feel.
// Level grows SLOWLY from diamond sending + voice-room activity.

export type LevelTier = 'bronze' | 'silver' | 'gold' | 'max';

export function getLevelTier(level: number): LevelTier {
  if (level >= 100) return 'max';
  if (level >= 61) return 'gold';
  if (level >= 31) return 'silver';
  return 'bronze';
}

const TIER_STYLE: Record<LevelTier, { colors: [string, string, string]; label: string; glow: string }> = {
  bronze: {
    colors: ['#8C6239', '#CD7F32', '#F0B46A'],
    label: 'Bronze',
    glow: 'rgba(205,127,50,0.35)' },
  silver: {
    colors: ['#7E8FA0', '#B8C6D4', '#EDF2F7'],
    label: 'Silver',
    glow: 'rgba(184,198,212,0.4)' },
  gold: {
    colors: ['#9A6B0F', '#E8B91A', '#FFE873'],
    label: 'Gold',
    glow: 'rgba(232,185,26,0.45)' },
  max: {
    colors: ['#5B1A9E', '#9D4EDD', '#FFD700'],
    label: 'Max',
    glow: 'rgba(157,78,221,0.5)' } };

/** One drifting mist particle. */
function MistParticle({ delay, size, left, duration }: { delay: number; size: number; left: number; duration: number }) {
  const drift = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(drift, { toValue: -1, duration, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(fade, { toValue: 0.55, duration: duration * 0.4, useNativeDriver: true }),
            Animated.timing(fade, { toValue: 0, duration: duration * 0.6, useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(drift, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, duration, drift, fade]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        bottom: 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#FFFFFF',
        opacity: fade,
        transform: [{ translateY: drift.interpolate({ inputRange: [-1, 0], outputRange: [-22, 0] }) }] }}
    />
  );
}

function LevelBadge({ level }: { level: number }) {
  const tier = getLevelTier(level);
  const style = TIER_STYLE[tier];
  // 2026-10-12 (Sumon): SAME SIZE as Nobel/Follower pills. Single-line
  // "Bronze Lv 17" format. Premium gradient kept, mist particles removed
  // for the compact size.
  return (
    <View style={{ marginRight: 6, marginBottom: 6 }}>
      <LinearGradient
        colors={style.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 12,
          paddingHorizontal: 10,
          paddingVertical: 5,
          flexDirection: 'row',
          alignItems: 'center',
          overflow: 'hidden' }}
      >
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
          {style.label} Lv {level}
        </Text>
      </LinearGradient>
    </View>
  );
}

function BadgePill({ label, icon }: { label: string; icon?: string }) {
  return (
    <View style={{
      backgroundColor: C.card, borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, marginBottom: 6,
      flexDirection: 'row', alignItems: 'center' }}>
      {icon && <Text style={{ fontSize: 12, marginRight: 4 }}>{icon}</Text>}
      <Text style={{ fontSize: 12, color: C.muted, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

// 2026-10-15 (Sumon): Nobel rank helpers — the profile pill must show the
// ACTUAL rank (name + sub-level like "Knight I") in the rank's own color.
// Previously the pill was hardcoded purple and never changed on upgrade.
const NOBLE_ROMAN = ['I', 'II', 'III'] as const;
function nobleSubLevel(xp: number, rankIdx: number): number {
  const r = NOBLE_RANKS[rankIdx];
  if (!r) return 1;
  const span = r.maxXP - r.minXP;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.min(3, Math.floor(((xp - r.minXP) / span) * 3) + 1);
}
/** Lighten a hex color — second stop of the pill gradient. */
function lightenHex(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// 2026-10-12 (Sumon): Premium gradient pills for Nobel & Follower —
// gorgeous, premium look. Same size as LevelBadge.
function PremiumPill({ label, icon, colors }: { label: string; icon?: string; colors: [string, string] }) {
  return (
    <View style={{ marginRight: 6, marginBottom: 6 }}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 12,
          paddingHorizontal: 10,
          paddingVertical: 5,
          flexDirection: 'row',
          alignItems: 'center' }}
      >
        {icon && <Text style={{ fontSize: 12, marginRight: 4 }}>{icon}</Text>}
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>
      </LinearGradient>
    </View>
  );
}

// ─── Voice Room Card (IMO style with live indicator) ───

function RoomCard({ item, onPress }: { item: any; onPress: () => void }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (item.isLive) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [item.isLive]);

  return (
    <Pressable onPress={onPress} style={{ width: 100, marginRight: 10 }}>
      <View style={{ width: 84, height: 84, borderRadius: 22, overflow: 'hidden', backgroundColor: C.card }}>
        {item.coverImageUrl ? (
          <Image source={{ uri: item.coverImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8ED' }}>
            <Text style={{ fontSize: 36 }}>🎙️</Text>
          </View>
        )}
        {/* Live badge with pulsing dot */}
        {item.isLive && (
          <View style={{
            position: 'absolute', bottom: 6, left: 6,
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10,
            paddingHorizontal: 7, paddingVertical: 3 }}>
            <Animated.View style={{
              width: 7, height: 7, borderRadius: 3.5,
              backgroundColor: '#FF3B30', marginRight: 4,
              opacity: pulseAnim }} />
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
              {item.memberCount || 0}
            </Text>
          </View>
        )}
        {/* Member count for non-live */}
        {!item.isLive && item.memberCount > 0 && (
          <View style={{
            position: 'absolute', bottom: 6, right: 6,
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
            paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>👥 {item.memberCount}</Text>
          </View>
        )}
        {/* Private/Public icon — top-right corner, same as trending */}
        <View style={{
          position: 'absolute', top: 6, right: 6,
          backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
          padding: 4 }}>
          {item.isPublic === false ? (
            <Feather name="lock" size={12} color="#F59E0B" />
          ) : (
            <Feather name="globe" size={12} color="#10B981" />
          )}
        </View>
      </View>
      <Text style={{ fontSize: 12, color: C.text, marginTop: 6, fontWeight: '600' }} numberOfLines={1}>
        {item.name || 'Room'}
      </Text>
    </Pressable>
  );
}

// ─── Main Component ───

export default function ProfileScreen({
  onNavigateToContacts,
  targetUid,
  targetName }: {
  onNavigateToContacts?: () => void;
  /** When set, renders ANOTHER user's profile with the IDENTICAL layout.
   *  Only differences: no settings icon, three-dots shows their vId,
   *  bottom action buttons instead of Edit. */
  targetUid?: string;
  /** Display name passed from the navigation source (e.g. member list).
   *  Used as fallback when the target's DB name is empty — NEVER falls
   *  back to the viewer's own name. */
  targetName?: string;
} = {}) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  // The UID whose profile data we display (own or another user's)
  const displayUid = targetUid ?? user?.uid;
  const isMe = !targetUid || targetUid === user?.uid;
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [rooms, setRooms] = useState<any[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<Record<string, number>>({});
  // 2026-10-12 (Sumon): diamonds sent — primary XP driver for the slow,
  // premium level system (1 XP per diamond sent as gift).
  const [diamondsSent, setDiamondsSent] = useState(0);
  const [nobleState, setNobleState] = useState<NobleState | null>(null);
  // PIN gate for private rooms (enforced from EVERYWHERE)
  const { requestRoomAccess, pinDialog } = usePrivateRoomGate();
  // (Gift History section removed 2026-10-10 per Sumon: gifts live ONLY inside
  // /profile/gifts with x2/x3 aggregation, not on the profile screen.)
  const [vidCopied, setVidCopied] = useState(false);
  const [showVidMenu, setShowVidMenu] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // NOTE 11 (2026-10-11): full-screen DP viewer + Change flow
  const [showDpViewer, setShowDpViewer] = useState(false); // DEPRECATED 2026-10-13: DP viewer is now /profile/dp-viewer route
  const [uploadingDp, setUploadingDp] = useState(false);
  // NOTE 7 (2026-10-11): real granted badges from Firebase (official/event only)
  const [grantedBadges, setGrantedBadges] = useState<GrantedBadge[]>([]);
  // 2026-10-13 (Sumon): official badge check for verified logo next to name
  const [isOfficial, setIsOfficial] = useState(false);
  // 2026-10-13 (Sumon): server-driven badge icon (his design) next to name
  const [badgeIconUrl, setBadgeIconUrl] = useState<string | null>(null);
  // P1-4/P1-5 (2026-10-12): frames for the DP overlay + real owned counts
  const [grantedFrames, setGrantedFrames] = useState<GrantedFrame[]>([]);
  const [grantedNameplates, setGrantedNameplates] = useState<GrantedNameplate[]>([]);
  // ── Other-user action buttons state (only used when !isMe) ──
  const [isFollowingTarget, setIsFollowingTarget] = useState(false);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
  // দুই দিকের ব্লক স্টেট: 'none' | 'byMe' | 'byThem' | 'mutual'
  const [blockDirection, setBlockDirection] = useState<BlockDirection>('none');
  const [actionLoading, setActionLoading] = useState(false);
  // আমি ব্লক করেছি (byMe/mutual) — তখন বাম বাটনে Unblock দেখায়
  const isBlockedTarget = blockDirection === 'byMe' || blockDirection === 'mutual';
  // ও আমাকে ব্লক করেছে — প্রোফাইল ডেটা + অ্যাকশন সব বন্ধ
  const blockedByThem = blockDirection === 'byThem' || blockDirection === 'mutual';

  useEffect(() => {
    if (!displayUid) { setLoading(false); return; }
    const unsub = subscribeUser(displayUid, (u) => { setProfile(u); setLoading(false); });
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [displayUid]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeFollowCounts(displayUid, setFollowCounts);
  }, [displayUid]);

  // 2026-10-12 (Sumon): subscribe to diamonds sent (gift_sent transactions)
  // for the premium level system. Best-effort — level falls back gracefully.
  useEffect(() => {
    if (!displayUid) { setDiamondsSent(0); return; }
    let cancelled = false;
    void (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `wallets/${displayUid}/transactions`));
        if (cancelled) return;
        let total = 0;
        if (snap.exists()) {
          snap.forEach((child) => {
            const tx = child.val() as { type?: string; diamonds?: number } | null;
            // 2026-10-12 review fix: gift_sent stores diamonds as NEGATIVE
            // (it's a debit) — use abs() or the level becomes NaN.
            if (tx?.type === 'gift_sent' && typeof tx.diamonds === 'number') {
              total += Math.abs(tx.diamonds);
            }
          });
        }
        if (!cancelled) setDiamondsSent(total);
      } catch {
        // background: safe to swallow — level uses fallback
      }
    })();
    return () => { cancelled = true; };
  }, [displayUid]);

  // NOTE 7 (2026-10-11): subscribe to real granted badges (official/event only)
  useEffect(() => {
    if (!displayUid) { setGrantedBadges([]); return; }
    return subscribeBadges(displayUid, setGrantedBadges);
  }, [displayUid]);

  // 2026-10-13 (Sumon): Check for valid Vee Official badge → verified logo next to name
  useEffect(() => {
    if (!displayUid) { setIsOfficial(false); return; }
    let cancelled = false;
    hasOfficialBadge(displayUid).then((v) => { if (!cancelled) setIsOfficial(v); });
    // Fetch server-driven badge icon (Sumon's design from catalog)
    getOfficialBadgeIconUrl().then((url) => { if (!cancelled) setBadgeIconUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [displayUid, grantedBadges]);

  // P1-4/P1-5 (2026-10-12): subscribe to frames + nameplates (expiry-filtered
  // inside the service — expired items are visible nowhere).
  useEffect(() => {
    if (!displayUid) { setGrantedFrames([]); setGrantedNameplates([]); return; }
    const unsubF = subscribeFrames(displayUid, setGrantedFrames);
    const unsubN = subscribeNameplates(displayUid, setGrantedNameplates);
    return () => { unsubF(); unsubN(); };
  }, [displayUid]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeMyRoomsCombined(displayUid, setRooms);
  }, [displayUid]);

  // Nobel tier — always shows the user's current rank name
  useEffect(() => {
    if (!displayUid) { setNobleState(null); return; }
    return subscribeNoble(displayUid, setNobleState);
  }, [displayUid]);

  // ── Private room PIN enforcement (from EVERYWHERE) ──
  const handleRoomPress = useCallback((room: any) => {
    requestRoomAccess(room, () => {
      router.push({ pathname: '/voice-room', params: { roomId: room.id } } as never);
    });
  }, [requestRoomAccess]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeTransactionHistory(displayUid, (txs) => {
      const counts: Record<string, number> = {};
      for (const tx of txs) {
        if (tx.type === 'gift_received' && tx.giftId) {
          counts[tx.giftId] = (counts[tx.giftId] ?? 0) + 1;
        }
      }
      setReceivedGifts(counts);
    });
  }, [displayUid]);

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  // ── Other-user: subscribe to follow/friend/block status ──
  // 2026-10-13 (Sumon): ব্লক দুই দিকেই চেক — ও আমাকে ব্লক করলে প্রোফাইল
  // দেখা যাবে না, কোনো অ্যাকশনও হবে না। byMe সাইড লাইভ সাবস্ক্রিপশনে
  // আপডেট হয় (অন্য স্ক্রিন থেকে ব্লক/আনব্লক করলেও stale থাকে না)।
  useEffect(() => {
    if (isMe || !user?.uid || !displayUid) return;
    const unsub1 = subscribeIsFollowing(user.uid, displayUid, setIsFollowingTarget);
    const unsub2 = subscribeFriendStatus(user.uid, displayUid, setFriendStatus);
    let cancelled = false;
    getBlockDirection(user.uid, displayUid)
      .then((d) => { if (!cancelled) setBlockDirection(d); })
      .catch(() => {});
    const unsub3 = subscribeBlockedUsers(user.uid, (blocks) => {
      if (cancelled) return;
      const byMeNow = blocks.some((b) => b.targetUid === displayUid);
      setBlockDirection((prev) => {
        const themSide = prev === 'byThem' || prev === 'mutual';
        if (byMeNow && themSide) return 'mutual';
        if (byMeNow) return 'byMe';
        if (themSide) return 'byThem';
        return 'none';
      });
    });
    return () => { cancelled = true; unsub1(); unsub2(); unsub3(); };
  }, [isMe, user?.uid, displayUid]);

  // ── Other-user: action handlers ──
  const handleLeftAction = useCallback(async () => {
    if (!user?.uid || !displayUid || actionLoading) return;
    // 2026-10-13 (Sumon): request-received হলে Accept/Decline দুটো অপশন —
    // আগে প্রোফাইল থেকে ডিক্লাইন করার কোনো পথ ছিল না (UX dead-end)।
    if (friendStatus === 'request-received' && !isBlockedTarget) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // NOTE: displayName const নিচে ডিক্লেয়ার হয় — deps array-এ রাখলে
      // TDZ crash হবে, তাই এখানে profile?.name সরাসরি ব্যবহার।
      Alert.alert(profile?.name || t('userProfile.defaultName', 'User'), '', [
        {
          text: t('userProfile.accept', 'Accept'),
          onPress: async () => {
            setActionLoading(true);
            try {
              // P1 fix (2026-10-12): signature is (myUid, fromUid) — accepter first.
              await acceptFriendRequest(user.uid, displayUid);
            } catch (e) {
              Alert.alert(t('userProfile.error', 'Error'), String(e));
            } finally {
              setActionLoading(false);
            }
          } },
        {
          text: t('userProfile.decline', 'Decline'),
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await rejectFriendRequest(user.uid, displayUid);
            } catch (e) {
              Alert.alert(t('userProfile.error', 'Error'), String(e));
            } finally {
              setActionLoading(false);
            }
          } },
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      ]);
      return;
    }
    setActionLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isBlockedTarget) {
        await unblockUser(user.uid, displayUid);
        // আনব্লকের পর ওর দিকের ব্লক থাকলে 'byThem' থাকে
        setBlockDirection((prev) => (prev === 'mutual' ? 'byThem' : 'none'));
      } else if (friendStatus === 'friends') {
        // Chat-এ যাওয়ার আগে ব্লক আবার চেক — stale স্টেটে বাইপাস হবে না
        const dir = await getBlockDirection(user.uid, displayUid).catch(() => 'none' as BlockDirection);
        setBlockDirection(dir);
        if (dir !== 'none') {
          Alert.alert(
            t('userProfile.error', 'Error'),
            dir === 'byMe' || dir === 'mutual'
              ? t('userProfile.blockedByMeChat', 'You blocked this user. Unblock to chat.')
              : t('userProfile.blockedByThemChat', 'This user has blocked you.'),
          );
          return;
        }
        router.push(`/inbox/${buildChatId(user.uid, displayUid)}`);
      } else if (friendStatus === 'request-sent') {
        await cancelFriendRequest(user.uid, displayUid);
      } else {
        // P1 fix (2026-10-12): sendFriendRequest needs the FULL VeeUser
        // (vId + photoURL). A minimal {uid, name} object produced
        // fromVId: undefined and the RTDB set() threw every time.
        const fullProfile = await getUser(user.uid);
        if (!fullProfile) throw new Error(t('userProfile.tryAgain', 'Please try again.'));
        await sendFriendRequest(fullProfile, displayUid);
      }
    } catch (e) {
      Alert.alert(t('userProfile.error', 'Error'), String(e));
    } finally {
      setActionLoading(false);
    }
  }, [user?.uid, displayUid, friendStatus, isBlockedTarget, actionLoading, t, profile?.name]);

  const handleRightAction = useCallback(async () => {
    if (!user?.uid || !displayUid || actionLoading) return;
    setActionLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isFollowingTarget) {
        await unfollowUser(user.uid, displayUid);
      } else {
        await followUser(user.uid, displayUid);
      }
    } catch (e) {
      Alert.alert(t('userProfile.error', 'Error'), String(e));
    } finally {
      setActionLoading(false);
    }
  }, [user?.uid, displayUid, isFollowingTarget, actionLoading, t]);

  const handleCopyVid = useCallback(async () => {
    const id = profile?.vId;
    if (!id) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Clipboard.setStringAsync(id);
      setVidCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setVidCopied(false), 2000);
    } catch {}
  }, [profile?.vId]);

  const handleLogout = useCallback(() => {
    Alert.alert(t('profile.signOutTitle'), t('profile.signOutMsg'), [
      { text: t('profile.cancel'), style: 'cancel' },
      { text: t('profile.menuSignOut'), style: 'destructive', onPress: logout },
    ]);
  }, [logout, t]);

  // ── NOTE 11 (2026-10-11): DP Change flow — gallery pick → Cloudinary upload → Firebase photoURL
  const handleChangeDp = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow gallery access to choose a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      setUploadingDp(true);
      try {
        // Delete the old Cloudinary asset so orphans don't accumulate
        const oldPublicId = (profile as any)?.photoPublicId;
        if (oldPublicId) {
          deleteCloudinaryAsset(oldPublicId).catch(() => {/* non-critical */});
        }
        const upload = await uploadProfilePhoto(result.assets[0].uri);
        await updateUser(user.uid, {
          photoURL: upload.url,
          ...(upload.publicId ? { photoPublicId: upload.publicId } : {}) });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        Alert.alert('Could not update photo', `Reason: ${getErrorCause(err)}`);
      } finally {
        setUploadingDp(false);
      }
    } catch (err) {
      Alert.alert('Could not open gallery', `Reason: ${getErrorCause(err)}`);
    }
  }, [user?.uid, profile]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </SafeAreaView>
    );
  }

  // 2026-10-13 (Sumon): ও আমাকে ব্লক করলে প্রোফাইল দেখা যাবে না —
  // নাম/DP/বায়ো/রুম/গিফট/ব্যাজ কিছুই রেন্ডার হবে না, অ্যাকশন বাটনও না।
  // (byMe হলে পুরো প্রোফাইলই দেখায় — বাম বাটনে Unblock থাকে, আগের মতো।)
  if (!isMe && blockedByThem) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/home' as never);
            }}
            style={{ padding: 8 }}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <View style={{
            width: 84, height: 84, borderRadius: 42,
            backgroundColor: '#FEE2E2',
            alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Feather name="slash" size={36} color="#DC2626" />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center' }}>
            {t('userProfile.blockedByThemTitle', 'This profile is unavailable')}
          </Text>
          <Text style={{ fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 10 }}>
            {t('userProfile.blockedByThemMsg', "This user has blocked you, so you can't view their profile.")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile?.name || (isMe ? user?.displayName : (targetName || (profile?.email ? profile.email.split('@')[0] : null))) || 'User';
  const photoURL = profile?.photoURL || (isMe ? user?.photoURL : undefined);
  const vId = profile?.vId || '';
  const bio = profile?.bio || '';
  /* 2026-10-15 (Sumon): ONE active nameplate shows below the name on profile */
  const activeNameplate = grantedNameplates.find((n) => n.id === (profile as any)?.activeNameplate) || null;
  /* Mist color for Viscount+ nameplates */
  const nameplateMist = (() => {
    if (!activeNameplate) return null;
    const entry = NOBLE_REWARDS_CATALOG.find((r) => `noble-plate-${r.rankKey}` === activeNameplate.id);
    return entry?.nameplate.mistColor || null;
  })();
  const giftEntries = Object.entries(receivedGifts);
  const totalGifts = giftEntries.reduce((s, [, c]) => s + c, 0);

  // ─── Premium Level System (2026-10-12, Sumon concept) ───
  // VERY SLOW progression (Sumon 2026-10-12: "একদম স্লো").
  // XP: 1 per diamond sent as gift, 100 per room owned, 2 per gift received.
  // Level curve (quadratic — each level needs progressively more):
  //   cumulative XP for level N = 50 * (N-1)^2  (Lv.30 ≈ 42,050 XP, Lv.60 ≈ 174,050, Lv.100 = 490,050)
  // Tiers: 1-30 Bronze, 31-60 Silver, 61-99 Gold, 100 Max.
  const calculateLevel = (): number => {
    const xp = diamondsSent + (rooms.length * 100) + (totalGifts * 2);
    // Invert: N = sqrt(xp / 50), floor, min 1, max 100. 10x slower than before.
    const level = Math.floor(Math.sqrt(xp / 50)) + 1;
    return Math.min(100, Math.max(1, level));
  };
  const userLevel = calculateLevel();

  // NOTE 7 (2026-10-11): demo badges removed — grantedBadges comes from the
  // Firebase subscription above (official/event grants only).

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* ─── Top Bar (IMO style: back + icons only) ─── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.bg }}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/home' as never);
            }}
            style={{ padding: 8 }}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
          <View style={{ flexDirection: 'row' }}>
            {isMe && (
              <Pressable onPress={() => router.push('/profile/settings')} style={{ padding: 8 }} hitSlop={8}>
                <Feather name="settings" size={22} color={C.text} />
              </Pressable>
            )}
            <Pressable onPress={() => setShowVidMenu(true)} style={{ padding: 8 }} hitSlop={8}>
              <Feather name="more-horizontal" size={22} color={C.text} />
            </Pressable>
          </View>
        </View>

        {/* ─── Cover (tappable to change via Edit — own profile only) ─── */}
        <Pressable onPress={() => { if (isMe) router.push('/profile/edit'); }}>
          <View style={{ height: 180, backgroundColor: '#E8E8ED' }}>
            {profile?.coverImageUrl ? (
              <Image source={{ uri: profile.coverImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, backgroundColor: '#EFEFF4', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 48 }}>🌅</Text>
              </View>
            )}
          </View>
        </Pressable>

        {/* ─── Avatar (overlapping) — NOTE 11 (2026-10-11): tap opens full-screen DP viewer ─── */}
        {/* P1-4 (2026-10-12): equipped avatar frame renders as an overlay. URL
            frames overlay the image; emoji frames get a gold ring. Expired
            frames never reach here (expiry-filtered in subscribeFrames). */}
        <View style={{ paddingHorizontal: 16, marginTop: -40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => {
                // 2026-10-13 (Sumon): DP viewer is now a dedicated route —
                // the Modal was showing 404 on other users' profiles.
                if (isMe) {
                  router.push('/profile/dp-viewer');
                } else {
                  router.push({ pathname: '/profile/dp-viewer', params: { uid: displayUid } } as never);
                }
              }}
              hitSlop={6}
            >
              <View style={{ width: 92, height: 92, alignItems: 'center', justifyContent: 'center' }}>
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: C.bg }} />
                ) : (
                  <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.blueLight, borderWidth: 3, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: C.blue }}>{displayName[0]?.toUpperCase()}</Text>
                  </View>
                )}
                {(() => {
                  const activeFrameId = profile?.activeFrame;
                  if (!activeFrameId) return null;
                  // Official animated frame — pure RN AnimatedFrame (no native modules)
                  if (activeFrameId === 'official' || (typeof activeFrameId === 'string' && activeFrameId.toLowerCase().includes('official'))) {
                    return (
                      <View style={{ position: 'absolute', width: 110, height: 110, alignItems: 'center', justifyContent: 'center' }}>
                        {/* 2026-10-14 (Sumon): frameId pass করতে হবে — না হলে server APNG load হয় না */}
                        <AnimatedFrame size={80} frameId={activeFrameId} />
                      </View>
                    );
                  }
                  const activeFrameObj = grantedFrames.find((f) => f.id === activeFrameId);
                  if (!activeFrameObj) return null;
                  if (/^https?:\/\//i.test(activeFrameObj.icon)) {
                    return (
                      <Image
                        source={{ uri: activeFrameObj.icon }}
                        style={{ position: 'absolute', width: 92, height: 92 }}
                        resizeMode="contain"
                      />
                    );
                  }
                  return (
                    <View style={{ position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#FFD54A' }} />
                  );
                })()}
              </View>
            </Pressable>
          </View>
        </View>

        {/* ─── Name ─── */}
        {/* P1-6 (2026-10-12): official verified blue tick — shown only when
            Sumon granted officialBadge. Other badges live in the Badge section.
            2026-10-13 (Sumon): Vee Official badge from badges node also shows
            verified logo next to name for the badge's validity duration. */}
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>{displayName}</Text>
            {(profile?.officialBadge || isOfficial) ? (
              // 2026-10-13 (Sumon): his badge design from server (not Feather icon)
              <Image
                source={badgeIconUrl ? { uri: badgeIconUrl } : require('@/assets/images/vee-badge.png')}
                style={{ width: 22, height: 22, marginLeft: 6 }}
                resizeMode="contain"
              />
            ) : null}
          </View>
          {bio ? <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>{bio}</Text> : null}
        </View>

        {/* ─── Badge Pills ─── */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 12 }}>
          {/* 2026-10-15 (Sumon): Equipped nameplate IS the rank display. Final — no old pill. */}
          {activeNameplate && /^https?:\/\//i.test(activeNameplate.icon) ? (
            nameplateMist ? (
              <MistNameplate imageUrl={activeNameplate.icon} mistColor={nameplateMist} width={120} height={36} />
            ) : (
              <Image
                source={{ uri: activeNameplate.icon }}
                style={{ width: 120, height: 36 }}
                resizeMode="contain"
              />
            )
          ) : null}
          <LevelBadge level={userLevel} />
          <Pressable onPress={() => router.push({ pathname: '/profile/followers', params: { type: 'followers', uid: displayUid } } as never)}>
            {/* Follower: ocean blue gradient (premium) */}
            <PremiumPill
              label={`${followCounts.followers} Follower`}
              icon="⭐"
              colors={['#0EA5E9', '#38BDF8']}
            />
          </Pressable>
        </View>

        {/* ─── VoiceClub Room ─── */}
        {rooms.length > 0 && (
          <>
            <SectionHeader title="VoiceClub Room" count={rooms.length} onPress={() => router.push(isMe ? '/profile/rooms' : `/profile/rooms?uid=${displayUid}`)} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              // Smooth nested scrolling
              nestedScrollEnabled
              directionalLockEnabled
            >
              {rooms.slice(0, 10).map((item, i) => (
                <RoomCard
                  key={item.id || String(i)}
                  item={item}
                  onPress={() => handleRoomPress(item)}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* ─── Gifts — 1 LINE ONLY: top 4 biggest by total diamond value.
            Tap anywhere → full gifts page. ─── */}
        {giftEntries.length > 0 && (
          <>
            <SectionHeader title="Gifts" count={totalGifts} onPress={() => router.push(isMe ? '/profile/gifts' : `/profile/gifts?uid=${displayUid}`)} />
            <Pressable onPress={() => router.push(isMe ? '/profile/gifts' : `/profile/gifts?uid=${displayUid}`)}>
              <View style={{ flexDirection: 'row', paddingHorizontal: 12 }}>
                {[...giftEntries]
                  .sort((a, b) => (GIFT_RANK_PRICE[b[0]] || 0) * b[1] - (GIFT_RANK_PRICE[a[0]] || 0) * a[1])
                  .slice(0, 4)
                  .map(([giftId, count]) => (
                  <View key={giftId} style={{ width: '25%', padding: 4, alignItems: 'center' }}>
                    <View style={{ width: '100%', aspectRatio: 1, backgroundColor: C.card, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 36 }}>{GIFTS[giftId] || '🎁'}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: '600' }}>x{count}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          </>
        )}

        {/* ─── Honor — NOTE 7 (2026-10-11): demo badges removed. Shows only
            real granted badges from Firebase; empty state until any exist. ─── */}
        <SectionHeader
          title="Honor"
          count={grantedBadges.length}
          onPress={() => router.push(isMe ? '/profile/honor' : `/profile/honor?uid=${displayUid}`)}
        />
        {grantedBadges.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            nestedScrollEnabled
            directionalLockEnabled
          >
            <Pressable
              onPress={() => router.push(isMe ? '/profile/honor' : `/profile/honor?uid=${displayUid}`)}
              style={{ flexDirection: 'row' }}
            >
              {grantedBadges.map((h) => (
                <View key={h.id} style={{ width: 80, padding: 4, alignItems: 'center' }}>
                  <View style={{ width: 72, aspectRatio: 1, backgroundColor: '#FFF8E6', borderWidth: 1, borderColor: '#F5D67B', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                    {/^https?:\/\//i.test(h.icon || '') ? (
                      <Image source={{ uri: h.icon }} style={{ width: 48, height: 48 }} resizeMode="contain" />
                    ) : (
                      <Text style={{ fontSize: 36 }}>{h.icon}</Text>
                    )}
                  </View>
                  <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }} numberOfLines={1}>{h.name}</Text>
                </View>
              ))}
            </Pressable>
          </ScrollView>
        ) : (
          <Pressable onPress={() => router.push(isMe ? '/profile/honor' : `/profile/honor?uid=${displayUid}`)}>
            <Text style={{ textAlign: 'center', color: C.mutedLight, fontSize: 13, paddingVertical: 14, paddingHorizontal: 40 }}>
              No badges yet
            </Text>
          </Pressable>
        )}

        {/* ─── Decoration ─── */}
        <SectionHeader title="Decoration" count={grantedFrames.length} onPress={() => router.push(isMe ? '/profile/decoration' : `/profile/decoration?uid=${displayUid}`)} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
          <Pressable
            onPress={() => router.push(isMe ? '/profile/decoration' : `/profile/decoration?uid=${displayUid}`)}
            style={{ width: '25%', padding: 4, alignItems: 'center' }}
          >
            {/* Frames: premium gradient tile with white frame icon */}
            <LinearGradient
              colors={['#8B5CF6', '#A78BFA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', aspectRatio: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="image" size={32} color="#FFFFFF" />
            </LinearGradient>
            <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Frames</Text>
            <Text style={{ fontSize: 11, color: C.mutedLight }}>{grantedFrames.length} owned</Text>
          </Pressable>
        </View>

        {/* ─── Bottom padding for Edit button ─── */}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* ─── PIN Dialog for Private Rooms (shared gate) ─── */}
      {pinDialog}

      {/* ─── Bottom Action: Edit (own) or Chat/Add + Follow (other user) ─── */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border }}>
        {isMe ? (
          <Pressable
            onPress={() => router.push('/profile/edit')}
            style={{ backgroundColor: C.blueLight, borderRadius: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="edit-2" size={18} color={C.blue} />
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.blue, marginLeft: 8 }}>Edit</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={handleLeftAction}
              disabled={actionLoading}
              style={{
                flex: 1, backgroundColor: C.blueLight, borderRadius: 16, paddingVertical: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                opacity: actionLoading ? 0.6 : 1 }}
            >
              {actionLoading ? (
                <PremiumLoader size="small" />
              ) : (
                <>
                  <Feather
                    name={
                      isBlockedTarget ? 'unlock'
                      : friendStatus === 'friends' ? 'message-circle'
                      : friendStatus === 'request-received' ? 'user-check'
                      : friendStatus === 'request-sent' ? 'x'
                      : 'user-plus'
                    }
                    size={18} color={C.blue}
                  />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue, marginLeft: 6 }} numberOfLines={1} adjustsFontSizeToFit>
                    {isBlockedTarget ? t('userProfile.unblock', 'Unblock')
                      : friendStatus === 'friends' ? t('userProfile.chat', 'Chat')
                      : friendStatus === 'request-received' ? t('userProfile.accept', 'Accept')
                      : friendStatus === 'request-sent' ? t('userProfile.cancelRequest', 'Cancel Request')
                      : t('userProfile.add', 'Add')}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={handleRightAction}
              disabled={actionLoading}
              style={{
                flex: 1, backgroundColor: isFollowingTarget ? C.card : C.blueLight,
                borderRadius: 16, paddingVertical: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                opacity: actionLoading ? 0.6 : 1 }}
            >
              <Feather name={isFollowingTarget ? 'check' : 'plus'} size={16} color={C.blue} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue, marginLeft: 6 }} numberOfLines={1} adjustsFontSizeToFit>
                {isFollowingTarget ? t('userProfile.following', 'Following') : t('userProfile.follow', 'Follow')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ─── vId Menu Modal ─── */}
      {showVidMenu && (
        <Pressable
          onPress={() => setShowVidMenu(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-start', alignItems: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            // NOTE 6 (2026-10-11): polished — no "Vee ID" label, compact badge
            // with just the ID number + copy icon.
            style={{ backgroundColor: C.bg, borderRadius: 14, marginTop: 60, marginRight: 12, paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, letterSpacing: 0.5 }}>{vId}</Text>
              <Pressable
                onPress={handleCopyVid}
                style={{ backgroundColor: C.blueLight, borderRadius: 10, padding: 8, marginLeft: 10 }}
                hitSlop={8}
              >
                <Feather name={vidCopied ? 'check' : 'copy'} size={16} color={C.blue} />
              </Pressable>
            </View>
            {vidCopied && <Text style={{ fontSize: 12, color: C.blue, marginTop: 4 }}>Copied!</Text>}
          </Pressable>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
