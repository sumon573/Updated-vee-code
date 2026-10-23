import { useEffect, useRef } from 'react';
import { View, Pressable, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import ScalePress from '@/components/ScalePress';
import { C } from '../constants/theme';
import { STICKERS, stickerUrl } from '../services/stickerCatalog';

/* ─────────────────────────── Sticker Panel ───────────────────────────
   2026-10-23 (Sumon): the 😊 button opens the DESIGNED sticker set —
   animated WebP characters (transparent background, no plate). His list:
   👍 😂 😍 😡 😯 👋 🫣 🤔. Tapping one broadcasts the sticker id; the
   sender's seat performs it and a sticker lands in chat. */
export function EmojiPanel({ visible, onSelect, onClose, bottomOffset }: {
  visible: boolean; onSelect: (stickerId: string) => void; onClose: () => void; bottomOffset: number;
}) {
  const slideAnim   = useRef(new Animated.Value(80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim,   { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 8 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim,   { toValue: 80, duration: 160, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0,  duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onPress={onClose} />
      <Animated.View style={{
        position: 'absolute', bottom: bottomOffset, left: 12, right: 12, zIndex: 100,
        transform: [{ translateY: slideAnim }], opacity: opacityAnim,
        backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: C.border,
        paddingVertical: 12, paddingHorizontal: 10,
        flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
        rowGap: 8,
        shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 20,
        shadowOffset: { width: 0, height: -4 }, elevation: 20,
      }}>
        {STICKERS.map(sticker => (
          <ScalePress
            key={sticker.id}
            style={{ width: '25%', alignItems: 'center' }}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSelect(sticker.id); }}
          >
            <View style={{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center' }}>
              <Image
                source={{ uri: stickerUrl(sticker.id)! }}
                style={{ width: 52, height: 52 }}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={sticker.id}
              />
            </View>
          </ScalePress>
        ))}
      </Animated.View>
    </>
  );
}
