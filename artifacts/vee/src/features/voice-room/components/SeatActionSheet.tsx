import { useState, useEffect, type ComponentProps, type ReactElement } from 'react';
import { View, Text, Image, Pressable, Modal, Platform, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Participant, Role, ChannelRole, roleToLevel, canModerate } from '../types/room';

/* ─────────────────────────── Seat Action Sheet ─────────────────────────── */
/* Thin white outline line-icons matching imo's seat-menu glyphs (never emoji). */
function ImoSeatIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 11V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
      <Path d="M4 11a2 2 0 0 1 2 2v1h12v-1a2 2 0 0 1 2-2" />
      <Path d="M5 14v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
      <Path d="M7 19v1M17 19v1" />
    </Svg>
  );
}
function ImoInviteIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="9" cy="8" r="3.5" />
      <Path d="M3.5 19c.6-3 2.9-4.5 5.5-4.5S14 16 14.5 19" />
      <Path d="M16 4.5v5M13.5 7h5" />
    </Svg>
  );
}
function ImoLockIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="5" y="10.5" width="14" height="10" rx="2" />
      <Path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <Circle cx="12" cy="15.5" r="1.4" />
    </Svg>
  );
}
export function SeatActionSheet({ visible, seatIdx, member, myRole, myRoleLevel, myId, locked, audience, onClose,
  onInvite, onLock, onUnlock, onDown, onJoin, onMute, onSetAdmin, onDismissAdmin, onBlock, onUnblock, onMention, accent,
  isRoomBlocked, onKickOut, canKickOut, anchor }: {
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
  /** 2026-10-27 imo popup: window rect of the tapped seat cell, measured
   *  in VoiceRoomScreen before opening. Null = measure unavailable (fallback
   *  to a centered popup near the top). Occupied seats ignore it. */
  anchor?: { x: number; y: number; width: number; height: number } | null;
}) {
  const { t } = useTranslation();
  // 2026-10-27 (boss): the imo popup is CONTENT-SIZED, not fixed-width —
  // the card measures itself (onLayout) and is then placed centered on the
  // tapped seat's column with the measured width. Hidden (opacity 0) until
  // the first measurement so it never flashes at a wrong width/position.
  // Same logic covers the host 2-row popup (same component, fewer rows).
  const [popupW, setPopupW] = useState<number | null>(null);
  useEffect(() => { setPopupW(null); }, [visible, seatIdx, anchor?.x, anchor?.y, audience.length]);
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

  // Mute / Unmute (2026-10-24, boss: host-mute must stick + owner can
  // mute admin): this toggles the HOST-mute flag (hostMuted), never the
  // member's own `muted` — so the member's mic button cannot clear it.
  // Gate mirrors Down: canManage, plus the explicit owner→admin
  // carve-out, so the owner can always mute an admin on a seat.
  if (canManage || (isOwner && targetIsAdmin)) {
    const isMuted = member?.hostMuted ?? false;
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

  // ── 2026-10-27 imo popup (EMPTY seats only) ──────────────────────────
  // Boss: the empty-seat menu must look exactly like imo's — a small dark
  // dropdown anchored under the tapped seat, never the white bottom sheet.
  // Occupied seats fall through to the existing sheet below, untouched.
  // Host seat (seatIdx 0) NEVER gets a Lock/Unlock row: the host seat is
  // admin/owner-only by takeSeat rules, so locking it is meaningless.
  // 2026-10-27 (boss): MEDIUM sizes — text 16, icons 22, row padding
  // 12 vertical / 18 horizontal, radius 14 — and CONTENT-FIT width (see
  // popupW above): no extra dark space past the longest row text.
  if (!occupied) {
    const imoRows: { label: string; icon: ReactElement; onPress: () => void }[] = [
      { label: t('voiceRoom.seatAction.takeMic', { defaultValue: 'Take Mic' }), icon: <ImoSeatIcon />, onPress: onJoin },
    ];
    if (audience.length > 0) {
      imoRows.push({ label: t('voiceRoom.seatAction.inviteSpeaker', { defaultValue: 'Invite Speaker' }), icon: <ImoInviteIcon />, onPress: onInvite });
    }
    if (seatIdx !== 0) {
      if (locked) {
        imoRows.push({ label: t('voiceRoom.seatAction.unlockMic', { defaultValue: 'Unlock Mic' }), icon: <ImoLockIcon />, onPress: onUnlock });
      } else {
        imoRows.push({ label: t('voiceRoom.seatAction.lockMic', { defaultValue: 'Lock Mic' }), icon: <ImoLockIcon />, onPress: onLock });
      }
    }
    const ROW_HEIGHT = 46;
    const popupHeight = imoRows.length * ROW_HEIGHT + 12;
    const win = Dimensions.get('window');
    const measuredW = popupW ?? 0;
    let popupLeft = anchor
      ? anchor.x + anchor.width / 2 - measuredW / 2
      : (win.width - measuredW) / 2;
    popupLeft = Math.min(Math.max(popupLeft, 12), Math.max(12, win.width - measuredW - 12));
    let popupTop = anchor ? anchor.y + anchor.height + 8 : 180;
    if (anchor && popupTop + popupHeight > win.height - 12) {
      popupTop = anchor.y - popupHeight - 8;
    }
    if (popupTop < 12) popupTop = 12;
    return (
      <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
        <View
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && w !== popupW) setPopupW(w);
          }}
          style={{ position: 'absolute', left: popupLeft, top: popupTop,
          width: popupW ?? undefined, opacity: popupW == null ? 0 : 1,
          backgroundColor: '#1e1e20', borderRadius: 14, paddingVertical: 6,
          shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
          elevation: 12 }}>
          {imoRows.map((r, i) => (
            <Pressable key={r.label} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); r.onPress(); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18, gap: 16,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.09)' }}>
              {r.icon}
              <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
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
