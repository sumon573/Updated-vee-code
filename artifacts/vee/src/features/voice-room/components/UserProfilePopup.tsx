import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Alert, Pressable, Modal, ScrollView, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { C } from '../constants/theme';
import { Avatar } from './Avatar';
import { RoomUserActionBar } from './RoomUserActionBar';
import { SayHiSheet } from './SayHiSheet';
import { PermissionSettingsSheet } from './PermissionSettingsSheet';
import { RoomToast, useRoomToast } from './RoomToast';
import { NameplateRow } from '@/src/components/NameplateRow';
import { PremiumLocationIcon } from '@/src/components/PremiumLocationIcon';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import { subscribeFollowCounts, subscribeIsFollowing, followUser, unfollowUser } from '@/src/services/followService';
import { subscribeBadges, subscribeFrames, subscribeNameplates, type GrantedFrame, type GrantedNameplate } from '@/src/services/badgeService';
import type { GrantedBadge } from '@/src/data/honor';
import { subscribeNoble, NOBLE_RANKS, type NobleState } from '@/src/services/nobleService';
import { subscribeSvip, isSvipActive, type SvipState } from '@/src/features/svip/svipService';
import { useProfileScreenArt, ProfileScreenBackground } from '@/src/features/svip/ProfileScreenBackground';
import { subscribeTransactionHistory, subscribeGiftCounts } from '@/src/features/wallet/walletService';
import { subscribeGiftCatalog, type CatalogGift } from '@/src/features/voice-room/services/giftCatalogService';
import { subscribeCoupleState, type CoupleState } from '@/src/features/intimacy/coupleLevels';
import { subscribeUserFriends, MAX_FRIENDS, type FriendEntry } from '@/src/features/intimacy/friendService';
import { CoupleTile, IntimacyFriendTile, FriendPlusTile } from '@/src/features/intimacy/IntimacyTiles';
import { subscribeMyIntimacies, intimacyLevelFor, type IntimacyEntry } from '@/src/features/voice-room/services/intimacyService';
import { subscribeLevel } from '@/src/services/levelService';
import { useLiveUserProfile } from '@/src/hooks/useLiveUserProfile';
import { createOrGetChat, sendMessage } from '@/src/features/chat/services/firebaseDmService';
import { getActiveCatalog } from '@/src/services/nobleRewardsCatalog';
import { useIsKing } from '@/src/hooks/useNobleRank';
import { useActiveFrame } from '@/src/hooks/useActiveFrame';
import { KingSparkle } from './KingShimmerName';
import type { Participant, Role } from '../types/room';

/* ── 2026-11-11 (boss, imo mirror): profile POPUP ────────────────────────
   Voice room → tap a user's seat/avatar → this card (NOT the full profile
   yet). Tap the DP → the full profile. Cover, back arrow, "@" + "..."
   (top-right: ID + Report), DP with frame, name + small nameplates
   (68x18), chips, bio, Privilege (horizontal), Intimacy, bottom buttons
   (+ Follow / Say hi / gift) + the role-gated 5-icon bar below them.
   Hooks rule: ALL hooks run before the `if (!member) return null` early
   return (same crash class as the 2026-10-15 MemberManageModal +
   2026-11-11 thin-bar crash). Handlers are plain functions after the
   early return (never useCallback below it). */

/* ── 2026-11-11 (boss, taller popup): the sheet height ──────────────────
   75% of the DISPLAY (3/4 of the physical screen), as a definite pixel
   value - NOT `height: '75%'` (a percentage of the sheet's parent, the
   Modal's content area; on a device where that parent is inset by the
   status bar, a percentage of the parent is LESS than the intended
   fraction of the display). `Dimensions.get('screen')` IS the display
   (status bar + nav bar included); `window` is the app window (status
   bar excluded) and would give the same shortfall. The fraction comes
   from the boss's own mark (2026-11-11 20:41, screenshot 1000230680,
   Gentleman popup, OTA 01a1cb09 live): "পপ-আপটা আরেকবার বাড়াও মানে
   উপরের দিকে উঠাও সিটের প্রথম লাইন এবং দ্বিতীয় লাইনের মাঝখানে বরাবর
   উঠবে" - make it bigger again, up to the middle of the gap between
   seat row 1 and seat row 2. Measured: his red-arrow tip lands at
   y=519/2048 = 25.34% (seat row 1 circles y 355-479, row 2 y 598-721,
   gap midpoint y=539); sheet height = (2048 - 519) / 2048 = 74.66% -
   0.75 puts the top at y=512, on the arrow tip, mid-gap. (Was 0.625,
   OTA 01a1cafc; was 0.5 = exact half, OTA 01a1ca8e/01a1cab3/01a1cad2;
   the scroll was praised "Good job" - this height change must NOT
   touch the Modal/ScrollView structure.) A definite height also keeps
   the flex:1 ScrollView rendering (the OTA 01a1ca60 blank-popup
   collapse - never go back to maxHeight). */
