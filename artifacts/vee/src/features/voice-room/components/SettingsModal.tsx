import type { FC } from 'react';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal, TextInput, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { C, ROOM_THEMES } from '../constants/theme';
import { storeRoomPin } from '../services/firebaseRoomService';
import type { RoomAnnouncement } from '../services/roomAnnouncementService';

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
  visible, onClose, isOwnerOrAdmin, canEdit, canChangeTheme,
  topic, setTopic,
  description, setDescription,
  activeThemeId, onThemeChange,
  onOpenHistory, announcement, onOpenAnnouncement, accent,
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
  /**
   * 2026-10-22 (boss): THEME is the exception — the rules now carry a
   * scoped write for rooms/$roomId/info/themeId (owner || registry admin
   * || platform), so admins CAN change the room theme. Gate only the
   * theme section on this; everything else stays canEdit (owner).
   */
  canChangeTheme: boolean;
  topic: string; setTopic: (t: string) => void;
  /** Room description — editable alongside topic (2026-10-11). */
  description: string; setDescription: (d: string) => void;
  activeThemeId: string; onThemeChange: (id: string) => void;
  onOpenHistory: () => void; accent: string;
  /** 2026-10-23 (boss): announcement entry lives here now (moved out of
   *  the room header). Shows the current announcement as the row's
   *  subtitle; tapping opens the announcement panel (post/edit/clear). */
  announcement: RoomAnnouncement | null;
  onOpenAnnouncement: () => void;
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
  const [showThemes, setShowThemes] = useState(false);
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

          {/* Toggles — Public Room + Lock Room (Firebase-persisted on Save) */}
          {toggleRows.map(row => (
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

          {/* Room Themes */}
          <View style={{ borderTopWidth: 1, borderTopColor: C.borderFaint, paddingTop: 16, marginTop: 4 }}>
            <Pressable
              onPress={() => {
                if (!canChangeTheme) {
                  Alert.alert(t('voiceRoom.settings.permissionDenied'), t('voiceRoom.settings.permissionDeniedMsg'));
                  return;
                }
                setShowThemes((v: boolean) => !v);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                  {t('voiceRoom.settings.themeLabel')}
                </Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {canChangeTheme ? t('voiceRoom.settings.themeTapHint') : t('voiceRoom.settings.themeAdminOnly')}
                </Text>
              </View>
              <View style={{
                backgroundColor: accent + '33', borderRadius: 20,
                paddingHorizontal: 10, paddingVertical: 4,
                flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 8,
              }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} />
                <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700' }}>
                  {ROOM_THEMES.find((th: { id: string; name: string; accent: string }) => th.id === activeThemeId)?.name ?? '💙 Light'}
                </Text>
              </View>
              <Feather name={showThemes ? 'chevron-up' : 'chevron-down'} size={16}
                color={canChangeTheme ? C.sub : C.muted} />
            </Pressable>

            {showThemes && canChangeTheme && (
              <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ROOM_THEMES.map(theme => {
                  const isActive = activeThemeId === theme.id;
                  return (
                    <Pressable key={theme.id}
                      onPress={() => { onThemeChange(theme.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 7,
                        backgroundColor: isActive ? theme.accent + '33' : C.card,
                        borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
                        borderWidth: 1.5, borderColor: isActive ? theme.accent : C.borderFaint,
                      }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent }} />
                      <Text style={{ color: isActive ? theme.accent : C.sub, fontSize: 12,
                        fontWeight: isActive ? '800' : '600' }}>{theme.name}</Text>
                      {isActive && <Feather name="check" size={10} color={theme.accent} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Announcement — 2026-10-23 (boss): moved here from the room
              header. Post/edit/clear happens in the announcement panel. */}
          <Pressable
            onPress={() => { onOpenAnnouncement(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={{ flexDirection: 'row', alignItems: 'center',
              marginTop: 20, backgroundColor: 'rgba(255,193,7,0.08)',
              borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: 'rgba(255,193,7,0.35)' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12,
              backgroundColor: 'rgba(255,193,7,0.18)',
              alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Feather name="volume-2" size={18} color="#B45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
                {t('voiceRoom.announcement.title')}
              </Text>
              <Text numberOfLines={1} style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {announcement ? announcement.content : t('voiceRoom.announcement.post')}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={C.muted} />
          </Pressable>

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
