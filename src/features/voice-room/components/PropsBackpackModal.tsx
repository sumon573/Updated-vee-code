/**
 * PropsBackpackModal — IMO props backpack UI, ported to Vee (2026-10-19).
 *
 * IMO behavior (voiceroom/backpack/proppackage): tabbed personal props
 * inventory (mic decor, frames, entry effects, skins, ripples); tap a prop to
 * Use it (equips immediately, visible in-room), Remove to unequip; empty tabs
 * link to the Store to buy more.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, Image, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Image as ExpoImage } from 'expo-image';
import {
  subscribeBackpack, BACKPACK_TABS,
  type BackpackTab, type BackpackItem, type BackpackState,
} from '../services/propsBackpackService';
import {
  equipStoreItem, unequipStoreItem,
} from '@/src/features/store/storeService';
import type { StoreItemType } from '@/src/features/store/storeCatalog';
import { getErrorCause } from '@/src/utils/errorDisplay';

interface Props {
  visible: boolean;
  myUid: string;
  onClose: () => void;
  onOpenStore: () => void;
}

const TAB_ICON: Record<BackpackTab, string> = {
  micSticker: '🎙️',
  avatarFrame: '🖼️',
  entryEffect: '✨',
  profileSkin: '🎨',
  soundRipple: '🌊',
};

export function PropsBackpackModal({ visible, myUid, onClose, onOpenStore }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BackpackTab>('micSticker');
  const [state, setState] = useState<BackpackState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !myUid) return;
    setState(null);
    return subscribeBackpack(myUid, setState);
  }, [visible, myUid]);

  const useItem = async (item: BackpackItem) => {
    if (busyId) return;
    setBusyId(item.itemId);
    try {
      const res = await equipStoreItem(myUid, tab as StoreItemType, {
        itemId: item.itemId,
        imageUrl: item.imageUrl,
        name: item.name,
        type: tab as StoreItemType,
        price: 0,
        purchasedAt: Date.now(),
        ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      });
      if (res.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert(t('voiceRoom.backpack.error'), res.error || getErrorCause(res));
      }
    } catch (e) {
      Alert.alert(t('voiceRoom.backpack.error'), getErrorCause(e));
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async () => {
    if (busyId) return;
    setBusyId('__remove__');
    try {
      await unequipStoreItem(myUid, tab as StoreItemType);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.backpack.error'), getErrorCause(e));
    } finally {
      setBusyId(null);
    }
  };

  const items = state?.items[tab] ?? [];
  const activeId = state?.active[tab] ?? null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          maxHeight: '78%', paddingBottom: 28,
        }}>
          {/* header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18,
            paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
          }}>
            <Text style={{ fontSize: 18, marginRight: 8 }}>🎒</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#111', flex: 1 }}>
              {t('voiceRoom.backpack.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color="#666" />
            </Pressable>
          </View>

          {/* tabs */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={{ borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
          >
            {BACKPACK_TABS.map((tb) => {
              const active = tb === tab;
              const count = state?.items[tb].length ?? 0;
              return (
                <Pressable
                  key={tb}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(tb); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: active ? '#E3F2FD' : '#F5F5F5',
                    borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{TAB_ICON[tb]}</Text>
                  <Text style={{
                    fontSize: 13, fontWeight: active ? '800' : '600',
                    color: active ? '#007AFF' : '#666',
                  }}>
                    {t(`voiceRoom.backpack.tab_${tb}`)}
                  </Text>
                  {count > 0 && (
                    <View style={{
                      backgroundColor: active ? '#007AFF' : '#CCC', borderRadius: 10,
                      minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: 5,
                    }}>
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* items grid */}
          {state === null ? (
            <View style={{ alignItems: 'center', paddingVertical: 50 }}>
              <ActivityIndicator size="large" color="#007AFF" />
            </View>
          ) : items.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 44, paddingHorizontal: 30 }}>
              <Text style={{ fontSize: 44 }}>{TAB_ICON[tab]}</Text>
              <Text style={{ color: '#999', marginTop: 12, textAlign: 'center', lineHeight: 20 }}>
                {t('voiceRoom.backpack.empty')}
              </Text>
              <Pressable
                onPress={() => { onClose(); onOpenStore(); }}
                style={{
                  marginTop: 16, backgroundColor: '#E3F2FD', borderRadius: 12,
                  paddingHorizontal: 22, paddingVertical: 11,
                }}
              >
                <Text style={{ color: '#007AFF', fontWeight: '800' }}>{t('voiceRoom.backpack.buyInStore')}</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 14 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {items.map((item) => {
                  const isActive = activeId === item.itemId;
                  const busy = busyId === item.itemId;
                  return (
                    <View
                      key={item.itemId}
                      style={{
                        width: '30%', backgroundColor: '#F8F9FA', borderRadius: 14,
                        borderWidth: isActive ? 2 : 1,
                        borderColor: isActive ? '#007AFF' : '#EEE',
                        padding: 8, alignItems: 'center',
                      }}
                    >
                      <ExpoImage
                        source={{ uri: item.imageUrl }}
                        style={{ width: 64, height: 64, borderRadius: 10 }}
                        contentFit="contain"
                      />
                      <Text numberOfLines={1} style={{ fontSize: 12, color: '#333', marginTop: 6, fontWeight: '600' }}>
                        {item.name || t('voiceRoom.backpack.unnamed')}
                      </Text>
                      {isActive ? (
                        <Pressable
                          onPress={removeItem}
                          disabled={busyId !== null}
                          style={{
                            marginTop: 8, backgroundColor: '#FFF', borderWidth: 1,
                            borderColor: '#E0E0E0', borderRadius: 10,
                            paddingHorizontal: 12, paddingVertical: 6,
                          }}
                        >
                          <Text style={{ color: '#666', fontSize: 12, fontWeight: '700' }}>
                            {busyId === '__remove__' ? '…' : t('voiceRoom.backpack.remove')}
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => useItem(item)}
                          disabled={busyId !== null}
                          style={{
                            marginTop: 8, backgroundColor: '#E3F2FD', borderRadius: 10,
                            paddingHorizontal: 12, paddingVertical: 6,
                            opacity: busyId !== null ? 0.5 : 1,
                          }}
                        >
                          <Text style={{ color: '#007AFF', fontSize: 12, fontWeight: '800' }}>
                            {busy ? '…' : t('voiceRoom.backpack.use')}
                          </Text>
                        </Pressable>
                      )}
                      {isActive && (
                        <View style={{
                          position: 'absolute', top: 6, right: 6, backgroundColor: '#007AFF',
                          borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
                        }}>
                          <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>
                            {t('voiceRoom.backpack.using')}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
              <View style={{ height: 14 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
