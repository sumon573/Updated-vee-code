import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';

interface FramedAvatarProps {
  photoUrl?: string | null;
  frameType?: 'none' | 'official' | string;
  size?: number;
}

/**
 * Avatar with decorative frame overlay.
 * 2026-10-13 (Sumon): Lottie-based animated frames — Bigo-style, 60fps, no lag.
 * - 'official': Vee Official animated frame (Lottie)
 * - static frames: image URL overlay (future)
 */
export function FramedAvatar({ photoUrl, frameType = 'none', size = 80 }: FramedAvatarProps) {
  const hasFrame = frameType && frameType !== 'none';

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Profile photo */}
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        />
      ) : (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]} />
      )}

      {/* Animated frame overlay */}
      {hasFrame && frameType === 'official' && (
        <LottieView
          source={require('../../assets/animations/vee-official-frame.json')}
          autoPlay
          loop
          style={[styles.frame, { width: size * 1.3, height: size * 1.3 }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    backgroundColor: '#E3F2FD',
  },
  placeholder: {
    backgroundColor: '#E3F2FD',
  },
  frame: {
    position: 'absolute',
  },
});
