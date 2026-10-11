import React, { useRef, useState } from 'react';
import { View, PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';

type Props = {
  children: React.ReactNode;
  /** Initial position */
  initialX?: number;
  initialY?: number;
  /** Called when drag ends with final position */
  onDragEnd?: (x: number, y: number) => void;
  /** Whether dragging is enabled */
  enabled?: boolean;
};

/**
 * Draggable wrapper (2026-10-11): makes any child draggable via PanResponder.
 * Used for location stickers and text overlays in the story editor.
 */
export default function Draggable({ children, initialX = 0, initialY = 0, onDragEnd, enabled = true }: Props) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const posRef = useRef({ x: initialX, y: initialY });
  const startRef = useRef({ x: 0, y: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enabled,
      onMoveShouldSetPanResponder: () => enabled,
      onPanResponderGrant: () => {
        startRef.current = { ...posRef.current };
      },
      onPanResponderMove: (_: GestureResponderEvent, gesture: PanResponderGestureState) => {
        const newX = startRef.current.x + gesture.dx;
        const newY = startRef.current.y + gesture.dy;
        posRef.current = { x: newX, y: newY };
        setPos({ x: newX, y: newY });
      },
      onPanResponderRelease: () => {
        onDragEnd?.(posRef.current.x, posRef.current.y);
      },
    }),
  ).current;

  return (
    <View
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
      }}
      {...(enabled ? panResponder.panHandlers : {})}
    >
      {children}
    </View>
  );
}
