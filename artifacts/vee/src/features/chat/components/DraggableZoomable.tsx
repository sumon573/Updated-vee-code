import React, { useRef, useState } from 'react';
import { View, PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';

type Props = {
  children: (scale: number) => React.ReactNode;
  /** Initial position */
  initialX?: number;
  initialY?: number;
  /** Initial scale */
  initialScale?: number;
  /** Whether gestures are enabled */
  enabled?: boolean;
};

/**
 * Draggable + pinch-zoomable wrapper (2026-10-11).
 * Single finger: drag. Two fingers: pinch to zoom.
 * Used for text overlays in the story editor.
 */
export default function DraggableZoomable({ children, initialX = 0, initialY = 0, initialScale = 1, enabled = true }: Props) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [scale, setScale] = useState(initialScale);
  const posRef = useRef({ x: initialX, y: initialY });
  const scaleRef = useRef(initialScale);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startDistanceRef = useRef(0);
  const startScaleRef = useRef(initialScale);

  const getDistance = (touches: Array<{ pageX: number; pageY: number }>): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enabled,
      onMoveShouldSetPanResponder: () => enabled,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        startPosRef.current = { ...posRef.current };
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          startDistanceRef.current = getDistance([...touches]);
          startScaleRef.current = scaleRef.current;
        }
      },
      onPanResponderMove: (e: GestureResponderEvent, gesture: PanResponderGestureState) => {
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          // Pinch zoom
          const dist = getDistance([...touches]);
          if (startDistanceRef.current > 0 && dist > 0) {
            const newScale = Math.max(0.5, Math.min(3, startScaleRef.current * (dist / startDistanceRef.current)));
            scaleRef.current = newScale;
            setScale(newScale);
          }
        } else {
          // Drag
          const newX = startPosRef.current.x + gesture.dx;
          const newY = startPosRef.current.y + gesture.dy;
          posRef.current = { x: newX, y: newY };
          setPos({ x: newX, y: newY });
        }
      },
    }),
  ).current;

  return (
    <View
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        transform: [{ scale }],
      }}
      {...(enabled ? panResponder.panHandlers : {})}
    >
      {children(scale)}
    </View>
  );
}