const POPUP_SHEET_HEIGHT = Dimensions.get('screen').height * 0.75;

/* LEGACY_GIFT_ID_MAP — copied verbatim from app/profile/gifts.tsx (the Gift
   Wall's canonicalisation: api-server tx giftIds are legacy numeric '1'–'8').
   Used only to merge gift counts per canonical id, exactly like the Gift
   Wall (Fix #15). */
const LEGACY_GIFT_ID_MAP: Record<string, string> = {
  '1': 'heart',
  '2': 'pink-rose',
  '3': 'pink-rose',
  '4': 'winter-dream',
  '5': 'golden-crown',
  '6': 'blossom-dream',
  '7': 'golden-crown',
  '8': 'dream-rider',
};

function ageFromBirthday(birthday: string | undefined | null): number | null {
  if (!birthday || typeof birthday !== 'string') return null;
  const m = birthday.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age;
}

/** "1 badge" / "0 badges" / "2 gifts" — imo shows the singular for 1
    (boss, 2026-11-11 polish: "1 badges" on his phone was wrong). */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Popup friend tile (2026-11-11, boss: Intimacy tiles must show in the
 * popup, reference 1000230624/1000230625) — mirrors the full profile's
 * CardFriendTile (app/profile/index.tsx): live photo (useLiveUserProfile,
 * so a photo change shows everywhere), blue Lv pill = the pair's intimacy
 * level when a pair exists, else the friend's own user total level
 * (Lv Max at 49); no pill when neither record exists. Tap → that friend's
 * full profile (same as a DP tap). Module-level so its hooks never
 * re-mount on popup re-renders.
 */
function PopupFriendTile({ friendUid, pairValue, onOpenProfile }: {
  friendUid: string;
  pairValue: number | undefined;
  onOpenProfile: (uid: string, name: string) => void;
}) {
  const [totalLevel, setTotalLevel] = useState<number | null>(null);
  const livePeer = useLiveUserProfile(friendUid);
  useEffect(() => {
    if (!friendUid) return;
    return subscribeLevel(friendUid, (l) => setTotalLevel(l.totalLevel));
  }, [friendUid]);
  const pairLabel = pairValue !== undefined ? `Lv.${intimacyLevelFor(pairValue).id}` : null;
  const ownLabel = totalLevel === null
    ? null
    : totalLevel >= 49
      ? 'Lv Max'
      : `Lv.${totalLevel}`;
  const label = pairLabel ?? ownLabel;
  return (
    <IntimacyFriendTile
      photoURL={livePeer.avatar ?? null}
      name={livePeer.name || ''}
      levelLabel={label}
      onPress={() => onOpenProfile(friendUid, livePeer.name || '')}
    />
  );
}

