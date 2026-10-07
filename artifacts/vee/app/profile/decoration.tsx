/**
 * Decoration Screen — IMO-style avatar frames.
 * Users earn frames via activity; admins can grant officially.
 * New users start with ZERO frames. Tap a frame to preview, tap Use to apply.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useTheme } from '@/src/context/ThemeContext';
import {
  subscribeUserFrames, subscribeFrameDefs, subscribeActiveFrame,
  setActiveFrame, AvatarFrame,
} from '@/src/services/honorService';

export default function DecorationScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { theme: C } = useTheme();
  const [frames, setFrames] = useState<AvatarFrame[]>([]);
  const [owned, setOwned] = useState<Record<string, any>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AvatarFrame | null>(null);

  useEffect(() => {
    const unsub1 = subscribeFrameDefs(setFrames);
    const unsub2 = user?.uid ? subscribeUserFrames(user.uid, setOwned) : () => {};
    const unsub3 = user?.uid ? subscribeActiveFrame(user.uid, setActiveId) : () => {};
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [user?.uid]);

  const handleUse = async (frame: AvatarFrame) => {
    if (!user?.uid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setActiveFrame(user.uid, frame.id);
    setActiveId(frame.id);
    setPreview(null);
  };

  const handleRemove = async () => {
    if (!user?.uid) return;
    await setActiveFrame(user.uid, null);
    setActiveId(null);
    setPreview(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <Pressable onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', marginLeft: 12, flex: 1 }}>
            {t('decoration.title', 'Decoration')}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {frames.map((f) => {
              const isOwned = !!owned[f.id];
              const isActive = activeId === f.id;
              return (
                <Pressable key={f.id} onPress={() => isOwned && setPreview(f)}
                  style={{
                    width: '30%', aspectRatio: 0.9,
                    backgroundColor: C.surface, borderRadius: 14,
                    alignItems: 'center', justifyContent: 'center', padding: 10,
                    borderWidth: isActive ? 2 : 1,
                    borderColor: isActive ? C.primary : C.border,
                    opacity: isOwned ? 1 : 0.45,
                  }}>
                  <View style={{
                    width: 56, height: 56, borderRadius: 28,
                    backgroundColor: C.primary + '22',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 2, borderColor: C.gold,
                  }}>
                    <Feather name="image" size={20} color={C.gold} />
                  </View>
                  <Text style={{ color: C.text, fontSize: 11, fontWeight: '700', marginTop: 6, textAlign: 'center' }} numberOfLines={2}>
                    {f.name}
                  </Text>
                  {isActive && (
                    <View style={{ backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                        {t('decoration.inUse', 'In Use')}
                      </Text>
                    </View>
                  )}
                  {!isOwned && (
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 4, textAlign: 'center' }} numberOfLines={2}>
                      {f.requirement}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* Preview modal */}
        <Modal visible={!!preview} transparent animationType="fade"
          onRequestClose={() => setPreview(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{
              backgroundColor: C.card, borderRadius: 24, padding: 24,
              alignItems: 'center', width: '80%',
            }}>
              <View style={{
                width: 100, height: 100, borderRadius: 50,
                backgroundColor: C.primary + '22',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 3, borderColor: C.gold,
              }}>
                <Feather name="user" size={36} color={C.muted} />
              </View>
              <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', marginTop: 12 }}>
                {preview?.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                {t('decoration.permanent', 'Permanent')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                <Pressable onPress={() => setPreview(null)}
                  style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: C.surface }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{t('common.cancel', 'Cancel')}</Text>
                </Pressable>
                <Pressable onPress={() => preview && handleUse(preview)}
                  style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: C.primary }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{t('decoration.use', 'Use')}</Text>
                </Pressable>
              </View>
              {activeId && (
                <Pressable onPress={handleRemove} style={{ marginTop: 12 }}>
                  <Text style={{ color: C.error, fontSize: 13 }}>{t('decoration.remove', 'Remove frame')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
