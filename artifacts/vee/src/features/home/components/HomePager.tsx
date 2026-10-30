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
 * Page order left→right: Profile | Chat | Voice | Contacts.
 * 2026-10-30 (boss: profile pre-loaded, slide just opens it): Profile
 * is a REAL pager page at progress -1 (chats=0, voice=1, contacts=2),
 * mounted beside the other pages. The slide IS the Chat → Voice
 * mechanism, mirrored — no route push, no mount, no spring-back
 * reversal at release, so the old drag-then-push jerk (J2+J3+J4) is
 * gone. The /profile ROUTE is kept for room entry + deep links.
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
// (Chat → Profile page). If the boss corrects the direction, flip this
// ONE line to true — nothing else changes.
const PAGER_FLIP_DIRECTION = false;

// ─── Settle tuning (single place) ───
const SETTLE_FRACTION = 0.25; // drag past 25% of a page → settle on the next page
const FLING_VELOCITY = 800; // px/s — a fast fling settles on the next page even short of 25%
const EDGE_RESISTANCE_DEAD_END = 0.3; // rubber-band factor past the Contacts end
// 2026-10-30 (boss: profile as pager page): -1 is a REAL page, so the
// old profile-edge machinery (threshold + resistance + route push) is
// DELETED. Progress clamps hard to [-1, 2]: rubber band only past the
// Contacts end, none past the Profile end (a real page needs no edge).
const SPRING_CONFIG = { damping: 30, stiffness: 350, mass: 1, overshootClamping: true };

type HomePagerProps = {
  pages: ReactNode[]; // [profile, chats, voice, contacts] — array index = progress + 1
  index: number; // controlled page index (from shell state): -1 = profile, 0 = chats, 1 = voice, 2 = contacts
  progress: SharedValue<number>; // shared page position — also drives the top-bar underline
  pagerSettled: SharedValue<boolean>; // true only when no pager spring is in flight (screen's focus repair reads it)
  onIndexChange: (index: number) => void;
};

export default function HomePager({ pages, index, progress, pagerSettled, onIndexChange }: HomePagerProps) {
  const { width: W } = useWindowDimensions();
  // Progress domain [-1, 2]: profile is first in the array, so the last
  // progress value is pages.length - 2, NOT pages.length - 1.
  const first = -1;
  const last = pages.length - 2;
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
  // 2026-10-30 (boss: one clean switch per tap, no jitter): the tap
  // spring is now the SOLE driver of progress during a tap. The
  // re-entrancy guard skips duplicate renders that would restart it,
  // and the completion callback snaps progress exactly to the target
  // page and raises the settled flag, so the screen's focus repair
  // (which is settled-gated) can never read mid-tap progress and yank
  // JS state back against the tap spring.
  useEffect(() => {
    if (targetSV.value === index && Math.abs(progress.value - index) < 0.01) {
      pagerSettled.value = true; // already at rest on the target page
      return;
    }
    targetSV.value = index;
    pagerSettled.value = false;
    progress.value = withSpring(index, SPRING_CONFIG, (finished) => {
      'worklet';
      if (finished) {
        progress.value = index;
        pagerSettled.value = true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12]) // activate only once horizontal movement dominates…
    // 2026-10-30 (scroll regression: chats + contacts lists stopped
    // scrolling on batch 18 while taps + slide stayed perfect): bias
    // arbitration toward vertical. The Pan config was byte-identical
    // batch-17 -> batch-18, so this is a hardening, not a revert:
    // with activeOffsetX 12 + failOffsetY 12 the Pan won every drag
    // shallower than 45deg; with failOffsetY 8 the boundary moves to
    // ~34deg, so diagonal thumb-arc drags in the 34-45deg band now fail
    // the Pan and reach the lists. Genuine swipes (realistically <25deg,
    // even sloppy ones) still activate at the same 12px with the
    // identical spring/transform/settle — slide feel unchanged.
    .failOffsetY([-8, 8]) // …and fail fast on vertical drags so lists keep scrolling
    .onBegin(() => {
      'worklet';
      grabProgress.value = progress.value;
      grabPage.value = targetSV.value;
      pagerSettled.value = false; // finger is driving now, not a spring
    })
    .onUpdate((e) => {
      'worklet';
      const dir = PAGER_FLIP_DIRECTION ? 1 : -1;
      let p = grabProgress.value + (dir * e.translationX) / W;
      // Edge behaviour: rubber band past the Contacts end only; the
      // Profile end is a real page, so progress clamps hard at -1.
      if (p > last) p = last + (p - last) * EDGE_RESISTANCE_DEAD_END;
      if (p < first) p = first;
      progress.value = p;
    })
    .onEnd((e) => {
      'worklet';
      const dir = PAGER_FLIP_DIRECTION ? 1 : -1;
      const movement = progress.value - grabProgress.value; // pages, + = toward Contacts
      const vPx = dir * e.velocityX; // px/s, + = toward Contacts
      const startPage = grabPage.value;
      let target = startPage;
      // -1 is a real page now: the settle is the SAME rule in both
      // directions (25% / fling), no profile-edge special case, no push.
      if (movement > SETTLE_FRACTION || (vPx > FLING_VELOCITY && movement > 0.05)) {
        target = Math.min(startPage + 1, last);
      } else if (movement < -SETTLE_FRACTION || (vPx < -FLING_VELOCITY && movement < -0.05)) {
        target = Math.max(startPage - 1, first);
      }
      targetSV.value = target;
      pagerSettled.value = false;
      progress.value = withSpring(target, SPRING_CONFIG, (finished) => {
        'worklet';
        if (finished) {
          progress.value = target;
          pagerSettled.value = true;
          // Stale guard: if a tap moved the target after this spring
          // finished but before the JS callback ran, the tap wins —
          // never yank JS state back to an old drag target.
          if (target === targetSV.value) runOnJS(onIndexChange)(target);
        }
      });
    })
    .onFinalize((_e, success) => {
      'worklet';
      // Gesture lost to a list scroll (or cancelled): spring back to the
      // settled page instead of leaving the row half-dragged.
      if (!success) {
        pagerSettled.value = false;
        progress.value = withSpring(targetSV.value, SPRING_CONFIG, (finished) => {
          'worklet';
          if (finished) {
            progress.value = targetSV.value;
            pagerSettled.value = true;
          }
        });
      }
    })
    // TEMPORARY D1 (2026-10-30): Pan DISABLED - proves/exonerates Pan theft. Swipes dead for this test only; remove to restore.
    .enabled(false);

  // Row offset +1: the profile page sits at array index 0, so progress
  // -1 (profile) must translate to 0, progress 0 (chats) to -W, etc.
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(progress.value + 1) * W }],
  }));

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1, flexDirection: 'row' }, rowStyle]}>
          {pages.map((page, i) => (
            /* 2026-10-30 (contacts scroll round 2): explicit page height —
               the wrapper previously relied on the row's implicit cross-axis
               stretch for its height; height: '100%' states the same value
               explicitly so the page height never depends on a default. */
            <View key={i} style={{ width: W, height: '100%' }}>
              {page}
            </View>
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
