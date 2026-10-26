import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { router, useSegments, useGlobalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { ref, onValue, remove, get } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { removeSeat, leaveAudience } from '../services/firebaseRoomService';
import { destroyPersistedVoiceRoomEngineAsync } from '../useLivekitVoiceRoom';

type RoomInvite = {
  roomId: string;
  roomName: string;
  inviterUid: string;
  inviterName: string;
  ts: number;
};

/**
 * 2026-10-14 (Sumon): Global room invite popup.
 * When someone invites you to a voice room and you're in the app,
 * show Accept/Reject popup. Accept → join room directly.
 */
export default function RoomInvitePopup() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const segments = useSegments();
  const globalParams = useGlobalSearchParams();

  useEffect(() => {
    if (!user?.uid) return;
    const invitesRef = ref(database, `roomInvites/${user.uid}`);
    const unsub = onValue(invitesRef, (snap) => {
      const val = snap.val();
      if (!val) {
        setInvites([]);
        return;
      }
      const list: RoomInvite[] = Object.values(val);
      // Sort by timestamp, newest first
      list.sort((a, b) => b.ts - a.ts);
      setInvites(list);
    });
    return () => unsub();
  }, [user?.uid]);

  const handleAccept = async (invite: RoomInvite) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await remove(ref(database, `roomInvites/${user!.uid}/${invite.roomId}`));
    } catch { /* non-critical */ }
    setInvites((prev) => prev.filter((i) => i.roomId !== invite.roomId));
    const inVoiceRoom = (segments as string[]).includes('voice-room');
    const currentRoomId = globalParams?.roomId;
    // Already in the invited room — nothing to do.
    if (inVoiceRoom && currentRoomId === invite.roomId) return;
    if (inVoiceRoom && typeof currentRoomId === 'string' && currentRoomId) {
      // 2026-10-26 (boss: invite-accept while seated in another room):
      // NEVER stack a second room over an open one. The old code pushed
      // blindly, so the old screen stayed mounted with its LiveKit engine
      // still publishing — two engines on one mic (the mic drop), double
      // subscriptions/load, and the old room's seat never left, so exiting
      // the new room revealed the old room with the ID still on it. Leave
      // the current room FULLY first: own seat by live lookup (the
      // active-room tracker can go stale on seat-invite moves — never
      // trust it alone here) + audience + persisted engine, then dismiss
      // the old screen so its engine tears down on unmount, then open the
      // new room after the same 80ms settle the notification-tap path in
      // _layout uses. The new room's own one-active-room guard cleans any
      // remainder as backstop.
      try {
        const seatsSnap = await get(ref(database, `rooms/${currentRoomId}/seats`)).catch(() => null);
        let mySeatIdx = -1;
        seatsSnap?.forEach((child) => {
          const s = child.val() as { userId?: string } | null;
          if (s?.userId === user!.uid) mySeatIdx = Number(child.key);
        });
        if (mySeatIdx >= 0) {
          await removeSeat(currentRoomId, mySeatIdx).catch(() => {});
        }
        await leaveAudience(currentRoomId, user!.uid).catch(() => {});
      } catch { /* backstop: dismiss + new-room guard still clean up */ }
      try { await destroyPersistedVoiceRoomEngineAsync(); } catch { /* noop */ }
      if (router.canDismiss()) router.dismiss();
      setTimeout(() => {
        router.push({ pathname: '/voice-room', params: { roomId: invite.roomId } } as any);
      }, 80);
      return;
    }
    router.push({ pathname: '/voice-room', params: { roomId: invite.roomId } } as any);
  };

  const handleReject = async (invite: RoomInvite) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await remove(ref(database, `roomInvites/${user!.uid}/${invite.roomId}`));
    } catch { /* non-critical */ }
    setInvites((prev) => prev.filter((i) => i.roomId !== invite.roomId));
  };

  if (invites.length === 0) return null;
  const invite = invites[0]; // Show one at a time

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => handleReject(invite)}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
        <View style={{
          backgroundColor: '#1A1030', borderRadius: 20,
          borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.4)',
          padding: 24, width: '100%', maxWidth: 340,
          alignItems: 'center',
        }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: 'rgba(139,92,246,0.2)',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <Feather name="mic" size={28} color="#8B5CF6" />
          </View>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>
            {t('voiceRoom.invitePopup.title', { name: invite.inviterName })}
          </Text>
          <Text style={{ color: '#B8A6D9', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            {t('voiceRoom.invitePopup.message', { room: invite.roomName })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
            <Pressable
              onPress={() => handleReject(invite)}
              style={{
                flex: 1, backgroundColor: 'rgba(239,68,68,0.15)',
                borderRadius: 14, paddingVertical: 14,
                borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '800' }}>
                {t('voiceRoom.invitePopup.reject')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleAccept(invite)}
              style={{
                flex: 1, backgroundColor: '#7C3AED',
                borderRadius: 14, paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
                {t('voiceRoom.invitePopup.accept')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
