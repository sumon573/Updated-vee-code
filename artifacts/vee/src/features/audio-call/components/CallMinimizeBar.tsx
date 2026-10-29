/**
 * CallMinimizeBar — IMO-style floating "Calling" badge (2026-10-10).
 * Shows when a call is minimized: green pill with phone icon, remote name,
 * and live calling duration. Tap to return to the call screen.
 *
 * 2026-10-23 (Sumon): the pill must be DRAGGABLE — it used to sit locked
 * at the left edge (left: 0, top: 120). Now it follows the finger anywhere
 * on screen and springs to the nearest side edge on release, clamped to
 * safe on-screen bounds. Taps (no real movement) still return to the call.
 * PanResponder only — no new native modules.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, PanResponder, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  subscribeMinimizedCall,
  getMinimizedCall,
  type MinimizedCall,
} from '../services/callMinimizeStore';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const EDGE = 10;          // resting inset from the left/right screen edge
const TOP_MIN = 64;       // never under the status bar / search header
const BOTTOM_KEEP = 130;  // never over the bottom tab bar zone
// The dropped spot survives remounts for the app session.
let savedPos: { x: number; y: number } | null = null;

export default function CallMinimizeBar() {
  const router = useRouter();
  const [call, setCall] = useState<MinimizedCall | null>(() => getMinimizedCall());
  const [now, setNow] = useState(Date.now());
  const sizeRef = useRef({ w: 132, h: 56 });
  const pan = useRef(
    new Animated.ValueXY(savedPos ?? { x: EDGE, y: 120 }),
  ).current;
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const unsub = subscribeMinimizedCall(setCall);
    return unsub;
  }, []);

  useEffect(() => {
    if (!call) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call]);

  const returnToCall = () => {
    if (!call) return;
    // Return to the call — clear minimized state first
    const { setMinimizedCall } = require('../services/callMinimizeStore');
    const params = call.params;
    setMinimizedCall(null);
    router.push({
      pathname: '/audio-call',
      params: {
        roomId: params.roomId,
        role: params.role,
        ...(params.calleeUid ? { calleeUid: params.calleeUid } : {}),
        ...(params.remoteUid ? { remoteUid: params.remoteUid } : {}),
        ...(params.remoteName ? { remoteName: params.remoteName } : {}),
        // 2026-10-11 FIX: carry identity back so the returned screen
        // stays fully functional (mute-sync, call history, cleanup).
        ...(params.myUid ? { myUid: params.myUid } : {}),
        ...(params.myName ? { myName: params.myName } : {}),
        ...(params.speakerOn ? { speakerOn: params.speakerOn } : {}),
        // 2026-10-13: DP carries back too — no Firebase refetch flash.
        ...(params.remotePhotoURL ? { remotePhotoURL: params.remotePhotoURL } : {}),
        returning: 'true', // flag: rejoining minimized call, don't re-init
      },
    });
  };
  const returnRef = useRef(returnToCall);
  returnRef.current = returnToCall;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        draggingRef.current = false;
        pan.stopAnimation((v) => {
          pan.setOffset(v);
          pan.setValue({ x: 0, y: 0 });
        });
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 4 && !draggingRef.current) {
          draggingRef.current = true;
          setDragging(true);
        }
        Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        })(_e, g);
      },
      onPanResponderRelease: (_e, g) => {
        pan.flattenOffset();
        const moved = Math.abs(g.dx) + Math.abs(g.dy);
        setDragging(false);
        if (moved <= 6) {
          // A tap, not a drag — return to the call.
          returnRef.current();
          return;
        }
        const { width: W, height: H } = Dimensions.get('window');
        const { w, h } = sizeRef.current;
        pan.stopAnimation((v) => {
          const snapX = v.x + w / 2 < W / 2 ? EDGE : W - w - EDGE;
          const snapY = Math.min(Math.max(v.y, TOP_MIN), H - h - BOTTOM_KEEP);
          savedPos = { x: snapX, y: snapY };
          Animated.spring(pan, {
            toValue: { x: snapX, y: snapY },
            useNativeDriver: false,
            friction: 7,
            tension: 90,
          }).start();
        });
      },
      onPanResponderTerminate: () => {
        pan.flattenOffset();
        setDragging(false);
      },
    }),
  ).current;

  if (!call) return null;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      onLayout={(e) => {
        sizeRef.current = {
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        };
      }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: 9999,
        transform: pan.getTranslateTransform(),
        opacity: dragging ? 0.88 : 1,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#22C55E',
          borderRadius: 22,
          paddingVertical: 10,
          paddingLeft: 12,
          paddingRight: 16,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
          elevation: 8,
        }}
      >
        <Ionicons name="call" size={20} color="#fff" />
        <View style={{ marginLeft: 8 }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
            {call.remoteName}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>
            {formatDuration(now - call.startedAt)}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}
