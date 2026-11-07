import { useEffect, useRef } from 'react';
import { View, Pressable, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import ScalePress from '@/components/ScalePress';
import { STICKERS, stickerUrl } from '../services/stickerCatalog';
// Glass P1d — Candidate A "Pod Glass" (see src/design/GLASS_RULES.md).
// Translucent fill only — no expo-blur, static, one layer per surface.
import { GlassView } from '@/src/design/GlassView';
import type { ResolvedGlass } from '@/src/design/glassTokens';

/* ─────────────────────────── Sticker Panel ───────────────────────────
   2026-10-23 (Sumon): the 😊 button opens the DESIGNED sticker set —
   animated WebP characters (transparent background, no plate). His list:
   👍 😂 😍 😡 😯 👋 🫣 🤔. Tapping one broadcasts the sticker id; the
   sender's seat performs it and a sticker lands in chat. */
export function EmojiPanel({ visible, onSelect, onClose, bottomOffset, glass }: {
  visible: boolean; onSelect: (stickerId: string) => void; onClose: () => void; bottomOffset: number;
  /** Glass P1d: resolved room-theme glass (Candidate A). Optional — without
      it the panel uses plain light glass. Stickers stay crisp inside it
      (never glass over art). */
  glass?: ResolvedGlass;
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
      {/* Glass P1d: the sticker panel is glass `panel`. The Animated.View
          keeps the slide/fade (GlassView is static and takes no animated
          values); the row-wrap grid + padding live on the inner wrapper
          (plain View, never nested glass). */}
      <Animated.View style={{
        position: 'absolute', bottom: bottomOffset, left: 12, right: 12, zIndex: 100,
        transform: [{ translateY: slideAnim }], opacity: opacityAnim,
      }}>
        <GlassView variant="panel" resolved={glass}>
        <View style={{
          paddingVertical: 12, paddingHorizontal: 10,
          flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
          rowGap: 8,
        }}>
        {STICKERS.map(sticker => (
          /* 2026-10-23 (Sumon): the grid squeezed left with a gap on the
             right — ScalePress puts `style` on its INNER view, so the
             25% width never sized the cell; the outer Pressable shrank
             to content width. The cell View now owns the 25% width
             (4 even columns, 12 stickers = 3 full rows). */
          <View key={sticker.id} style={{ width: '25%', alignItems: 'center' }}>
            <ScalePress
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSelect(sticker.id); }}
            >
              <View style={{ width: 62, height: 62, alignItems: 'center', justifyContent: 'center' }}>
                <Image
                  source={{ uri: stickerUrl(sticker.id)! }}
                  style={{ width: 56, height: 56 }}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  recyclingKey={sticker.id}
                />
              </View>
            </ScalePress>
          </View>
        ))}
        </View>
        </GlassView>
      </Animated.View>
    </>
  );
}
