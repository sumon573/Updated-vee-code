/**
 * CallOptButton — IMO CallOptView pattern for in-call controls.
 *
 * IMO's in-call controls (layout/aly.xml) are icon circles (48dp) with a
 * text label below (86x105dp cells). This recreates that pattern in RN.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { IMO_CALL } from './ImoCallTheme';

type Props = {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress?: () => void;
  /** Circle background color */
  backgroundColor?: string;
  /** Active state (e.g. muted) — tints the circle */
  active?: boolean;
  activeColor?: string;
  disabled?: boolean;
  size?: number;
};

export default function CallOptButton({
  icon,
  label,
  onPress,
  backgroundColor,
  active,
  activeColor = IMO_CALL.answerGreen,
  disabled,
  size = IMO_CALL.controlSize,
}: Props) {
  const radius = size / 2;
  const bg = disabled
    ? 'rgba(255,255,255,0.04)'
    : active
      ? activeColor
      : backgroundColor ?? IMO_CALL.controlBg;
  return (
    <View style={{ alignItems: 'center', width: 86 }}>
      <Pressable
        onPress={onPress}
        disabled={disabled || !onPress}
        hitSlop={10}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
          borderWidth: 1.5,
          borderColor: disabled
            ? 'rgba(255,255,255,0.12)'
            : active
              ? activeColor
              : IMO_CALL.controlBorder,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Feather
          name={icon}
          size={Math.round(size * 0.38)}
          color={disabled ? IMO_CALL.mutedText : IMO_CALL.text}
        />
      </Pressable>
      {/* 2026-10-20 (boss): no label text when label is empty (the call
          speaker button must show NO writing under its icon). */}
      {label ? (
        <Text
          style={{
            color: disabled ? IMO_CALL.mutedText : IMO_CALL.labelText,
            fontSize: 11,
            fontWeight: '500',
            marginTop: 6,
          }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}
