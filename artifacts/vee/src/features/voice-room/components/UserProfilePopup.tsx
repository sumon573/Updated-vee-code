import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Alert, Pressable, Modal, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Avatar } from './Avatar';
import { RoomUserActionBar } from './RoomUserActionBar';
import { SayHiSheet } from './SayHiSheet';
import { PermissionSettingsSheet } from './PermissionSettingsSheet';
import { RoomToast, useRoomToast } from './RoomToast';
import { NameplateRow } from '@/src/components/NameplateRow';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import { subscribeFollowCounts, subscribeIsFollowing, followUser, unfollowUser } from '@/src/services/followService';
import { subscribeBadges, subscribeNameplates, type GrantedNameplate } from '@/src/services/badgeService';
import type { GrantedBadge } from '@/src/data/honor';
import { subscribeNoble, NOBLE_RANKS, type NobleState } from '@/src/services/nobleService';
import { subscribeSvip, isSvipActive, type SvipState } from '@/src/features/svip/svipService';
import { subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import { subscribeCoupleState, type CoupleState } from '@/src/features/intimacy/coupleLevels';
import { subscribeUserFriends, type FriendEntry } from '@/src/features/intimacy/friendService';
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
  const [intimacyCouple, setIntimacyCouple] = useState<CoupleState | null>(null);
  const [intimacyFriends, setIntimacyFriends] = useState<FriendEntry[]>([]);
  const [extraFields, setExtraFields] = useState<{ city?: string; country?: string; birthday?: string }>({});
  const [sayHiOpen, setSayHiOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [showVidPopup, setShowVidPopup] = useState(false);
  const [vidCopied, setVidCopied] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isKing = useIsKing(member?.id);
  const liveFrameId = useActiveFrame(member?.id);

  useEffect(() => { if (!member?.id) return; return subscribeUser(member.id, setTargetUser); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeFollowCounts(member.id, setFollowCounts); }, [member?.id]);
  useEffect(() => { if (!member?.id || !myUid) return; return subscribeIsFollowing(myUid, member.id, setIsFollowingTarget); }, [member?.id, myUid]);
  useEffect(() => { if (!member?.id) return; return subscribeNameplates(member.id, setGrantedNameplates); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeNoble(member.id, setNobleState); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeSvip(member.id, setSvipState); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeBadges(member.id, setGrantedBadges); }, [member?.id]);
  useEffect(() => {
    if (!member?.id) return;
    return subscribeTransactionHistory(member.id, (txs) => {
      setGiftTotal(txs.filter((tx) => tx.type === 'gift_received').length);
    });
  }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeCoupleState(member.id, setIntimacyCouple); }, [member?.id]);
  useEffect(() => { if (!member?.id) return; return subscribeUserFriends(member.id, setIntimacyFriends); }, [member?.id]);
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
  const intimacyCount = (intimacyCouple ? 1 : 0) + intimacyFriends.length;
  const age = ageFromBirthday(extraFields.birthday);
  const location = extraFields.city || extraFields.country || '';
  const roleLabel = targetRole === 'host' ? 'Owner' : targetRole === 'admin' ? 'Admin' : 'Member';

  // ── Handlers (plain functions — never hooks below the early return) ───
  const handleClose = () => {
    setSayHiOpen(false);
    setPermissionOpen(false);
    setShowVidPopup(false);
    onClose();
  };
  const handleFollow = async () => {
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
    onViewFullProfile(member.id, displayName);
  };
  const handleMentionPress = () => {
    onMention(displayName);
    handleClose();
  };
  const handleGiftPress = () => {
    onGift(member);
    handleClose();
  };
  const handleSayHiSend = async (greeting: string, remark: string) => {
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
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={handleClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%', overflow: 'hidden' }}
        >
          <ScrollView showsVerticalScrollIndicator={false} scrollEventThrottle={16} decelerationRate={0.997}>
            {/* Cover + overlay header: back, "@", "..." */}
            <View>
              {coverImageUrl ? (
                <Image source={{ uri: coverImageUrl }} style={{ width: '100%', height: 120 }} contentFit="cover" />
              ) : (
                <LinearGradient colors={['#8B5CF6', '#EC4899', '#FB923C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: 120 }} />
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
                    <Pressable onPress={handleReport} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: vId ? 0.5 : 0, borderTopColor: C.border }}>
                      <Feather name="alert-triangle" size={16} color="#DC2626" />
                      <Text style={{ fontSize: 15, color: '#DC2626', marginLeft: 10 }}>Report</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>

            {/* DP (tap → full profile) + name + plates + chips + bio */}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: isKing ? '#FBC02D' : C.text }} numberOfLines={1}>{displayName}</Text>
                {isKing ? <KingSparkle /> : null}
              </View>
              {displayNameplates.length > 0 ? (
                <View style={{ marginTop: 8 }}>
                  <NameplateRow plates={displayNameplates} size="small" nobleRankKey={nobleRankKey} />
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                <View style={{ borderWidth: 0.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>{roleLabel}</Text>
                </View>
                <View style={{ borderWidth: 0.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>⭐ {followCounts.followers} Followers</Text>
                </View>
                {location ? (
                  <View style={{ borderWidth: 0.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>📍 {location}</Text>
                  </View>
                ) : null}
                {age !== null ? (
                  <View style={{ borderWidth: 0.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: C.text, fontWeight: '500' }}>{age}</Text>
                  </View>
                ) : null}
              </View>
              {bio ? (
                <Text style={{ fontSize: 14, color: C.text, marginTop: 8 }} numberOfLines={1}>{bio}</Text>
              ) : null}
            </View>

            {/* Privilege — horizontally scrollable */}
            <View style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingBottom: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Privilege</Text>
                <Feather name="chevron-right" size={18} color={C.muted} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15 }} nestedScrollEnabled directionalLockEnabled decelerationRate={0.997} overScrollMode="never">
                <View style={{ flexDirection: 'row' }}>
                  {/* 2026-11-11 (boss, polish): imo-style rich cards — coloured
                      backgrounds (blue Achievement / pink Honor / yellow Gift
                      Wall), large 32px art, horizontal layout (art left, label
                      + count right) so "Achievement" fits on ONE line. */}
                  <Pressable onPress={handleDpPress} style={{ width: 156, marginRight: 10, backgroundColor: '#E3F2FD', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="award" size={32} color="#F59E0B" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Achievement</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(achievementCount, 'badge', 'badges')}</Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={handleDpPress} style={{ width: 156, marginRight: 10, backgroundColor: '#FCE4EC', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="shield" size={32} color="#3B82F6" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Honor</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(grantedBadges.length, 'badge', 'badges')}</Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={handleDpPress} style={{ width: 156, marginRight: 10, backgroundColor: '#FFF8E1', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="gift" size={32} color="#EC4899" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }} numberOfLines={1} adjustsFontSizeToFit>Gift Wall</Text>
                      <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }} numberOfLines={1}>{plural(giftTotal, 'gift', 'gifts')}</Text>
                    </View>
                  </Pressable>
                </View>
              </ScrollView>
            </View>

            {/* Intimacy — tap → full profile */}
            <Pressable onPress={handleDpPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingTop: 14, paddingBottom: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Intimacy</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, color: C.muted, marginRight: 2 }}>{intimacyCount}</Text>
                <Feather name="chevron-right" size={18} color={C.muted} />
              </View>
            </Pressable>
          </ScrollView>

          {/* Bottom buttons: + Follow / Say hi / gift */}
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
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
            <Pressable
              onPress={handleGiftPress}
              style={{ width: 52, backgroundColor: '#2196F3', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="gift" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* 5-icon bar (role-gated) */}
          <RoomUserActionBar
            viewerRole={viewerRole}
            targetRole={targetRole}
            isCommentBlocked={isCommentBlocked}
            onToggleCommentBlock={onToggleCommentBlock}
            onInvite={handleInvite}
            onKick={handleKick}
            onOpenRoleSettings={() => setPermissionOpen(true)}
          />
          <RoomToast message={toast} />
        </Pressable>

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
      </Pressable>
    </Modal>
  );
}
