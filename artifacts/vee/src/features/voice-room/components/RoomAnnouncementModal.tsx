/**
 * RoomAnnouncementModal — IMO room announcement panel, ported to Vee (2026-10-19).
 *
 * IMO behavior: every member sees the pinned announcement; owner/admin can
 * edit it inline. Vee backend: roomAnnouncementService (rooms/{roomId}/announcement).
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, TextInput, ScrollView, Alert, ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  setAnnouncement, clearAnnouncement, ANNOUNCEMENT_MAX_CHARS, type RoomAnnouncement,
} from '../services/roomAnnouncementService';
import { getErrorCause } from '@/src/utils/errorDisplay';

interface Props {
  visible: boolean;
  roomId: string;
  announcement: RoomAnnouncement | null;
  isOwnerOrAdmin: boolean;
  myUid: string;
  myName: string;
  onClose: () => void;
}

export function RoomAnnouncementModal({
  visible, roomId, announcement, isOwnerOrAdmin, myUid, myName, onClose,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // 2026-10-23 (Sumon bug): the keyboard covered the writing box — this
  // bottom sheet had no keyboard handling at all, so the auto-focused
  // input slid under the keyboard. Track the real keyboard height and
  // lift the whole sheet by exactly that amount (KAV is unreliable
  // inside RN Modals on Android; measured height is deterministic).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const onHide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  const startEdit = () => {
    setDraft(announcement?.content ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      await setAnnouncement(roomId, myUid, myName || '', draft);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(false);
    } catch (e) {
      Alert.alert(t('voiceRoom.announcement.error'), getErrorCause(e));
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    Alert.alert(
      t('voiceRoom.announcement.clearTitle'),
      t('voiceRoom.announcement.clearMsg'),
      [
        { text: t('voiceRoom.announcement.cancel'), style: 'cancel' },
        {
          text: t('voiceRoom.announcement.clear'),
          style: 'destructive',
          onPress: () => {
            clearAnnouncement(roomId)
              .then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
              .catch((e: unknown) => Alert.alert(t('voiceRoom.announcement.error'), getErrorCause(e)));
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
            maxHeight: '70%', paddingBottom: 28, marginBottom: kbHeight,
          }}
        >
          {/* header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18,
            paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
          }}>
            <Feather name="volume-2" size={18} color="#007AFF" />
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#111', marginLeft: 8, flex: 1 }}>
              {t('voiceRoom.announcement.title')}
            </Text>
            {isOwnerOrAdmin && !editing && (
              <Pressable onPress={startEdit} hitSlop={10} style={{ marginRight: 12 }}>
                <Feather name="edit-2" size={16} color="#007AFF" />
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color="#666" />
            </Pressable>
          </View>

          {editing ? (
            <View style={{ padding: 18 }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={ANNOUNCEMENT_MAX_CHARS}
                placeholder={t('voiceRoom.announcement.placeholder')}
                placeholderTextColor="#999"
                style={{
                  minHeight: 76, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12,
                  padding: 12, fontSize: 15, color: '#111', textAlignVertical: 'top',
                  backgroundColor: '#F8F9FA',
                }}
                autoFocus
              />
              {/* 2026-10-23 (boss): short-notice limit, shown live. */}
              <Text style={{ color: draft.length >= ANNOUNCEMENT_MAX_CHARS ? '#EF4444' : '#999', fontSize: 11, fontWeight: '600', textAlign: 'right', marginTop: 6 }}>
                {draft.length}/{ANNOUNCEMENT_MAX_CHARS}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable
                  onPress={() => setEditing(false)}
                  style={{
                    flex: 1, backgroundColor: '#F0F0F0', borderRadius: 12,
                    paddingVertical: 12, alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#333', fontWeight: '700' }}>{t('voiceRoom.announcement.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={saving || !draft.trim()}
                  style={{
                    flex: 1, backgroundColor: '#E3F2FD', borderRadius: 12,
                    paddingVertical: 12, alignItems: 'center',
                    opacity: saving || !draft.trim() ? 0.5 : 1,
                  }}
                >
                  {saving
                    ? <ActivityIndicator size="small" color="#007AFF" />
                    : <Text style={{ color: '#007AFF', fontWeight: '800' }}>{t('voiceRoom.announcement.save')}</Text>}
                </Pressable>
              </View>
              {announcement && (
                <Pressable onPress={clear} style={{ marginTop: 12, alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={{ color: '#EF4444', fontWeight: '600' }}>{t('voiceRoom.announcement.clear')}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <ScrollView style={{ padding: 18 }} showsVerticalScrollIndicator={false}>
              {announcement ? (
                <>
                  <Text style={{ fontSize: 15, color: '#111', lineHeight: 22 }}>{announcement.content}</Text>
                  <Text style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
                    {t('voiceRoom.announcement.by', { name: announcement.createdByName || t('voiceRoom.announcement.someone') })}
                    {' · '}
                    {new Date(announcement.createdAt).toLocaleDateString()}
                  </Text>
                </>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Feather name="volume-2" size={36} color="#DDD" />
                  <Text style={{ color: '#999', marginTop: 10, textAlign: 'center' }}>
                    {t('voiceRoom.announcement.empty')}
                  </Text>
                  {isOwnerOrAdmin && (
                    <Pressable
                      onPress={startEdit}
                      style={{
                        marginTop: 14, backgroundColor: '#E3F2FD', borderRadius: 12,
                        paddingHorizontal: 20, paddingVertical: 10,
                      }}
                    >
                      <Text style={{ color: '#007AFF', fontWeight: '800' }}>{t('voiceRoom.announcement.post')}</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
