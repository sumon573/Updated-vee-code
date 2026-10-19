import React, { useState, useEffect } from 'react';
import { View, Text, Image, Alert, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Participant, Role, ChannelRole, roleToLevel, canModerate } from '../types/room';
import { Avatar } from './Avatar';
import { getOfficialBadgeIconUrl } from '@/src/services/verifiedService';
import { useVerifiedBadge } from '@/src/hooks/useVerifiedBadge';
import { truncateTo12 } from '@/src/utils/truncateName';
import MistNameplate from '@/src/components/MistNameplate';
import { rewardsForRankKey } from '@/src/services/nobleRewardsCatalog';
import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';

/* ─────────────────────────── Member Manage Modal ─────────────────────────── */
export function MemberManageModal({
  member, myRole, myRoleLevel, myId, onClose, onGift, onMention, onBlock, onUnblock, onReport, onSetAdmin, onDismissAdmin,
  onViewProfile, onViewOtherProfile, onEditProfile,
  onDown, onDownFromSeat, isSeated,
  isCommentBlocked, isRoomBlocked,
}: {
  member: Participant | null; myRole: Role; myRoleLevel?: number; myId: string; onClose: () => void;
  onGift: () => void; onMention: (name: string) => void;
  onBlock: (action: 'room-block' | 'comment-block') => void;
  /** Unblock the member (shown as a toggle when they are currently blocked) */
  onUnblock: () => void;
  /** True when the member currently holds an active comment-block */
  isCommentBlocked?: boolean;
  /** True when the member currently holds an active room-block */
  isRoomBlocked?: boolean;
  onReport?: (memberId: string, memberName: string) => void;
  onSetAdmin: () => void; onDismissAdmin: () => void;
  onViewProfile: () => void;
  /** View another user's profile by navigating to /user-profile */
  onViewOtherProfile?: (uid: string, name: string) => void;
  onEditProfile: () => void;
  /** Leave my own seat (self view only — replaces Copy V ID) */
  onDown?: () => void;
  /** Owner/admin: move this member down from their seat */
  onDownFromSeat?: () => void;
  /** True when the member being viewed is currently on a seat */
  isSeated?: boolean;
}) {
  const { t } = useTranslation();

  // 2026-10-15 (Sumon, URGENT): Rules of Hooks — ALL hooks must run before
  // any early return. Previously `if (!member) return null` sat ABOVE these
  // hooks, so opening the modal (member null → set) changed the hook count
  // between renders → React threw "Rendered more hooks than during the
  // previous render" → the "Something went wrong" screen on EVERY seat /
  // audience ID tap. useVerifiedBadge already accepts undefined uid safely.
  const hasVerifiedBadge = useVerifiedBadge(member?.id);
  const [badgeIconUrl, setBadgeIconUrl] = useState<string | null>(null);
  useEffect(() => {
    getOfficialBadgeIconUrl().then(setBadgeIconUrl).catch(() => setBadgeIconUrl(null));
  }, []);

  // 2026-10-16 (Sumon): Nobel nameplate next to the role badge — 100x20,
  // same perfect size as the profile screen. Animated (mist) type for Viscount+.
  const [nameplate, setNameplate] = useState<{ icon: string; mistColor: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const resolvePlate = (plateId: string) => {
      const rankKey = plateId.replace('noble-plate-', '');
      const entry = rewardsForRankKey(rankKey);
      const mistColor = entry?.nameplate.mistColor || null;
      const designUrl = entry?.nameplate.designUrl;
      if (designUrl && /^https?:\/\//i.test(designUrl)) {
        if (!cancelled) setNameplate({ icon: designUrl, mistColor });
      } else {
        get(ref(database, `users/${member?.id}/nameplates/${plateId}`)).then((snap) => {
          if (cancelled) return;
          const icon = snap.val()?.icon;
          if (icon && /^https?:\/\//i.test(icon)) {
            setNameplate({ icon, mistColor });
          } else {
            setNameplate(null);
          }
        }).catch(() => { if (!cancelled) setNameplate(null); });
      }
    };
    // 2026-10-16: activeNameplate may not be on seat data — fetch directly
    const plateId = (member as any)?.activeNameplate;
    if (plateId && typeof plateId === 'string') {
      resolvePlate(plateId);
    } else if (member?.id) {
      get(ref(database, `users/${member.id}/activeNameplate`)).then((snap) => {
        if (cancelled) return;
        const pid = snap.val();
        if (pid && typeof pid === 'string') resolvePlate(pid);
        else setNameplate(null);
      }).catch(() => { if (!cancelled) setNameplate(null); });
    } else {
      setNameplate(null);
    }
    return () => { cancelled = true; };
  }, [member?.id, (member as any)?.activeNameplate]);

  if (!member) return null;
  const targetIsOwner = member.role === 'host';
  const targetIsAdmin = member.role === 'admin';
  const isMe = member.id === myId;

  // 2026-10-19 (IMO port Phase 1): numeric hierarchy gates (same semantics as
  // the string checks: strictly higher level may manage; only owner promotes).
  const myLevel = myRoleLevel ?? roleToLevel(myRole);
  const targetLevel = member.roleLevel ?? roleToLevel(member.role);
  const canManage = !isMe && !targetIsOwner && canModerate(myLevel, targetLevel);
  const canSetAdmin  = myLevel >= ChannelRole.OWNER && !isMe && !targetIsOwner && !targetIsAdmin;
  const canDismissAdmin = myLevel >= ChannelRole.OWNER && targetIsAdmin;

  const roleLabel = member.role === 'host'
    ? t('voiceRoom.memberManage.roleOwner')
    : member.role === 'admin'
      ? t('voiceRoom.memberManage.roleAdmin')
      : t('voiceRoom.memberManage.roleMember');

  // 2026-10-14 (Sumon): frame + verified badge shown in profile modal header
  // (hooks live above the early return — see note there).

  return (
    <Modal visible={!!member} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#0F0A1E', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: C.border, padding: 24 }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginBottom: 20 }} />

        {/* ── Profile header: large photo + name + role badge ── */}
        {/* 2026-10-14 (Sumon): show frame + verified badge in modal */}
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <View style={{ marginBottom: 12 }}>
            <Avatar
              initials={member.initials}
              color={member.color}
              size={76}
              speaking={member.speaking}
              accent={C.primary}
              photoURL={member.photoURL}
              frameType={(member as any).activeFrame || undefined}
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>{truncateTo12(member.name)}</Text>
            {hasVerifiedBadge && badgeIconUrl && (
              <Image
                source={{ uri: badgeIconUrl }}
                style={{ width: 18, height: 18, marginLeft: 6 }}
                resizeMode="contain"
              />
            )}
          </View>
          {/* 2026-10-16 (Sumon): Role + Nobel nameplate side by side.
              Nameplate is 100x20 — the exact profile-screen size. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
            <View style={{ backgroundColor: C.primary + '33', borderRadius: 20,
              paddingHorizontal: 12, paddingVertical: 4, marginRight: nameplate ? 8 : 0 }}>
              <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>{roleLabel}</Text>
            </View>
            {nameplate && (
              nameplate.mistColor ? (
                <MistNameplate
                  imageUrl={nameplate.icon}
                  mistColor={nameplate.mistColor}
                  width={100}
                  height={20}
                />
              ) : (
                <Image
                  source={{ uri: nameplate.icon }}
                  style={{ width: 100, height: 20 }}
                  resizeMode="contain"
                />
              )
            )}
          </View>
        </View>

        {isMe ? (
          // ── Self view: View Profile, Edit Profile, Down Mic / Leave Seat ──
          <>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onViewProfile(); onClose(); }}
              style={{ backgroundColor: C.primary + '22', borderRadius: 14, paddingVertical: 13, marginBottom: 8,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: C.primary + '55' }}>
              <Feather name="user" size={16} color={C.primary} />
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>
                {t('voiceRoom.memberManage.viewProfile')}
              </Text>
            </Pressable>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onEditProfile(); onClose(); }}
              style={{ backgroundColor: C.card, borderRadius: 14, paddingVertical: 13, marginBottom: 8,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: C.borderFaint }}>
              <Feather name="edit-2" size={15} color={C.sub} />
              <Text style={{ color: C.sub, fontWeight: '700', fontSize: 13 }}>
                {t('voiceRoom.memberManage.editProfile')}
              </Text>
            </Pressable>
            {/* Issue 2: Down Mic / Leave Seat replaces Copy V ID */}
            {isSeated && onDown && (
              <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onDown(); onClose(); }}
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 14, paddingVertical: 13, marginBottom: 8,
                  alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                  borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' }}>
                <Feather name="mic-off" size={15} color={C.red} />
                <Text style={{ color: C.red, fontWeight: '700', fontSize: 13 }}>
                  {t('voiceRoom.memberManage.downMic', { defaultValue: 'Down Mic / Leave Seat' })}
                </Text>
              </Pressable>
            )}
            {/* Self-gift: send diamonds to your own ID */}
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onGift(); }}
              style={{ backgroundColor: C.pink + '22', borderRadius: 14, paddingVertical: 13, marginBottom: 8,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: C.pink + '44' }}>
              <Text style={{ fontSize: 16 }}>🎁</Text>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>
                {t('voiceRoom.memberManage.giftSelf', { defaultValue: 'Send Gift to Myself' })}
              </Text>
            </Pressable>
          </>
        ) : (
        <>
          {/* View other user's profile */}
          {onViewOtherProfile && (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onViewOtherProfile(member.id, member.name); onClose(); }}
              style={{ backgroundColor: C.primary + '22', borderRadius: 14, paddingVertical: 13, marginBottom: 8,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: C.primary + '55' }}
            >
              <Feather name="user" size={16} color={C.primary} />
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>
                {t('voiceRoom.memberManage.viewProfile')}
              </Text>
            </Pressable>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMention(member.name); onClose(); }}
              style={{ flex: 1, backgroundColor: C.primary + '22', borderRadius: 14, paddingVertical: 13,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
                borderWidth: 1, borderColor: C.primary + '55' }}>
              <Text style={{ color: C.primary, fontSize: 18, fontWeight: '900' }}>@</Text>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>
                {t('voiceRoom.memberManage.mention')}
              </Text>
            </Pressable>
            <Pressable onPress={onGift}
              style={{ flex: 1, backgroundColor: C.pink + '22', borderRadius: 14, paddingVertical: 13,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
                borderWidth: 1, borderColor: C.pink + '44' }}>
              <Text style={{ fontSize: 16 }}>🎁</Text>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>
                {t('voiceRoom.memberManage.gift')}
              </Text>
            </Pressable>
          </View>
        </>
        )}

        {canSetAdmin && (
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSetAdmin(); }}
            style={{ backgroundColor: C.gold + '18', borderRadius: 14, paddingVertical: 12, marginBottom: 8,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
              borderWidth: 1, borderColor: C.gold + '44' }}>
            <Feather name="shield" size={16} color={C.gold} />
            <Text style={{ color: C.gold, fontWeight: '700' }}>
              {t('voiceRoom.memberManage.setAdmin')}
            </Text>
          </Pressable>
        )}

        {canDismissAdmin && (
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onDismissAdmin(); }}
            style={{ backgroundColor: C.card, borderRadius: 14, paddingVertical: 12, marginBottom: 8,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
              borderWidth: 1, borderColor: C.borderFaint }}>
            <Feather name="shield-off" size={16} color={C.sub} />
            <Text style={{ color: C.sub, fontWeight: '700' }}>
              {t('voiceRoom.memberManage.dismissAdmin')}
            </Text>
          </Pressable>
        )}

        {/* Issue 4: Owner/Admin — Down From Seat (only if member is seated) */}
        {canManage && isSeated && onDownFromSeat && (
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onDownFromSeat(); }}
            style={{ backgroundColor: C.card, borderRadius: 14, paddingVertical: 12, marginBottom: 8,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
              borderWidth: 1, borderColor: C.borderFaint }}>
            <Feather name="arrow-down-circle" size={15} color={C.sub} />
            <Text style={{ color: C.sub, fontWeight: '700' }}>
              {t('voiceRoom.memberManage.downFromSeat', { defaultValue: 'Down From Seat' })}
            </Text>
          </Pressable>
        )}

        {canManage && (
          <>
            {/* Comment block <-> unblock toggle (2026-10-12): the sheet always
                reflects the member's CURRENT state — blocked shows Unblock. */}
            <Pressable onPress={() => { if (isCommentBlocked) onUnblock(); else onBlock('comment-block'); }}
              style={{ backgroundColor: isCommentBlocked ? 'rgba(34,197,94,0.1)' : C.card, borderRadius: 14, paddingVertical: 12, marginBottom: 8,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: isCommentBlocked ? 'rgba(34,197,94,0.35)' : C.borderFaint }}>
              <Feather name={isCommentBlocked ? 'check-circle' : 'message-square'} size={15} color={isCommentBlocked ? '#22C55E' : C.sub} />
              <Text style={{ color: isCommentBlocked ? '#22C55E' : C.sub, fontWeight: '700' }}>
                {isCommentBlocked
                  ? t('voiceRoom.memberManage.unblockComment')
                  : t('voiceRoom.memberManage.commentBlock')}
              </Text>
            </Pressable>
            <Pressable onPress={() => { if (isRoomBlocked) onUnblock(); else onBlock('room-block'); }}
              style={{ backgroundColor: isRoomBlocked ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 14, paddingVertical: 12, marginBottom: 8,
                alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: isRoomBlocked ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.3)' }}>
              <Feather name={isRoomBlocked ? 'check-circle' : 'slash'} size={15} color={isRoomBlocked ? '#22C55E' : C.red} />
              <Text style={{ color: isRoomBlocked ? '#22C55E' : C.red, fontWeight: '700' }}>
                {isRoomBlocked
                  ? t('voiceRoom.memberManage.unblockRoom')
                  : t('voiceRoom.memberManage.roomBlock')}
              </Text>
            </Pressable>
          </>
        )}

        {!isMe && !targetIsOwner && !canManage && (
          <Pressable onPress={() => {
            if (onReport) {
              onReport(member.id, member.name);
            } else {
              Alert.alert(
                t('voiceRoom.memberManage.reportedTitle'),
                t('voiceRoom.memberManage.reportedMsg', { name: member.name }),
              );
              onClose();
            }
          }}
            style={{ backgroundColor: C.card, borderRadius: 14, paddingVertical: 12, marginBottom: 8,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
              borderWidth: 1, borderColor: C.borderFaint }}>
            <Feather name="flag" size={15} color={C.sub} />
            <Text style={{ color: C.sub, fontWeight: '700' }}>
              {t('voiceRoom.memberManage.report')}
            </Text>
          </Pressable>
        )}

        <Pressable onPress={onClose} style={{ paddingVertical: 10, alignItems: 'center' }}>
          <Text style={{ color: C.muted, fontSize: 14 }}>
            {t('voiceRoom.memberManage.close')}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
