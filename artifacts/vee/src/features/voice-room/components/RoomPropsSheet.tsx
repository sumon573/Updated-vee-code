/**
 * RoomPropsSheet — in-room props (IMO imo://room.props port, 2026-10-19).
 *
 * IMO evidence: voiceroom/backpack/propsstore/ (PropStoreHomeActivity,
 * RoomPropsFragment, PersonalPropsFragment), backpack/roomadornment/
 * (RoomMicAdornmentListFragment — mic decorations with icon_url/preview,
 * buy_duration time limits). Behavior ported; Vee's store backend.
 *
 * Shows THIS room's owned mic decors + room background (rooms/{roomId}/
 * micDecors, activeMicDecor, storeBackground). Owner can Use/Remove without
 * leaving the room; everyone gets a shortcut into the Store to buy more.
 */
import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { get, ref, set, remove } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { getErrorCause } from '@/src/utils/errorDisplay';

interface MicDecor {
  id: string;
  name: string;
  icon?: string;
  imageUrl?: string;
}

export function RoomPropsSheet({ visible, roomId, isOwner, onClose, onOpenStore }: {
  visible: boolean;
  roomId: string;
  isOwner: boolean;
  onClose: () => void;
  onOpenStore: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'mic' | 'bg'>('mic');
  const TAB_NAMES: Record<'mic' | 'bg', string> = {
    mic: t('voiceRoom.props.tab_mic'),
    bg: t('voiceRoom.props.tab_bg'),
  };
  const [micDecors, setMicDecors] = useState<MicDecor[]>([]);
  const [activeMicId, setActiveMicId] = useState<string | null>(null);
  const [bg, setBg] = useState<{ itemId: string; name: string; imageUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const [decorsSnap, activeSnap, bgSnap] = await Promise.all([
        get(ref(database, `rooms/${roomId}/micDecors`)),
        get(ref(database, `rooms/${roomId}/activeMicDecor`)),
        get(ref(database, `rooms/${roomId}/storeBackground`)),
      ]);
      const list: MicDecor[] = [];
      if (decorsSnap.exists()) {
        decorsSnap.forEach((c) => {
          const v = c.val();
          list.push({ id: c.key!, name: v.name ?? c.key!, icon: v.icon ?? v.imageUrl });
        });
      }
      setMicDecors(list);
      setActiveMicId(activeSnap.exists() ? (activeSnap.val().itemId ?? null) : null);
      setBg(bgSnap.exists() ? bgSnap.val() : null);
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    if (visible && roomId) reload();
  }, [visible, roomId]);

  const useMicDecor = async (d: MicDecor) => {
    if (!isOwner || busy) return;
    setBusy(true);
    try {
      await set(ref(database, `rooms/${roomId}/activeMicDecor`), {
        itemId: d.id, name: d.name, imageUrl: d.icon ?? '',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reload();
    } catch (e) {
      Alert.alert(t('voiceRoom.props.error'), getErrorCause(e));
    } finally {
      setBusy(false);
    }
  };

  const removeMicDecor = async () => {
    if (!isOwner || busy) return;
    setBusy(true);
    try {
      await remove(ref(database, `rooms/${roomId}/activeMicDecor`));
      reload();
    } catch (e) {
      Alert.alert(t('voiceRoom.props.error'), getErrorCause(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 28,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
          <Feather name="package" size={18} color="#05b5fa" />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.props.title')}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color="#8E8E93" />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: '#F2F2F7', borderRadius: 999, padding: 3 }}>
          {(['mic', 'bg'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(k); }}
              style={{ flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: tab === k ? '#FFFFFF' : 'transparent' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '800', color: tab === k ? '#007AFF' : '#8E8E93' }}>
                {TAB_NAMES[k]}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {tab === 'mic' ? (
            micDecors.length === 0 ? (
              <EmptyState icon="mic" text={t('voiceRoom.props.noMic')} onBuy={onOpenStore} buyText={t('voiceRoom.props.buyInStore')} />
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {micDecors.map((d) => {
                  const active = d.id === activeMicId;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => useMicDecor(d)}
                      disabled={!isOwner}
                      style={{
                        width: '30%', aspectRatio: 0.85, borderRadius: 12, backgroundColor: '#F2F2F7',
                        alignItems: 'center', justifyContent: 'center', padding: 8,
                        borderWidth: active ? 2 : 0, borderColor: active ? '#007AFF' : 'transparent',
                        opacity: !isOwner && !active ? 0.7 : 1,
                      }}
                    >
                      {d.icon ? (
                        <Image source={{ uri: d.icon }} style={{ width: 48, height: 48, borderRadius: 24 }} />
                      ) : (
                        <Feather name="mic" size={28} color="#05b5fa" />
                      )}
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#000', marginTop: 6, textAlign: 'center' }} numberOfLines={2}>
                        {d.name}
                      </Text>
                      {active && (
                        <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: '#007AFF', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '800' }}>{t('voiceRoom.props.using')}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : bg ? (
            <View>
              <Image source={{ uri: bg.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 12, backgroundColor: '#F2F2F7' }} resizeMode="cover" />
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#000', marginTop: 10 }}>{bg.name}</Text>
              {isOwner && (
                <Pressable
                  onPress={async () => {
                    setBusy(true);
                    try { await remove(ref(database, `rooms/${roomId}/storeBackground`)); reload(); }
                    catch (e) { Alert.alert(t('voiceRoom.props.error'), getErrorCause(e)); }
                    finally { setBusy(false); }
                  }}
                  style={{ marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFE5E5' }}
                >
                  <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '800' }}>{t('voiceRoom.props.remove')}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <EmptyState icon="image" text={t('voiceRoom.props.noBg')} onBuy={onOpenStore} buyText={t('voiceRoom.props.buyInStore')} />
          )}
        </ScrollView>

        {isOwner && activeMicId && tab === 'mic' && (
          <Pressable
            onPress={removeMicDecor}
            disabled={busy}
            style={{ marginHorizontal: 16, marginTop: 4, paddingVertical: 10, borderRadius: 999, backgroundColor: '#FFE5E5', alignItems: 'center' }}
          >
            {busy ? <ActivityIndicator size="small" color="#FF3B30" /> : (
              <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '800' }}>{t('voiceRoom.props.removeMic')}</Text>
            )}
          </Pressable>
        )}

        {!isOwner && (
          <Text style={{ textAlign: 'center', color: '#8E8E93', fontSize: 12, marginTop: 8, paddingHorizontal: 16 }}>
            {t('voiceRoom.props.ownerOnly')}
          </Text>
        )}
      </View>
    </Modal>
  );
}

function EmptyState({ icon, text, onBuy, buyText }: { icon: string; text: string; onBuy: () => void; buyText: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28 }}>
      {/* @ts-ignore feather name union */}
      <Feather name={icon} size={40} color="#C7C7CC" />
      <Text style={{ color: '#8E8E93', fontSize: 14, marginTop: 12, textAlign: 'center' }}>{text}</Text>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onBuy(); }}
        style={{ marginTop: 14, backgroundColor: '#E3F2FD', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 }}
      >
        <Text style={{ color: '#007AFF', fontSize: 14, fontWeight: '800' }}>{buyText}</Text>
      </Pressable>
    </View>
  );
}
