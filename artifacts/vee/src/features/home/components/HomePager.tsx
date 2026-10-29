/**
 * HomePager — finger-follow horizontal pager for the home shell
 * (2026-10-30, boss: "from here, still can't slide left-right — it has
 * to be SUPER smooth").
 *
 * Pure JS + Reanimated pager — NO new native module, NO new dependency
 * (react-native-pager-view is forbidden by the no-more-builds rule).
 * Built only on react-native-gesture-handler + react-native-reanimated,
 * both already in package.json.
 *
 * Page order left→right: Profile (route edge) | Chat | Voice | Contacts.
 * This component hosts the three INLINE pages [chats, voice, contacts].
 * Profile is NOT a mounted page here — its screen lives in
 * app/profile/index.tsx (owned by another builder) and embedding it
 * would double the header and break its back button. Instead, dragging
 * from Chat toward Profile pulls the page with the finger and, on
 * release past threshold, fires onProfileEdge — the shell pushes
 * /profile (the same destination as the DP tap).
 *
 * Smoothness:
 * - Finger-follows-the-drag: progress is written directly from the pan
 *   gesture on the UI thread (worklets only, never JS-thread drag
 *   handling); the row translateX derives from the same shared value.
 * - Settle is a spring (no snap); tab taps animate through the same
 *   shared value, so taps and swipes share one motion language.
 * - All pages stay mounted (pre-rendered): no loading flash on swipe.
 * - The top-bar underline is driven by the same `progress` shared value,
 *   so the indicator slides WITH the finger, not after settle.
 *
 * Gesture conflicts (all resolved on the UI thread, no JS involvement):
 * - Vertical drags fail fast (failOffsetY) → the chat FlatList and the
 *   rooms/contacts lists keep their vertical scroll.
 * - The pan activates only after 12px of horizontal movement
 *   (activeOffsetX) → inner horizontal scrollers (Story/Planet row, My
 *   Rooms row) activate first on touches that start on them and keep
 *   their scroll; taps and long-presses never activate the pan at all.
 * - Top bar and bottom bar live OUTSIDE this component and never move.
 */

import { useEffect, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';

// ─── DIRECTION MAPPING — single flip flag ───
// STANDARD (false): finger moves LEFT → travel right in the page order
// (Chat → Voice → Contacts); finger moves RIGHT → travel left
// (Chat → Profile edge). If the boss corrects the direction, flip this
// ONE line to true — nothing else changes.
const PAGER_FLIP_DIRECTION = false;

// ─── Settle tuning (single place) ───
const SETTLE_FRACTION = 0.25; // drag past 25% of a page → settle on the next page
const FLING_VELOCITY = 800; // px/s — a fast fling settles on the next page even short of 25%
const PROFILE_EDGE_THRESHOLD = -0.3; // progress past -0.3 from Chat → push /profile on release
const EDGE_RESISTANCE_DEAD_END = 0.3; // rubber-band factor past the Contacts end
const EDGE_RESISTANCE_PROFILE = 0.7; // pull factor toward the Profile edge (a real destination, so it follows the finger more)
const SPRING_CONFIG = { damping: 30, stiffness: 350, mass: 1, overshootClamping: true };

type HomePagerProps = {
  pages: ReactNode[]; // [chats, voice, contacts]
  index: number; // controlled page index (from shell state)
  progress: SharedValue<number>; // shared page position — also drives the top-bar underline
  onIndexChange: (index: number) => void;
  onProfileEdge: () => void; // fired on release past the Profile threshold (shell pushes /profile)
};

export default function HomePager({ pages, index, progress, onIndexChange, onProfileEdge }: HomePagerProps) {
  const { width: W } = useWindowDimensions();
  const last = pages.length - 1;
  // Page the pager is settled on or animating toward (worklet-side truth;
  // the parent's `index` prop is the JS-side mirror of this).
  const targetSV = useSharedValue(index);
  // Drag origin, captured at grab time so a grab mid-spring continues
  // from the visible position instead of jumping back to a stale page.
  const grabProgress = useSharedValue(0);
  const grabPage = useSharedValue(index);

  // Tab tap (or any controlled index change): animate to the new page.
  // During an active drag the pan's onUpdate overwrites progress every
  // frame, so a tap mid-drag cannot hijack the finger.
  useEffect(() => {
    targetSV.value = index;
    progress.value = withSpring(index, SPRING_CONFIG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12]) // activate only once horizontal movement dominates…
    .failOffsetY([-12, 12]) // …and fail fast on vertical drags so lists keep scrolling
    .onBegin(() => {
      'worklet';
      grabProgress.value = progress.value;
      grabPage.value = targetSV.value;
    })
    .onUpdate((e) => {
      'worklet';
      const dir = PAGER_FLIP_DIRECTION ? 1 : -1;
      let p = grabProgress.value + (dir * e.translationX) / W;
      // Edge resistance: dead end past Contacts, softer pull toward Profile.
      if (p > last) p = last + (p - last) * EDGE_RESISTANCE_DEAD_END;
      if (p < 0) p = p * EDGE_RESISTANCE_PROFILE;
      progress.value = p;
    })
    .onEnd((e) => {
      'worklet';
      const dir = PAGER_FLIP_DIRECTION ? 1 : -1;
      const movement = progress.value - grabProgress.value; // pages, + = toward Contacts
      const vPx = dir * e.velocityX; // px/s, + = toward Contacts
      const startPage = grabPage.value;
      let target = startPage;
      let profileEdge = false;
      if (startPage === 0 && movement < PROFILE_EDGE_THRESHOLD) {
        // Dragged from Chat past the Profile threshold.
        profileEdge = true;
        target = 0;
      } else if (movement > SETTLE_FRACTION || (vPx > FLING_VELOCITY && movement > 0.05)) {
        target = Math.min(startPage + 1, last);
      } else if (movement < -SETTLE_FRACTION || (vPx < -FLING_VELOCITY && movement < -0.05)) {
        target = Math.max(startPage - 1, 0);
      } else if (startPage === 0 && vPx < -FLING_VELOCITY && movement < -0.05) {
        // Fast short fling from Chat toward Profile.
        profileEdge = true;
        target = 0;
      }
      targetSV.value = target;
      progress.value = withSpring(target, SPRING_CONFIG, (finished) => {
        'worklet';
        if (finished) runOnJS(onIndexChange)(target);
      });
      if (profileEdge) runOnJS(onProfileEdge)();
    })
    .onFinalize((_e, success) => {
      'worklet';
      // Gesture lost to a list scroll (or cancelled): spring back to the
      // settled page instead of leaving the row half-dragged.
      if (!success) {
        progress.value = withSpring(targetSV.value, SPRING_CONFIG);
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * W }],
  }));

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1, flexDirection: 'row' }, rowStyle]}>
          {pages.map((page, i) => (
            <View key={i} style={{ width: W }}>
              {page}
            </View>
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
