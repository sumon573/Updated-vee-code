/**
 * Private Room PIN Gate — shared component.
 *
 * Enforces the 4-digit PIN for private rooms from EVERYWHERE in the app
 * (profile, rooms list, search, home, etc.). Per Sumon 2026-10-12:
 * "কোন জায়গা থেকেই কোড ছাড়া জয়েন করা যাবে না"
 * (no joining a private room without the code, from nowhere).
 *
 * Usage:
 *   const { requestRoomAccess, pinDialog } = usePrivateRoomGate();
 *   // on room card press:
 *   requestRoomAccess(room, () => router.push({ pathname: '/voice-room', params: { roomId: room.id } }));
 *   // render {pinDialog} at the root of your screen
 */

import { useState, useCallback } from 'react';
import { View, Text, Modal, Pressable, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { verifyRoomPin } from '@/src/features/voice-room/services/firebaseRoomService';
import { useAuth } from '@/src/context/AuthContext';

type RoomLike = {
  id: string;
  name: string;
  isPublic?: boolean;
  ownerId?: string;
};

export function usePrivateRoomGate() {
  const { user } = useAuth();
  const [pinDialogRoom, setPinDialogRoom] = useState<RoomLike | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);

  const closeDialog = useCallback(() => {
    setPinDialogRoom(null);
    setPendingAction(null);
    setPinInput('');
    setPinError('');
  }, []);

  /**
   * Attempt to access a room. If it's private and the user isn't the owner,
   * shows the PIN dialog; otherwise runs `onGranted` immediately.
   */
  const requestRoomAccess = useCallback((room: RoomLike, onGranted: () => void) => {
    // Private rooms require PIN (isPublic !== true). Owner bypasses.
    if (room.isPublic !== true) {
      if (user?.uid && user.uid === room.ownerId) {
        onGranted();
        return;
      }
      setPinDialogRoom(room);
      setPendingAction(() => onGranted);
      setPinInput('');
      setPinError('');
    } else {
      onGranted();
    }
  }, [user?.uid]);

  const handlePinSubmit = useCallback(async () => {
    if (!pinDialogRoom) return;
    if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
      setPinError('Please enter a 4-digit numeric PIN.');
      return;
    }
    setPinVerifying(true);
    try {
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pinInput);
      const ok = await verifyRoomPin(pinDialogRoom.id, hashed);
      if (ok) {
        const action = pendingAction;
        closeDialog();
        action?.();
      } else {
        setPinError('Incorrect PIN. Please try again.');
      }
    } catch {
      setPinError('Verification failed. Please try again.');
    } finally {
      setPinVerifying(false);
    }
  }, [pinDialogRoom, pinInput, pendingAction, closeDialog]);

  const pinDialog = (
    <Modal
      visible={!!pinDialogRoom}
      animationType="fade"
      transparent
      onRequestClose={closeDialog}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
        onPress={closeDialog}
      >
        <Pressable style={{ width: '100%', maxWidth: 360 }} onPress={() => {}}>
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 24, padding: 28,
            borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.35)',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 10 }}>
              <Feather name="lock" size={20} color="#F59E0B" />
              <Text style={{ color: '#000000', fontSize: 18, fontWeight: '900', flex: 1 }} numberOfLines={1}>
                {pinDialogRoom?.name}
              </Text>
            </View>
            <Text style={{ color: '#8E8E93', fontSize: 14, marginBottom: 20 }}>
              Enter the 4-digit PIN to join this private room.
            </Text>
            <TextInput
              style={{
                backgroundColor: 'rgba(139,92,246,0.1)',
                borderRadius: 14, borderWidth: 1.5,
                borderColor: pinError ? '#FF4B4B' : 'rgba(139,92,246,0.35)',
                color: '#000000', fontSize: 26, fontWeight: '800',
                textAlign: 'center', letterSpacing: 14,
                paddingVertical: 14, marginBottom: 8,
              }}
              placeholder="••••"
              placeholderTextColor="#C7C7CC"
              value={pinInput}
              onChangeText={(txt) => {
                const digits = txt.replace(/[^0-9]/g, '').slice(0, 4);
                setPinInput(digits);
                if (pinError) setPinError('');
              }}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
            />
            {pinError ? (
              <Text style={{ color: '#FF4B4B', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>{pinError}</Text>
            ) : (
              <Text style={{ color: '#C7C7CC', fontSize: 12, textAlign: 'center', marginBottom: 16 }}>Numbers only</Text>
            )}
            <Pressable
              onPress={handlePinSubmit}
              disabled={pinVerifying}
              style={{
                backgroundColor: '#E3F2FD', borderRadius: 14, paddingVertical: 14,
                alignItems: 'center', opacity: pinVerifying ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#007AFF', fontSize: 16, fontWeight: '800' }}>
                {pinVerifying ? 'Verifying...' : 'Join Room'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return { requestRoomAccess, pinDialog };
}
