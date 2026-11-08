/**
 * SvipSpriteFrame — stepped sprite-sheet frame player (F8, 2026-11-05).
 *
 * The SVIP 5 frame reward is a 63-frame 8x8 sprite sheet (NOT an animated
 * WebP: the phone decoder presents animated WebP as a still, so the
 * sprite-sheet + JS stepper is the proven pattern). One cell of the sheet
 * is shown at a time, advanced every stepMs (server-driven, 160ms).
 *
 * HEAT: a single interval, mounted ONLY while its slot is visible (the
 * SVIP 5 page, or the frame preview popup). No network, no polling —
 * only this component's own frame index re-renders. Cleared on unmount
 * (page change / popup close / screen exit).
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

export function SvipSpriteFrame({
  artUrl,
  size,
  cols,
  rows,
  frames,
  stepMs,
}: {
  artUrl: string;
  size: number;
  cols: number;
  rows: number;
  frames: number;
  stepMs: number;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (!artUrl || frames <= 1) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % frames);
    }, Math.max(50, stepMs));
    return () => clearInterval(id);
  }, [artUrl, frames, stepMs]);

  const col = frame % cols;
  const row = Math.floor(frame / cols);
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      <ExpoImage
        source={{ uri: artUrl }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: size * cols,
          height: size * rows,
          transform: [{ translateX: -col * size }, { translateY: -row * size }],
        }}
        contentFit="fill"
        cachePolicy="memory-disk"
      />
    </View>
  );
}