export function UserProfilePopup({ member, myUid, myName, viewerRole, targetRole, isCommentBlocked, accent, onClose, onViewFullProfile, onGift, onMention, onToggleCommentBlock, onInviteDirect, onRemoveMember, onSetAdmin, onDismissAdmin, onReport }: {
  /** Null = closed. The room passes the tapped seat/audience member. */
  member: Participant | null;
  myUid: string;
  myName: string;
  viewerRole: Role;
  targetRole: Role;
  isCommentBlocked: boolean;
  accent: string;
  onClose: () => void;
  /** DP tap → full profile (with roomId, so the bar can resolve roles). */
  onViewFullProfile: (uid: string, name: string) => void;
  onGift: (member: Participant) => void;
  /** "@" — insert @name into the room chat input. */
  onMention: (name: string) => void;
  onToggleCommentBlock: () => void;
  onInviteDirect: () => Promise<'ok' | 'no-seat' | 'already-seated' | 'error'>;
  onRemoveMember: () => void;
  onSetAdmin: () => void;
  onDismissAdmin: () => void;
  onReport: (memberId: string, memberName: string) => void;
}) {
  const { t } = useTranslation();
  const { toast, showToast } = useRoomToast();
  const [targetUser, setTargetUser] = useState<VeeUser | null>(null);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [isFollowingTarget, setIsFollowingTarget] = useState(false);
  const [grantedNameplates, setGrantedNameplates] = useState<GrantedNameplate[]>([]);
  const [nobleState, setNobleState] = useState<NobleState | null>(null);
  const [svipState, setSvipState] = useState<SvipState | null>(null);
  const [grantedBadges, setGrantedBadges] = useState<GrantedBadge[]>([]);
  const [giftTotal, setGiftTotal] = useState(0);
  // 2026-11-11 (boss, Gift Wall card "এবং Gifts এও"): first-gift artwork
  // needs the per-gift counts (lifetime aggregate + recent-tx window) and
  // the server gift catalog.
  const [lifetimeGiftCounts, setLifetimeGiftCounts] = useState<Record<string, number>>({});
  const [txGiftCounts, setTxGiftCounts] = useState<Record<string, number>>({});
  const [giftCatalog, setGiftCatalog] = useState<CatalogGift[]>([]);
  const [intimacyCouple, setIntimacyCouple] = useState<CoupleState | null>(null);
  const [intimacyFriends, setIntimacyFriends] = useState<FriendEntry[]>([]);
  // 2026-11-11 (boss, Intimacy tiles): pair values for the friend Lv pills.
  const [intimacyEntries, setIntimacyEntries] = useState<IntimacyEntry[]>([]);
  const [extraFields, setExtraFields] = useState<{ city?: string; country?: string; birthday?: string }>({});
  const [sayHiOpen, setSayHiOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [showVidPopup, setShowVidPopup] = useState(false);
  const [vidCopied, setVidCopied] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // 2026-11-11 (boss, popup fixes): bio expand state + length gate +
  // frames owned (Decoration card count, same source as full profile).
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bioIsLong, setBioIsLong] = useState(false);
  const [grantedFrames, setGrantedFrames] = useState<GrantedFrame[]>([]);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isKing = useIsKing(member?.id);
  const liveFrameId = useActiveFrame(member?.id);
  // 2026-11-12 (boss, Profile Screen reward): the profile OWNER's SVIP
  // Profile Screen art as the background from the cover bottom to
  // Privilege. Tier-keyed — the owner's tier, not the viewer's.
  const profileScreen = useProfileScreenArt(member?.id, svipState?.tier, isSvipActive(svipState));
  // 2026-11-11 (boss, Intimacy tiles): the couple partner's live photo/name
  // (null = no couple; the hook accepts null and subscribes to nothing).
  const liveCouplePartner = useLiveUserProfile(intimacyCouple?.partnerUid ?? null);

  useEffect(() => { if (!member?.id) return; return subscribeUser(member.id, setTargetUser); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeFollowCounts(member.id, setFollowCounts); }, [member?.id]);
  useEffect(() => { if (!member?.id || !myUid) return; return subscribeIsFollowing(myUid, member.id, setIsFollowingTarget); }, [member?.id, myUid]);
  useEffect(() => { if (!member?.id) return; return subscribeNameplates(member.id, setGrantedNameplates); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeFrames(member.id, setGrantedFrames); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeNoble(member.id, setNobleState); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeSvip(member.id, setSvipState); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeBadges(member.id, setGrantedBadges); }, [member?.id]);
  useEffect(() => {
    if (!member?.id) return;
    return subscribeTransactionHistory(member.id, (txs) => {
      setGiftTotal(txs.filter((tx) => tx.type === 'gift_received').length);
      // Per-gift received counts from the recent-tx window (deduped by
      // idempotencyKey, like the Gift Wall) — merged with the lifetime
      // aggregate below to find the first (most-received) gift.
      const counts: Record<string, number> = {};
      const seen = new Set<string>();
      for (const t of txs) {
        if (!t || t.type !== 'gift_received' || typeof t.giftId !== 'string' || t.giftId.length === 0) continue;
        const rawKey = (t as unknown as { idempotencyKey?: unknown }).idempotencyKey;
        const key = typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : `tx:${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts[t.giftId] = (counts[t.giftId] ?? 0) + 1;
      }
      setTxGiftCounts(counts);
    });
  }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeGiftCounts(member.id, setLifetimeGiftCounts); }, [member?.id]);
  // Server gift catalog is global (same for every user) — subscribe once.
  useEffect(() => { return subscribeGiftCatalog(setGiftCatalog); }, []);
  useEffect(() => { if (!member?.id) return; return subscribeCoupleState(member.id, setIntimacyCouple); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeUserFriends(member.id, setIntimacyFriends); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeMyIntimacies(member.id, setIntimacyEntries); }, [member?.id]);
  // Raw profile fields (city/country/birthday) — NOT in VeeUser (same
  // direct read as the profile screen).
  useEffect(() => {
    if (!member?.id) { setExtraFields({}); return; }
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(ref(database, `users/${member.id}`), (snap) => {
          const v = snap.val() as any;
          if (!v || typeof v !== 'object') { setExtraFields({}); return; }
          const pick = (k: string) => (typeof v[k] === 'string' ? v[k] : undefined);
          setExtraFields({ city: pick('city'), country: pick('country'), birthday: pick('birthday') });
        });
      } catch {}
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [member?.id]);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  if (!member) return null;

  // ── Derived (same nameplate derivation as the profile screen) ───
  const displayName = targetUser?.name || member.name || 'User';
  const photoURL = targetUser?.photoURL || member.photoURL;
  const vId = targetUser?.vId || '';
  const bio = targetUser?.bio || '';
  const coverImageUrl = targetUser?.coverImageUrl;
  const nobleRankKey = nobleState && NOBLE_RANKS[nobleState.rankIndex] ? NOBLE_RANKS[nobleState.rankIndex].key : null;
  const rankPlateGrant = nobleRankKey ? grantedNameplates.find((n) => n.id === 'noble-plate-' + nobleRankKey) || null : null;
  const rankPlateCatalog = nobleRankKey ? getActiveCatalog().find((r) => r.rankKey === nobleRankKey)?.nameplate : undefined;
  const svipPlateGrant = isSvipActive(svipState) ? grantedNameplates.find((n) => n.id === 'svip' + svipState!.tier + '-nameplate') || null : null;
  const activeNameplate = grantedNameplates.find((n) => n.id === (targetUser as any)?.activeNameplate) || null;
  const effectiveActiveNameplate = activeNameplate && activeNameplate.id.startsWith('svip') && activeNameplate.id.endsWith('-nameplate') && !isSvipActive(svipState) ? null : activeNameplate;
  const noblePlate = rankPlateGrant || (nobleRankKey && rankPlateCatalog ? { id: 'noble-plate-' + nobleRankKey, icon: (rankPlateCatalog as any).designUrl || (rankPlateCatalog as any).fallbackIcon || '' } as GrantedNameplate : null);
  const displayNameplates: GrantedNameplate[] = (() => {
    const list: GrantedNameplate[] = [];
    if (svipPlateGrant) list.push(svipPlateGrant);
    if (noblePlate && noblePlate.id !== svipPlateGrant?.id) list.push(noblePlate);
    if (list.length === 0 && effectiveActiveNameplate) list.push(effectiveActiveNameplate);
    return list;
  })();
  const achievementCount = grantedBadges.filter((b) => b.source === 'event').length;
  // 2026-11-11 (boss, Honor card): the card shows the FIRST Honor badge's
  // artwork, not a generic shield. grantedBadges is already rankHonors-ordered
  // (stars desc, Vee Official, official source, obtainedAt desc — the same
  // order the Honor screen lists), so [0] IS the first badge there. Mh's
  // first = noble-badge-king ("King Noble", 5 stars).
  const firstHonorBadge = grantedBadges.length > 0 ? grantedBadges[0] : null;
  // 2026-11-11 (boss, Gift Wall card "এবং Gifts এও"): the card shows the
  // FIRST gift's artwork, not a generic gift icon. "First" = the Gift Wall's
  // default order (quantity desc): the gift with the highest received count.
  // Counts merge the lifetime aggregate + the recent-tx window (max per raw
  // id, then sum per canonical id), exactly like the Gift Wall (Fix #15).
  // Mh's first = golden-dragon (945 received).
  const firstGift = (() => {
    const perRaw: Record<string, number> = {};
    for (const [id, count] of Object.entries(lifetimeGiftCounts)) perRaw[id] = Math.max(perRaw[id] ?? 0, count);
    for (const [id, count] of Object.entries(txGiftCounts)) perRaw[id] = Math.max(perRaw[id] ?? 0, count);
    const merged: Record<string, number> = {};
    for (const [id, count] of Object.entries(perRaw)) {
      const canonical = LEGACY_GIFT_ID_MAP[id] || id;
      merged[canonical] = (merged[canonical] ?? 0) + count;
    }
    let best: CatalogGift | null = null;
    let bestCount = 0;
    for (const gift of giftCatalog) {
      const count = merged[gift.id] ?? 0;
      if (count > 0 && count > bestCount) { best = gift; bestCount = count; }
    }
    return best;
  })();
  const intimacyCount = (intimacyCouple ? 1 : 0) + intimacyFriends.length;
  const age = ageFromBirthday(extraFields.birthday);
  const location = extraFields.city || extraFields.country || '';
  const roleLabel = targetRole === 'host' ? 'Owner' : targetRole === 'admin' ? 'Admin' : 'Member';
  // 2026-11-11 (boss, own-ID popup): tapping your OWN id opens YOUR popup.
  const isSelf = member.id === myUid;

  // ── Handlers (plain functions — never hooks below the early return) ───
  const handleClose = () => {
    setSayHiOpen(false);
    setPermissionOpen(false);
    setShowVidPopup(false);
    onClose();
  };
  const handleFollow = async () => {
    if (isSelf) return; // never follow yourself
    if (followBusy || !myUid) return;
    setFollowBusy(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isFollowingTarget) await unfollowUser(myUid, member.id);
      else await followUser(myUid, member.id);
    } catch (e) {
      Alert.alert(t('userProfile.error', 'Error'), String(e));
    } finally {
      setFollowBusy(false);
    }
  };
  const handleDpPress = () => {
    handleClose();
    // Own DP -> YOUR full profile (own screen, no roomId); others ->
    // the room full profile via the room's handler.
    if (isSelf) { router.push('/profile'); return; }
    onViewFullProfile(member.id, displayName);
  };
  // ── 2026-11-11 (boss, popup fixes): Privilege / Followers / Intimacy
  // taps go to THEIR OWN pages (never the full profile). The popup
  // closes first so the Modal never stays open over the new screen. ───
  const handleHonorPress = () => { handleClose(); router.push(isSelf ? '/profile/honor' : `/profile/honor?uid=${member.id}`); };
  const handleFollowersPress = () => { handleClose(); router.push({ pathname: '/profile/followers', params: { type: 'followers', uid: member.id } } as never); };
  const handleGiftsPress = () => { handleClose(); router.push(isSelf ? '/profile/gifts' : `/profile/gifts?uid=${member.id}`); };
  const handleDecorationPress = () => { handleClose(); router.push(isSelf ? '/profile/decoration' : `/profile/decoration?uid=${member.id}`); };
  const handleIntimacyPress = () => { handleClose(); router.push(isSelf ? '/profile/intimacy' : `/profile/intimacy?uid=${member.id}`); };
  const handleMentionPress = () => {
    onMention(displayName);
    handleClose();
  };
  const handleGiftPress = () => {
    onGift(member);
    handleClose();
  };
  const handleSayHiSend = async (greeting: string, remark: string) => {
    if (isSelf) return; // never say hi to yourself
    try {
      const chatId = await createOrGetChat(myUid, myName, member.id, displayName);
      await sendMessage(chatId, myUid, member.id, greeting + (remark ? `\n\n${remark}` : ''));
      setSayHiOpen(false);
      showToast('Greeting sent');
    } catch (e) {
      Alert.alert(t('userProfile.error', 'Error'), String(e));
    }
  };
  const handleInvite = async () => {
    const res = await onInviteDirect();
    if (res === 'ok') showToast('Success to invite');
    else if (res === 'no-seat') showToast('No empty seat');
    else if (res === 'already-seated') showToast('Already on a seat');
    else Alert.alert(t('voiceRoom.screen.error', 'Error'), t('voiceRoom.screen.inviteSendError', 'Could not send the invite.'));
  };
  const handleKick = () => {
    Alert.alert('Remove the user from room?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { onRemoveMember(); handleClose(); } },
    ]);
  };
  const handleCopyVid = async () => {
    if (!vId) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Clipboard.setStringAsync(vId);
      setVidCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setVidCopied(false), 2000);
    } catch {}
  };
  const handleReport = () => {
    setShowVidPopup(false);
    onReport(member.id, displayName);
  };

  return (
    <Modal visible={!!member} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* 2026-11-11 (boss, scroll fix #2): the backdrop is a SIBLING
            behind the sheet (not a parent wrapping it), and the sheet is a
            plain View (not a Pressable). The old structure — a Pressable
            backdrop wrapping a Pressable sheet wrapping the ScrollView —
            made the Pressables compete for the touch responder on Android,
            so vertical drags starting on non-scrollable children (cover /
            DP / name / chips) never reached the ScrollView ("only the lower
            areas scroll"). A plain View claims no touches, so the ScrollView
            owns the gesture from anywhere on the sheet; the sibling backdrop
            only receives taps that land OUTSIDE the sheet (on the dimmed
            room), so tap-outside-to-close still works. */}
        <Pressable style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={handleClose} />
        <View
          style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, height: POPUP_SHEET_HEIGHT, overflow: 'hidden' }}
        >
          {/* 2026-11-11 (hotfix, blank popup): the sheet MUST have a DEFINITE
              height. With maxHeight only, the sheet's height was content-sized
              and the ScrollView (flex: 1, flexBasis 0) measured 0px tall — the
              whole popup content was invisible and the sheet collapsed to just
              the buttons row (boss's phone, OTA 01a1ca60). POPUP_SHEET_HEIGHT
              (screen height x 0.75) gives the ScrollView a bounded viewport so
              it renders AND scrolls, and is 75% of the display (top between
              seat row 1 and row 2, boss 2026-11-11 20:41). */}
          {/* 2026-11-11 (boss, scroll): nestedScrollEnabled — the horizontal
              Privilege ScrollView inside swallows vertical drags that start
              on its cards unless the outer vertical ScrollView takes part in
              Android nested scrolling; without it the popup scrolls only when
              the drag starts outside the Privilege cards ("sometimes it
              scrolls, sometimes it doesn't"). */}
          <ScrollView style={{ flex: 1 }} nestedScrollEnabled showsVerticalScrollIndicator={false} scrollEventThrottle={16} decelerationRate={0.997}>
            {/* Cover + overlay header: back, "@", "..." */}
            <View>
              {coverImageUrl ? (
                <Image source={{ uri: coverImageUrl }} style={{ width: '100%', height: 180 }} contentFit="cover" />
              ) : (
                <LinearGradient colors={['#8B5CF6', '#EC4899', '#FB923C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: 180 }} />
              )}
              <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 56 }}>
                <Pressable onPress={handleClose} style={{ position: 'absolute', left: 4, top: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
                  <Feather name="arrow-left" size={24} color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
                </Pressable>
                <Pressable onPress={handleMentionPress} style={{ position: 'absolute', right: 44, top: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>@</Text>
                </Pressable>
                <Pressable onPress={() => setShowVidPopup((v) => !v)} style={{ position: 'absolute', right: 4, top: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
                  <Feather name="more-horizontal" size={24} color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
                </Pressable>
              </View>
              {/* Top-right "..." menu: ID (copy) + Report — everyone sees it. */}
              {showVidPopup && (
                <View style={{ position: 'absolute', top: 48, right: 12, zIndex: 50 }}>
                  <Pressable
                    onPress={() => setShowVidPopup(false)}
                    style={{ position: 'absolute', top: -48, right: -12, left: -400, bottom: -600 }}
                  />
                  <View style={{ backgroundColor: C.card, borderRadius: 12, borderWidth: 0.5, borderColor: C.border, minWidth: 200, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 8, overflow: 'hidden' }}>
                    {vId ? (
                      <Pressable onPress={handleCopyVid} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 }}>
                        <Feather name="copy" size={16} color={C.text} />
                        <Text style={{ fontSize: 15, color: C.text, marginLeft: 10 }}>ID: {vId}</Text>
                        {vidCopied ? <Text style={{ fontSize: 13, color: C.mic, marginLeft: 8 }}>Copied</Text> : null}
                      </Pressable>
                    ) : null}
                    {!isSelf ? (
                    <Pressable onPress={handleReport} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: vId ? 0.5 : 0, borderTopColor: C.border }}>
                      <Feather name="alert-triangle" size={16} color="#DC2626" />
                      <Text style={{ fontSize: 15, color: '#DC2626', marginLeft: 10 }}>Report</Text>
                    </Pressable>
                    ) : null}
                  </View>
                </View>
              )}
            </View>

            {/* DP (tap → full profile) + name + plates + chips + bio */}
            {/* 2026-11-12 (boss, Profile Screen reward): parent wrapper so
                the Profile Screen art fills cover-bottom → Privilege as
                the background of the identity block. The art is
                absolute-fill behind the DP/name/plates/chips/bio; the
                0.6 white scrim keeps the text clear (no glass here).
                pointerEvents none — taps pass through. */}
            <View>
              {profileScreen ? (
                <ProfileScreenBackground artUrl={profileScreen.artUrl} tier={profileScreen.tier} scrimOpacity={0.6} />
              ) : null}
            <View style={{ marginTop: -40, paddingHorizontal: 16 }}>
              <Pressable onPress={handleDpPress} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
                <Avatar
                  initials={member.initials}
                  color={member.color}
                  size={80}
                  speaking={false}
                  accent={accent}
                  photoURL={photoURL}
                  frameType={liveFrameId ?? undefined}
                  nobleRankIndex={member.nobleRankIndex}
                />
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: isKing ? '#FBC02D' : C.text }} numberOfLines={1}>{displayName}</Text>
                {isKing ? <KingSparkle /> : null}
              </View>
              {displayNameplates.length > 0 ? (
                <View style={{ marginTop: 6 }}>
                  <NameplateRow plates={displayNameplates} size="small" nobleRankKey={nobleRankKey} />
                </View>
              ) : null}
              {/* 2026-11-11 (boss, taller-2): each chip gets its own LIGHT pastel
                  fill + a matching soft border (role blue, followers amber,
                  location green, age pink) - distinct but light, dark text stays
                  readable. Location uses the profile screen's real PremiumLocationIcon,
                  NOT the demo lollipop emoji. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                <View style={{ backgroundColor: '#E3F2FD', borderWidth: 0.5, borderColor: '#90CAF9', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>{roleLabel}</Text>
                </View>
                <Pressable onPress={handleFollowersPress} hitSlop={4} style={{ backgroundColor: '#FFF8E1', borderWidth: 0.5, borderColor: '#FFE082', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>⭐ {followCounts.followers} Followers</Text>
                </Pressable>
                {location ? (
                  <View style={{ backgroundColor: '#E8F5E9', borderWidth: 0.5, borderColor: '#A5D6A7', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4, flexDirection: 'row', alignItems: 'center' }}>
                    <PremiumLocationIcon />
                    <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>{location}</Text>
                  </View>
                ) : null}
                {age !== null ? (
                  <View style={{ backgroundColor: '#FCE4EC', borderWidth: 0.5, borderColor: '#F48FB1', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>{age}</Text>
                  </View>
                ) : null}
              </View>
              {bio ? (
                <View>
                  <Text style={{ fontSize: 14, color: C.text, marginTop: 8 }} numberOfLines={bioExpanded ? undefined : 2}>{bio}</Text>
                  {/* Hidden measurement copy (same text/style/width, zero
                      height, invisible): onTextLayout reports the TRUE laid-out
                      line count — "More" shows ONLY when the bio exceeds 2
                      lines. No character-count heuristic. */}
                  <Text
                    style={{ fontSize: 14, color: C.text, height: 0, opacity: 0 }}
                    onTextLayout={(e) => { const isLong = e.nativeEvent.lines.length > 2; setBioIsLong((prev) => (prev === isLong ? prev : isLong)); }}
                  >{bio}</Text>
                  {bioIsLong ? (
                    <Pressable
                      onPress={() => setBioExpanded((v) => !v)}
                      hitSlop={6}
                      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}
                    >
                      <Feather name={bioExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.text} />
                      <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginLeft: 2 }}>
                        {bioExpanded ? 'Collapse' : 'More'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            </View>

            {/* Privilege — horizontally scrollable */}
            <View style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingBottom: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Privilege</Text>
                <Feather name="chevron-right" size={18} color={C.muted} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15 }} nestedScrollEnabled decelerationRate={0.997} overScrollMode="never">
                <View style={{ flexDirection: 'row' }}>
                  {/* 2026-11-11 (boss, polish): imo-style rich cards — coloured
                      backgrounds (blue Achievement / pink Honor / yellow Gift
                      Wall), large 32px art, horizontal layout (art left, label
                      + count right) so "Achievement" fits on ONE line. */}
                  <Pressable onPress={handleHonorPress} style={{ width: 156, marginRight: 10, backgroundColor: '#E3F2FD', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="award" size={32} color="#F59E0B" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Achievement</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(achievementCount, 'badge', 'badges')}</Text>
                    </View>
                  </Pressable>
                  {/* 2026-11-11 (boss, Honor card + imo reference 1000230628):
                      the Honor card shows the user's FIRST Honor badge's
                      artwork (the actual badge, like imo's purple LV.6 crown
                      badge), NOT a generic shield. URL icon -> expo-image
                      (contain, 32px); glyph icon -> Text; no badges at all ->
                      the generic shield stays (nothing to show, never fake). */}
                  <Pressable onPress={handleHonorPress} style={{ width: 156, marginRight: 10, backgroundColor: '#FCE4EC', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    {firstHonorBadge ? (
                      /^https?:\/\//i.test(firstHonorBadge.icon || '') ? (
                        <Image source={{ uri: firstHonorBadge.icon }} style={{ width: 32, height: 32 }} contentFit="contain" />
                      ) : (
                        <Text style={{ fontSize: 32 }}>{firstHonorBadge.icon}</Text>
                      )
                    ) : (
                      <Feather name="shield" size={32} color="#3B82F6" />
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Honor</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(grantedBadges.length, 'badge', 'badges')}</Text>
                    </View>
                  </Pressable>
                  {/* 2026-11-11 (boss, Gift Wall card "এবং Gifts এও" — same rule
                      as Honor): the Gift Wall card shows the user's FIRST
                      gift's artwork (the most-received gift, Gift Wall
                      default order), NOT a generic gift icon. No gifts at
                      all (or no thumbnail) -> the generic gift icon stays
                      (nothing to show, never fake). */}
                  <Pressable onPress={handleGiftsPress} style={{ width: 156, marginRight: 10, backgroundColor: '#FFF8E1', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    {firstGift && firstGift.thumbnailUrl ? (
                      <Image source={{ uri: firstGift.thumbnailUrl }} style={{ width: 32, height: 32 }} contentFit="contain" />
                    ) : (
                      <Feather name="gift" size={32} color="#EC4899" />
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Gift Wall</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(giftTotal, 'gift', 'gifts')}</Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={handleDecorationPress} style={{ width: 156, marginRight: 10, backgroundColor: '#F3E5F5', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="image" size={32} color="#8B5CF6" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Decoration</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(grantedFrames.length, 'frame', 'frames')}</Text>
                    </View>
                  </Pressable>
                </View>
              </ScrollView>
            </View>

            {/* Intimacy — horizontal tiles (Couple + Friends), SAME tiles as
                the full profile (IntimacyTiles). 2026-11-11 (boss, "Intimacy
                ও দেখায় না" + references 1000230624 RAKIB / 1000230625 Rolex):
                the popup showed only a header row ("Intimacy — 0 >"); the
                reference shows Couple / Friend / Friend tiles with photos,
                + circles when empty, and Lv. badges. Tiles render from the
                popup user's REAL data (couple partner + friends + pair
                values); empty slots (+) show only on the OWN popup, up to
                MAX_FRIENDS (5); other users with no friends get
                "No friends yet" — exactly the full profile's rules. */}
            <View style={{ marginTop: 10 }}>
              <Pressable onPress={handleIntimacyPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingBottom: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Intimacy</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: C.muted, marginRight: 2 }}>{intimacyCount}</Text>
                  <Feather name="chevron-right" size={18} color={C.muted} />
                </View>
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15 }} nestedScrollEnabled decelerationRate={0.997} overScrollMode="never">
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <CoupleTile
                    coupled={!!intimacyCouple}
                    partnerPhotoURL={intimacyCouple?.partnerUid ? (liveCouplePartner.avatar ?? null) : null}
                    partnerName={intimacyCouple?.partnerUid ? (liveCouplePartner.name || '') : ''}
                    onPress={handleIntimacyPress}
                  />
                  {intimacyFriends.map((f) => (
                    <PopupFriendTile
                      key={f.uid}
                      friendUid={f.uid}
                      pairValue={intimacyEntries.find((e) => e.otherUid === f.uid)?.value}
                      onOpenProfile={(uid, name) => { handleClose(); onViewFullProfile(uid, name); }}
                    />
                  ))}
                  {isSelf && Array.from({ length: Math.max(0, MAX_FRIENDS - intimacyFriends.length) }).map((_, i) => (
                    <FriendPlusTile key={`friend-plus-${i}`} onPress={handleIntimacyPress} />
                  ))}
                  {!isSelf && intimacyFriends.length === 0 && (
                    <View style={{ alignSelf: 'center', paddingLeft: 8 }}>
                      <Text style={{ color: C.muted, fontSize: 13 }}>No friends yet</Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          </ScrollView>

          {/* Bottom buttons: + Follow / Say hi / gift */}
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
            {!isSelf ? (
            <>
            <Pressable
              onPress={handleFollow}
              disabled={followBusy}
              style={{ flex: 1, backgroundColor: isFollowingTarget ? C.card : '#E3F2FD', borderRadius: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: followBusy ? 0.6 : 1 }}
            >
              <Feather name={isFollowingTarget ? 'check' : 'plus'} size={16} color={C.primary} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: C.primary, marginLeft: 6 }} numberOfLines={1}>{isFollowingTarget ? 'Following' : 'Follow'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setSayHiOpen(true)}
              style={{ flex: 1, backgroundColor: '#E3F2FD', borderRadius: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="message-circle" size={18} color={C.primary} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: C.primary, marginLeft: 6 }} numberOfLines={1}>Say hi</Text>
            </Pressable>
            </>
            ) : null}
            {/* 2026-11-11 (boss, own popup): the gift button needs the same
                height as the Follow / Say hi buttons. In the own popup those
                two are absent, so without paddingVertical the button collapsed
                to its 20px icon — a small pill at the bottom-left (boss's red
                arrow, 1000230616). paddingVertical 13 matches the siblings,
                so the gift button is 52x~46 in BOTH popups. */}
            <Pressable
              onPress={handleGiftPress}
              style={{ width: 52, backgroundColor: '#2196F3', borderRadius: 16, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="gift" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* 5-icon bar (role-gated) */}
          {!isSelf ? (
          <RoomUserActionBar
            viewerRole={viewerRole}
            targetRole={targetRole}
            isCommentBlocked={isCommentBlocked}
            onToggleCommentBlock={onToggleCommentBlock}
            onInvite={handleInvite}
            onKick={handleKick}
            onOpenRoleSettings={() => setPermissionOpen(true)}
          />
          ) : null}
          <RoomToast message={toast} />
        </View>

        <SayHiSheet visible={sayHiOpen} targetName={displayName} targetPhotoURL={photoURL} onClose={() => setSayHiOpen(false)} onSend={handleSayHiSend} />
        <PermissionSettingsSheet
          visible={permissionOpen}
          targetName={displayName}
          targetPhotoURL={photoURL}
          targetRole={targetRole}
          canSetAdmin={viewerRole === 'host'}
          onSetAdmin={() => { onSetAdmin(); setPermissionOpen(false); }}
          onDismissAdmin={() => { onDismissAdmin(); setPermissionOpen(false); }}
          onRemoveFromMember={() => { setPermissionOpen(false); onRemoveMember(); handleClose(); }}
          onClose={() => setPermissionOpen(false)}
        />
      </View>
    </Modal>
  );
}
