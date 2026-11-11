import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  Image,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { createOrGetChat, sendMessage } from '@/src/features/chat/services/firebaseDmService';
import { buildPkResultPayload, formatPkResultMessage, type RoomPk } from '../services/roomPkService';
import { PkResultCard } from '@/src/features/chat/components/PkResultCard';
import { useRoomToast, RoomToast } from './RoomToast';

/* ── PkShareSheet — share the PK result ──────────────────────────────
 * 2026-11-11 (boss 23:00): tapping Share in the result popup must offer
 * sending the PK result to friends in the inbox — not just the system
 * share sheet. This sheet lists friends (followings + inbox contacts,
 * one-shot get()s — the same source the Active Followings sheet uses)
 * and sends the result as a PK result CARD via the existing DM flow
 * (createOrGetChat + sendMessage — the same flow Say hi uses, with the
 * same block enforcement). "Share via…" keeps the old system share
 * (plain text — outside apps cannot render a Vee card). The card
 * carries the outcome (winner, scores, margin, top donor, room) — never
 * a bare link; the plain text stays as the message content fallback.
 * One-shot reads only; no subscription, no
 * poll, no timer (the toast is the shared useRoomToast one-shot 2200ms
 * timer). After sending, the sheet closes and the result popup stays
 * open, so the user can share to more friends. */
type ShareFriend = { uid: string; name: string; photoURL?: string | null };

export function PkShareSheet({
  visible,
  onClose,
  myUid,
  myName,
  pk,
  roomName,
  challengerPhotoURL,
  opponentPhotoURL,
}: {
  visible: boolean;
  onClose: () => void;
  myUid: string;
  myName: string;
  pk: RoomPk | null;
  roomName?: string;
  /** Resolved battler photos (seat photo, else users/{uid}/photoURL) —
      the card carries real photos, never an initial fallback. */
  challengerPhotoURL?: string | null;
  opponentPhotoURL?: string | null;
}) {
  const { toast, showToast } = useRoomToast();
  const [friends, setFriends] = useState<ShareFriend[] | null>(null);
  const [sendingUid, setSendingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !myUid || myUid === 'anonymous' || !pk) return;
    let cancelled = false;
    setFriends(null);
    (async () => {
      try {
        const [followingSnap, chatsSnap] = await Promise.all([
          get(ref(database, `following/${myUid}`)),
          get(ref(database, `userChats/${myUid}`)),
        ]);
        const uids: string[] = [];
        const seen = new Set<string>();
        const add = (uid: string) => {
          if (!uid || uid === myUid || seen.has(uid)) return;
          seen.add(uid);
          uids.push(uid);
        };
        if (followingSnap.exists()) {
          followingSnap.forEach((child) => add(child.key ?? ''));
        }
        if (chatsSnap.exists()) {
          chatsSnap.forEach((child) => {
            const v = child.val() as { participantId?: string } | null;
            if (v?.participantId) add(v.participantId);
          });
        }
        const list: ShareFriend[] = [];
        for (const uid of uids.slice(0, 30)) {
          try {
            const snap = await get(ref(database, `users/${uid}`));
            const v = snap.val() as { name?: string; photoURL?: string | null } | null;
            list.push({ uid, name: v?.name || 'User', photoURL: v?.photoURL ?? null });
          } catch {
            list.push({ uid, name: 'User', photoURL: null });
          }
          if (cancelled) return;
        }
        if (!cancelled) setFriends(list);
      } catch {
        if (!cancelled) setFriends([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, myUid, pk]);

  if (!pk) return null;
  const message = formatPkResultMessage(pk, roomName);
  const payload = buildPkResultPayload(pk, roomName, challengerPhotoURL, opponentPhotoURL);

  const sendToFriend = async (friend: ShareFriend) => {
    if (sendingUid) return;
    setSendingUid(friend.uid);
    try {
      const chatId = await createOrGetChat(myUid, myName, friend.uid, friend.name);
      await sendMessage(chatId, myUid, friend.uid, message, 'pk_result', undefined, undefined, undefined, undefined, undefined, payload ?? undefined);
      showToast(`PK result sent to ${friend.name}`);
      onClose();
    } catch {
      Alert.alert('Error', 'Could not send the PK result. Please try again.');
    } finally {
      setSendingUid(null);
    }
  };

  const shareViaSystem = async () => {
    try {
      await Share.share({ message });
    } catch {
      /* share dismissed — nothing to do */
    }
  };

  const friendAvatar = (friend: ShareFriend) =>
    friend.photoURL ? (
      <Image
        source={{ uri: friend.photoURL }}
        style={{ width: 40, height: 40, borderRadius: 20 }}
        resizeMode="cover"
      />
    ) : (
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: '#7C3AED',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>
          {(friend.name || '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          maxHeight: '80%',
        }}>
        <View
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#CBD5E1',
            alignSelf: 'center',
            marginTop: 12,
            marginBottom: 4,
          }}
        />
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: '#111827', fontSize: 18, fontWeight: '900', flex: 1 }}>Share PK result</Text>
            <Pressable onPress={onClose} style={{ padding: 6 }}>
              <Feather name="x" size={22} color="#64748B" />
            </Pressable>
          </View>
          {payload && (
            <View style={{ marginTop: 12 }}>
              <PkResultCard payload={payload} />
            </View>
          )}
          <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 4 }}>
            SEND TO FRIENDS
          </Text>
          {friends === null ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#7C3AED" />
            </View>
          ) : friends.length === 0 ? (
            <Text style={{ color: '#64748B', fontSize: 14, textAlign: 'center', paddingVertical: 16 }}>
              No friends to send to yet.
            </Text>
          ) : (
            friends.map((friend) => (
              <Pressable
                key={friend.uid}
                disabled={sendingUid !== null}
                onPress={() => sendToFriend(friend)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 11,
                  borderTopWidth: 1,
                  borderTopColor: '#F1F5F9',
                  opacity: sendingUid !== null && sendingUid !== friend.uid ? 0.5 : 1,
                }}>
                {friendAvatar(friend)}
                <Text
                  numberOfLines={1}
                  style={{ color: '#111827', fontSize: 15, fontWeight: '700', flex: 1, marginLeft: 12 }}>
                  {friend.name}
                </Text>
                {sendingUid === friend.uid ? (
                  <ActivityIndicator size="small" color="#2563EB" />
                ) : (
                  <Text style={{ color: '#2563EB', fontSize: 13, fontWeight: '800' }}>Send</Text>
                )}
              </Pressable>
            ))
          )}
          <Pressable
            onPress={shareViaSystem}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: '#F1F5F9',
            }}>
            <Feather name="share" size={18} color="#374151" />
            <Text style={{ color: '#111827', fontSize: 15, fontWeight: '700', marginLeft: 12 }}>
              Share via…
            </Text>
          </Pressable>
        </ScrollView>
        <RoomToast message={toast} />
      </View>
    </Modal>
  );
}
