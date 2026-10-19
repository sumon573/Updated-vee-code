/**
 * SeatQueueModal — IMO VrWaitingLineDialog port (2026-10-19).
 *
 * IMO behavior: users queue for seats; the host sees an ordered waiting list
 * and admits/declines in order; the waiter sees their position in line.
 * Vee backend: existing roomSeatRequests node (send/subscribe/approve/reject).
 *
 * This file also exports admitSeatRequest(), the host-side admit flow that
 * used to live inline in VoiceRoomScreen's Alert dialog — same checks
 * (seat still empty, not locked, requester still in audience), same takeSeat
 * + approve + system message. Zero logic change, new home.
 */
import { useMemo } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { C } from '../constants/theme';
import {
  takeSeat,
  approveSeatRequest,
  rejectSeatRequest,
  type SeatRequest,
} from '../services/firebaseRoomService';
import { sendRoomChatMsg } from '../services/firebaseRoomChatService';
import { getErrorCause } from '@/src/utils/errorDisplay';

export type AdmitResult = { ok: true } | { ok: false; title: string; message: string };

/** Host admits one waiting request: seat checks → takeSeat → approve → system msg. */
export async function admitSeatRequest(
  roomId: string,
  req: SeatRequest,
  t: (k: string, o?: Record<string, unknown>) => string,
): Promise<AdmitResult> {
  try {
    const [seatsSnap, lockedSnap] = await Promise.all([
      get(ref(database, `rooms/${roomId}/seats/${req.seatIdx}`)),
      get(ref(database, `rooms/${roomId}/lockedSeats/${req.seatIdx}`)),
    ]);
    if (seatsSnap.exists()) {
      await rejectSeatRequest(roomId, req.id).catch(() => {});
      return { ok: false, title: t('voiceRoom.screen.seatNoLongerEmpty'), message: t('voiceRoom.screen.seatNoLongerEmptyMsg') };
    }
    if (lockedSnap.exists() && lockedSnap.val() === true) {
      await rejectSeatRequest(roomId, req.id).catch(() => {});
      return { ok: false, title: t('voiceRoom.screen.seatLocked'), message: t('voiceRoom.screen.seatLockedMsg') };
    }
    const audienceSnap = await get(ref(database, `rooms/${roomId}/audience/${req.userId}`));
    if (!audienceSnap.exists()) {
      await rejectSeatRequest(roomId, req.id).catch(() => {});
      return { ok: false, title: t('voiceRoom.screen.error'), message: t('voiceRoom.screen.userLeftRoom', { name: req.userName }) };
    }
    const seatResult = await takeSeat(roomId, req.seatIdx, {
      userId: req.userId,
      userName: req.userName,
      initials: req.initials,
      color: req.color,
      muted: true,
      role: 'member',
    });
    if (!seatResult.success) {
      await rejectSeatRequest(roomId, req.id).catch(() => {});
      return { ok: false, title: t('voiceRoom.screen.seatNoLongerEmpty'), message: t('voiceRoom.screen.seatNoLongerEmptyMsg') };
    }
    await approveSeatRequest(roomId, req.id);
    await sendRoomChatMsg(roomId, {
      senderId: 'system',
      senderName: 'System',
      senderColor: C.gold,
      text: t('voiceRoom.screen.memberJoinedSeatApproved', { name: req.userName, number: req.seatIdx + 1 }),
      ts: Date.now(),
    }).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return { ok: true };
  } catch (e) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    return { ok: false, title: t('voiceRoom.screen.error'), message: t('voiceRoom.screen.muteFailedWithCause', { cause: getErrorCause(e) }) };
  }
}

function waitingMinutes(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? '1m' : `${m}m`;
}

export function SeatQueueModal({ visible, roomId, requests, myUid, isHost, myPosition, onClose, onCancelMine }: {
  visible: boolean;
  roomId: string;
  requests: SeatRequest[];
  myUid: string | null;
  isHost: boolean;
  /** 1-based position of the viewer in the queue, or null when not queued */
  myPosition: number | null;
  onClose: () => void;
  onCancelMine: () => void;
}) {
  const { t } = useTranslation();
  const ordered = useMemo(() => [...requests].sort((a, b) => a.ts - b.ts), [requests]);

  const handleAdmit = async (req: SeatRequest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const res = await admitSeatRequest(roomId, req, t as (k: string, o?: Record<string, unknown>) => string);
    if (!res.ok) Alert.alert(res.title, res.message);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%',
        paddingBottom: 28,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <Feather name="users" size={18} color="#05b5fa" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.queue.title')}
          </Text>
          {ordered.length > 0 && (
            <View style={{ backgroundColor: '#E3F2FD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginRight: 8 }}>
              <Text style={{ color: '#007AFF', fontSize: 13, fontWeight: '800' }}>{ordered.length}</Text>
            </View>
          )}
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        {myPosition !== null && (
          <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: '#E3F2FD', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="clock" size={16} color="#007AFF" />
            <Text style={{ color: '#007AFF', fontSize: 14, fontWeight: '700', marginLeft: 8, flex: 1 }}>
              {t('voiceRoom.queue.youAreNext', { n: myPosition })}
            </Text>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCancelMine(); }}
              style={{ backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '700' }}>{t('voiceRoom.queue.cancel')}</Text>
            </Pressable>
          </View>
        )}

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
          {ordered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 36 }}>
              <Feather name="user-check" size={40} color="#C7C7CC" />
              <Text style={{ color: '#8E8E93', fontSize: 14, marginTop: 12 }}>
                {t('voiceRoom.queue.empty')}
              </Text>
            </View>
          ) : (
            ordered.map((req, idx) => {
              const isMe = myUid !== null && req.userId === myUid;
              return (
                <View key={req.id} style={{
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                  borderBottomWidth: idx === ordered.length - 1 ? 0 : 0.5, borderBottomColor: '#E5E5EA',
                }}>
                  <View style={{
                    width: 30, height: 30, borderRadius: 15, backgroundColor: '#F2F2F7',
                    alignItems: 'center', justifyContent: 'center', marginRight: 10,
                  }}>
                    <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '800' }}>{idx + 1}</Text>
                  </View>
                  <View style={{
                    width: 44, height: 44, borderRadius: 22, backgroundColor: (req.color || '#05b5fa') + '22',
                    alignItems: 'center', justifyContent: 'center', marginRight: 12,
                  }}>
                    <Text style={{ color: req.color || '#05b5fa', fontSize: 15, fontWeight: '800' }}>{req.initials || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#000', fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                      {req.userName || t('voiceRoom.queue.anonymous')}{isMe ? ` (${t('voiceRoom.queue.you')})` : ''}
                    </Text>
                    <Text style={{ color: '#8E8E93', fontSize: 12, marginTop: 2 }}>
                      {t('voiceRoom.queue.wantsSeat', { n: req.seatIdx + 1 })} · {waitingMinutes(req.ts)}
                    </Text>
                  </View>
                  {isHost && !isMe && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          rejectSeatRequest(roomId, req.id).catch(() => {});
                        }}
                        style={{ paddingHorizontal: 10, paddingVertical: 8 }}
                      >
                        <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '700' }}>{t('voiceRoom.queue.decline')}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleAdmit(req)}
                        style={{ backgroundColor: '#E3F2FD', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}
                      >
                        <Text style={{ color: '#007AFF', fontSize: 14, fontWeight: '800' }}>{t('voiceRoom.queue.admit')}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
