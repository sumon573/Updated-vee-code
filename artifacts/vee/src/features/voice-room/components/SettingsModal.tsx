import type { FC } from 'react';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal, TextInput, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { storeRoomPin } from '../services/firebaseRoomService';

/* ─────────────────────────── Settings Modal ─────────────────────────── */

/**
 * SettingsModal — room settings for owner/admin.
 *
 * Fix: "Public Room" and "Lock Room" toggles are now wired to Firebase via
 * the `roomIsPublic`, `roomIsLocked` props (initial values from room info)
 * and the `onSaveSettings` callback (called on Save with the new values).
 * "Mute New Joiners" toggle has been removed as per product decision.
 */
export function SettingsModal({
  visible, onClose, isOwnerOrAdmin, canEdit,
  topic, setTopic,
  description, setDescription,
  onOpenHistory, accent,
  roomIsPublic, roomIsLocked,
  onSaveSettings, roomId,
}: {
  visible: boolean; onClose: () => void; isOwnerOrAdmin: boolean;
  /**
   * 2026-10-12: room settings (topic/description/privacy/PIN) are
   * OWNER-only — the security rules deny admin writes to rooms/$roomId/info
   * and roomPins, so the UI must not offer editing to admins. Admins keep
   * full moderation powers; they can still VIEW settings + operation history.
   */
  canEdit: boolean;
  topic: string; setTopic: (t: string) => void;
  /** Room description — editable alongside topic (2026-10-11). */
  description: string; setDescription: (d: string) => void;
  onOpenHistory: () => void; accent: string;
  /** Current persisted value of isPublic from Firebase room info. */
  roomIsPublic: boolean;
  /** Current persisted value of isLocked from Firebase room info. */
  roomIsLocked: boolean;
  /** Called on Save with the new (isPublic, isLocked) pair to persist to Firebase. */
  onSaveSettings: (isPublic: boolean, isLocked: boolean) => void;
  /** Room id — needed to store a new PIN for private rooms. */
  roomId: string;
}) {
  const { t } = useTranslation();
  const [localTopic, setLocalTopic] = useState(topic);
  const [localDescription, setLocalDescription] = useState(description);
  const [isPublic,   setIsPublic]   = useState(roomIsPublic);
  const [lockRoom,   setLockRoom]   = useState(roomIsLocked);
  /** New 4-digit PIN input (private rooms only). Empty = don't change. */
  const [newPin, setNewPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);

  // Sync local state from props whenever the modal opens (or props change while open)
  useEffect(() => {
    if (visible) {
      setLocalTopic(topic);
      setLocalDescription(description);
      setIsPublic(roomIsPublic);
      setLockRoom(roomIsLocked);
      setNewPin('');
    }
  }, [visible, topic, description, roomIsPublic, roomIsLocked]);

  const handleSave = () => {
    const trimmedTopic = localTopic.trim() || topic;
    const trimmedDesc = localDescription.trim();
    setTopic(trimmedTopic);
    setDescription(trimmedDesc);
    onSaveSettings(isPublic, lockRoom);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  /** Change the 4-digit PIN for a private room (owner/admin only). */
  const handleChangePin = async () => {
    const pin = newPin.trim();
    if (!/^\d{4}$/.test(pin)) {
      Alert.alert(
        t('voiceRoom.settings.pinInvalidTitle'),
        t('voiceRoom.settings.pinInvalidMsg'),
      );
      return;
    }
    setPinSaving(true);
    try {
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
      await storeRoomPin(roomId, hashed);
      setNewPin('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        t('voiceRoom.settings.pinChangedTitle'),
        t('voiceRoom.settings.pinChangedMsg'),
      );
    } catch {
      Alert.alert(t('voiceRoom.screen.error'), t('voiceRoom.screen.settingsSaveError'));
    } finally {
      setPinSaving(false);
    }
  };

  const toggleRows = [
    {
      label: t('voiceRoom.settings.publicRoom'),
      sub:   t('voiceRoom.settings.publicRoomSub'),
      val:   isPublic,
      set:   setIsPublic,
    },
    {
      label: t('voiceRoom.settings.lockRoom'),
      sub:   t('voiceRoom.settings.lockRoomSub'),
      val:   lockRoom,
      set:   setLockRoom,
    },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: accent + '44', maxHeight: '92%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', marginBottom: 20 }}>
            {t('voiceRoom.settings.title')}
          </Text>

          {/* Topic */}
          <Text style={{ color: C.sub, fontSize: 13, marginBottom: 8, fontWeight: '700' }}>
            {t('voiceRoom.settings.topicLabel')}
          </Text>
          <TextInput
            value={localTopic}
            onChangeText={setLocalTopic}
            placeholderTextColor={C.muted}
            editable={canEdit}
            style={{ backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 16,
              paddingVertical: 12, color: C.text, fontSize: 14, borderWidth: 1,
              borderColor: canEdit ? accent + '55' : C.borderFaint, marginBottom: 16 }}
          />

          {/* Description (2026-10-11) */}
          <Text style={{ color: C.sub, fontSize: 13, marginBottom: 8, fontWeight: '700' }}>
            {t('voiceRoom.settings.descriptionLabel')}
          </Text>
          <TextInput
            value={localDescription}
            onChangeText={setLocalDescription}
            placeholder={t('voiceRoom.settings.descriptionPlaceholder')}
            placeholderTextColor={C.muted}
            editable={canEdit}
            multiline
            numberOfLines={3}
            style={{ backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 16,
              paddingVertical: 12, color: C.text, fontSize: 14, borderWidth: 1,
              borderColor: canEdit ? accent + '55' : C.borderFaint, marginBottom: 16,
              minHeight: 80, textAlignVertical: 'top' }}
          />

          {/* Toggles — Public Room + Lock Room (Firebase-persisted on Save).
              2026-10-27 (boss): rooms that are ALREADY public don't need these
              rows — hide both entirely when the room's persisted privacy is
              public (roomIsPublic prop from Firebase room info). Visibility keys
              on the persisted prop, not the draft toggle state, so the rows
              stay put while the sheet is open. Non-public rooms keep both. */}
          {roomIsPublic !== true && toggleRows.map(row => (
            <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center',
              paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{row.label}</Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{row.sub}</Text>
              </View>
              <Switch
                value={row.val}
                onValueChange={canEdit ? row.set : undefined}
                trackColor={{ false: C.muted, true: accent }}
                thumbColor={C.text}
                disabled={!canEdit}
              />
            </View>
          ))}

          {/* Room PIN — private rooms only, owner/admin can change the 4-digit password */}
          {!isPublic && canEdit && (
            <View style={{ borderTopWidth: 1, borderTopColor: C.borderFaint, paddingTop: 16, marginTop: 4 }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                {t('voiceRoom.settings.pinLabel')}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2, marginBottom: 10 }}>
                {t('voiceRoom.settings.pinSub')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  value={newPin}
                  onChangeText={(v) => setNewPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="••••"
                  placeholderTextColor={C.muted}
                  keyboardType="number-pad"
                  maxLength={4}
                  secureTextEntry
                  style={{
                    flex: 1, backgroundColor: C.card, borderRadius: 14,
                    paddingHorizontal: 16, paddingVertical: 12,
                    color: C.text, fontSize: 16, fontWeight: '800',
                    borderWidth: 1, borderColor: accent + '55',
                    letterSpacing: 8, textAlign: 'center',
                  }}
                />
                <Pressable
                  onPress={handleChangePin}
                  disabled={pinSaving || newPin.length !== 4}
                  style={{
                    backgroundColor: pinSaving || newPin.length !== 4 ? C.muted : accent,
                    borderRadius: 14, paddingHorizontal: 20,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                  <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>
                    {pinSaving ? '…' : t('voiceRoom.settings.pinChange')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Operation History */}
          {isOwnerOrAdmin && (
            <Pressable
              onPress={onOpenHistory}
              style={{ flexDirection: 'row', alignItems: 'center',
                marginTop: 20, backgroundColor: 'rgba(239,68,68,0.08)',
                borderRadius: 16, padding: 16,
                borderWidth: 1, borderColor: 'rgba(239,68,68,0.22)' }}>
              <View style={{ width: 40, height: 40, borderRadius: 12,
                backgroundColor: 'rgba(239,68,68,0.15)',
                alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Feather name="clock" size={18} color={C.red} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                  {t('voiceRoom.settings.operationHistory')}
                </Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {t('voiceRoom.settings.operationHistorySub')}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={C.muted} />
            </Pressable>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <Pressable onPress={onClose}
              style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, paddingVertical: 14,
                alignItems: 'center', borderWidth: 1, borderColor: C.borderFaint }}>
              <Text style={{ color: C.sub, fontWeight: '700' }}>
                {t('voiceRoom.settings.cancel')}
              </Text>
            </Pressable>
            {/* 2026-10-12: Save is owner-only (admins get a read-only view). */}
            {canEdit && (
              <Pressable onPress={handleSave}
                style={{ flex: 2, backgroundColor: accent, borderRadius: 14,
                  paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>
                  {t('voiceRoom.settings.save')}
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
