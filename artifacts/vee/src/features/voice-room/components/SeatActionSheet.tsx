import type { ComponentProps } from 'react';
import { View, Text, Image, Pressable, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Participant, Role, ChannelRole, roleToLevel, canModerate } from '../types/room';

/* ─────────────────────────── Seat Action Sheet ─────────────────────────── */
export function SeatActionSheet({ visible, seatIdx, member, myRole, myRoleLevel, myId, locked, audience, onClose,
  onInvite, onLock, onUnlock, onDown, onJoin, onMute, onSetAdmin, onDismissAdmin, onBlock, onUnblock, onMention, accent,
  isRoomBlocked, onKickOut, canKickOut }: {
  visible: boolean; seatIdx: number; member?: Participant | null;
  myRole: Role; myRoleLevel?: number; myId: string; locked: boolean; audience: Participant[];
  onClose: () => void;
  onInvite: () => void; onLock: () => void; onUnlock: () => void;
  onDown: () => void; onJoin: () => void; onMute: () => void;
  onSetAdmin: () => void; onDismissAdmin: () => void;
  onBlock: () => void;
  /** Unblock (toggle when the member is currently room-blocked) */
  onUnblock: () => void;
  /** True when the member currently holds an active room-block */
  isRoomBlocked?: boolean;
  /** Inserts "@MemberName " into the chat input. */
  onMention: () => void;
  accent: string;
  /** SVIP kick-out (spends points, temporary removal). */
  onKickOut?: () => void;
  /** True when the viewer holds the SVIP kick-out privilege. */
  canKickOut?: boolean;
}) {
  const { t } = useTranslation();
  const isOwner = myRole === 'host';
  const isAdminMe = myRole === 'admin';
  const occupied = !!member;
  const isMe = member?.id === myId;
  const targetIsOwner = member?.role === 'host';
  const targetIsAdmin = member?.role === 'admin';

  // 2026-10-19 (IMO port Phase 1): numeric hierarchy gates.
  // myRoleLevel (9000/8000/7000) preferred; falls back to string-role derivation.
  const myLevel = myRoleLevel ?? roleToLevel(myRole);
  const targetLevel = member ? (member.roleLevel ?? roleToLevel(member.role)) : ChannelRole.PASSERBY;
  // Can manage this member? — strictly higher numeric level, never self, never the owner.
  const canManage = occupied && !isMe && !targetIsOwner && canModerate(myLevel, targetLevel);
  const canSetAdmin = myLevel >= ChannelRole.OWNER && occupied && !isMe && !targetIsOwner && !targetIsAdmin;
  const canDismissAdmin = myLevel >= ChannelRole.OWNER && targetIsAdmin && !isMe;
  // "Join Seat" only makes sense for empty seats.
  const canJoin = !occupied;

  type ActionItem = {
    icon: ComponentProps<typeof Feather>['name'];
    label: string;
    sub: string;
    color: string;
    bg: string;
    border: string;
    onPress: () => void;
  };

  const actions: ActionItem[] = [];

  // @ Mention (occupied, non-self members only)
  if (occupied && !isMe) {
    actions.push({
      icon: 'at-sign',
      label: t('voiceRoom.seatAction.mention', { defaultValue: '@ Mention' }),
      sub: t('voiceRoom.seatAction.mentionSub', { defaultValue: 'Insert @mention into chat' }),
      color: accent, bg: accent + '18', border: accent + '44', onPress: onMention,
    });
  }

  // Invite to empty seat from audience
  if (!occupied && audience.length > 0) {
    actions.push({
      icon: 'user-plus',
      label: t('voiceRoom.seatAction.invite'),
      sub: t('voiceRoom.seatAction.inviteSub'),
      color: accent, bg: accent + '18', border: accent + '44', onPress: onInvite,
    });
  }

  // Lock / Unlock
  if (!occupied || !targetIsOwner) {
    if (locked) {
      actions.push({
        icon: 'unlock',
        label: t('voiceRoom.seatAction.unlockSeat'),
        sub: t('voiceRoom.seatAction.unlockSeatSub'),
        color: C.gold, bg: C.gold + '18', border: C.gold + '44', onPress: onUnlock,
      });
    } else {
      actions.push({
        icon: 'lock',
        label: t('voiceRoom.seatAction.lockSeat'),
        sub: t('voiceRoom.seatAction.lockSeatSub'),
        color: C.gold, bg: C.gold + '18', border: C.gold + '44', onPress: onLock,
      });
    }
  }

  // Down (remove from seat to audience)
  if (canManage || (isOwner && targetIsAdmin)) {
    actions.push({
      icon: 'arrow-down',
      label: t('voiceRoom.seatAction.down'),
      sub: t('voiceRoom.seatAction.downSub'),
      color: C.sub, bg: 'rgba(255,255,255,0.06)', border: C.borderFaint, onPress: onDown,
    });
  }

  // Mute / Unmute
  if (canManage) {
    const isMuted = member?.muted ?? false;
    actions.push({
      icon: isMuted ? 'mic' : 'mic-off',
      label: isMuted ? t('voiceRoom.seatAction.unmute') : t('voiceRoom.seatAction.mute'),
      sub: isMuted ? t('voiceRoom.seatAction.unmuteSub') : t('voiceRoom.seatAction.muteSub'),
      color: isMuted ? C.mic : C.red,
      bg: isMuted ? C.mic + '18' : C.red + '18',
      border: isMuted ? C.mic + '44' : C.red + '44',
      onPress: onMute,
    });
  }

  // Set Admin
  if (canSetAdmin) {
    actions.push({
      icon: 'shield',
      label: t('voiceRoom.seatAction.setAdmin'),
      sub: t('voiceRoom.seatAction.setAdminSub'),
      color: accent, bg: accent + '18', border: accent + '44', onPress: onSetAdmin,
    });
  }

  // Dismiss Admin
  if (canDismissAdmin) {
    actions.push({
      icon: 'shield-off',
      label: t('voiceRoom.seatAction.dismissAdmin'),
      sub: t('voiceRoom.seatAction.dismissAdminSub'),
      color: C.sub, bg: 'rgba(255,255,255,0.06)', border: C.borderFaint, onPress: onDismissAdmin,
    });
  }

  // Join seat (myself)
  if (canJoin) {
    actions.push({
      icon: 'log-in',
      label: t('voiceRoom.seatAction.joinSeat'),
      sub: t('voiceRoom.seatAction.joinSeatSub', { number: seatIdx + 1 }),
      color: accent, bg: accent + '18', border: accent + '44', onPress: onJoin,
    });
  }

  // Room Block <-> Unblock toggle (2026-10-12)
  if (canManage) {
    actions.push({
      icon: isRoomBlocked ? 'check-circle' : 'slash',
      label: isRoomBlocked
        ? t('voiceRoom.memberManage.unblockRoom')
        : t('voiceRoom.seatAction.roomBlock'),
      sub: t('voiceRoom.seatAction.roomBlockSub'),
      color: isRoomBlocked ? '#22C55E' : C.red,
      bg: isRoomBlocked ? '#22C55E18' : C.red + '18',
      border: isRoomBlocked ? '#22C55E44' : C.red + '44',
      onPress: isRoomBlocked ? onUnblock : onBlock,
    });
  }

  // SVIP Kick-out (2026-10-19): spends 50 SVIP points, temporary removal.
  // Available to SVIP 3+ even without room moderation rights (IMO model).
  if (canKickOut && onKickOut && member && member.id !== myId) {
    actions.push({
      icon: 'zap',
      label: 'SVIP Kick-Out',
      sub: 'Remove from room • 50 SVIP points',
      color: '#FF9800',
      bg: '#FF980018', border: '#FF980044',
      onPress: onKickOut,
    });
  }

  const roleLabel = member
    ? (member.role === 'host'
        ? t('voiceRoom.seatAction.roleOwner')
        : member.role === 'admin'
          ? t('voiceRoom.seatAction.roleAdmin')
          : t('voiceRoom.seatAction.roleMember'))
    : '';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#0F0A1E', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: accent + '44', paddingBottom: Platform.OS === 'web' ? 34 : 20 }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12, marginBottom: 14 }} />

        {/* Member header — Issue 5: show profile photo if available */}
        <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {member ? (
              <>
                <View style={{ width: 44, height: 44, borderRadius: 22,
                  overflow: 'hidden',
                  backgroundColor: member.color + '33',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: member.color + '55', marginRight: 12 }}>
                  {member.photoURL ? (
                    <Image
                      source={{ uri: member.photoURL }}
                      style={{ width: 44, height: 44, borderRadius: 22 }}
                    />
                  ) : (
                    <Text style={{ color: member.color, fontSize: 15, fontWeight: '800' }}>
                      {member.initials}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '900' }}>{member.name}</Text>
                  <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {t('voiceRoom.seatAction.seatLabel', { number: seatIdx + 1 })}
                    {' · '}
                    {roleLabel}
                    {isMe ? ` · ${t('voiceRoom.seatAction.youSuffix')}` : ''}
                  </Text>
                </View>
              </>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '900' }}>
                  {t('voiceRoom.seatAction.seatLabel', { number: seatIdx + 1 })}
                </Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {locked ? t('voiceRoom.seatAction.lockedSeat') : t('voiceRoom.seatAction.emptySeat')}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          {actions.map((a, i) => (
            <Pressable key={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); a.onPress(); }}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: a.bg,
                borderRadius: 16, padding: 14, borderWidth: 1, borderColor: a.border }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: a.color + '22',
                alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Feather name={a.icon} size={17} color={a.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{a.label}</Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 1 }}>{a.sub}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.muted} />
            </Pressable>
          ))}

          {actions.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Text style={{ color: C.muted, fontSize: 14 }}>
                {t('voiceRoom.seatAction.noActions')}
              </Text>
            </View>
          )}
        </View>

        <Pressable onPress={onClose} style={{ margin: 16, paddingVertical: 14,
          alignItems: 'center', backgroundColor: C.card, borderRadius: 14,
          borderWidth: 1, borderColor: C.borderFaint }}>
          <Text style={{ color: C.sub, fontWeight: '700', fontSize: 15 }}>
            {t('voiceRoom.seatAction.cancel')}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
