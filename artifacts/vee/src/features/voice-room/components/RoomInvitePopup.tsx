import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { ref, onValue, remove } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';

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
