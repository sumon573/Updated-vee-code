/**
 * IMOTopBar — IMO-style top navigation bar (2026-10-10).
 * Profile DP (left) + 3 tabs: Chat (active, blue), Voice, Contacts (gray).
 * Matches IMO home screenshot exactly.
 * 2026-10-29 (boss: Fix #25): chat tab icon is the custom ChatTabIcon
 * vector (reference double-bubble + two message lines, not the stock
 * Ionicons glyph); all three tab icons sized to the contacts icon's
 * visual size (voice PNG enlarged 28 -> 33 — its ink is only 66/112 of
 * its frame, so at 28 it rendered 16.5dp tall vs the contacts glyph's
 * 19.3dp; at 33 its ink is 19.4dp tall, matching).
 */
import { View, Image, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatTabIcon } from '@/src/components/ChatTabIcon';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';

interface IMOTopBarProps {
  profilePhotoURL?: string | null;
  profileInitials?: string;
  // 2026-10-26: 'none' = stories/calls tabs, which have no top-bar tab —
  // renders the bar with no active underline (never a wrong highlight).
  // 2026-10-30 (boss: profile as pager page): 'profile' = the pager
  // profile page — no tab is tinted for it (the DP is not a tinted
  // tab), and the dash sits at the DP position (see underlineStyle:
  // progress -1 already interpolates to DP_CENTER_REL, and the opacity
  // rule already shows for any non-'none' tab — no math change needed).
  activeTab: 'chat' | 'voice' | 'contacts' | 'none' | 'profile';
  chatBadgeCount?: number;
  // 2026-10-30 (boss: page-swipe; profile page 2026-10-30): shared
  // pager position (-1 = profile, 0 = chat, 1 = voice, 2 = contacts).
  // When set, the underline below slides WITH the drag instead of
  // jumping at settle. Absent -> old discrete underlines, untouched.
  pagerProgress?: SharedValue<number>;
  onProfilePress: () => void;
  onTabPress: (tab: 'chat' | 'voice' | 'contacts') => void;
}

export default function IMOTopBar({
  profilePhotoURL,
  profileInitials = '?',
  activeTab,
  chatBadgeCount = 0,
  pagerProgress,
  onProfilePress,
  onTabPress,
}: IMOTopBarProps) {
  // 2026-10-30 (boss: page-swipe): tab centers measured exactly via
  // onLayout (space-around + uneven icon widths make estimates visibly
  // off-center). DP center relative to the tabs row is a constant:
  // bar padding 16 + DP 40 + row marginLeft 16 -> row starts at x=72;
  // DP center at 16+20=36 -> -36 relative to the row.
  const DP_CENTER_REL = -36;
  const tabCenters = useSharedValue<[number, number, number]>([0, 0, 0]);
  const rowWidth = useSharedValue(0);
  const setTabCenter = (i: number, x: number, w: number) => {
    const cur = [...tabCenters.value];
    cur[i] = x + w / 2;
    tabCenters.value = cur as [number, number, number];
  };
  const underlineStyle = useAnimatedStyle(() => {
    if (!pagerProgress) return { opacity: 0 };
    const p = pagerProgress.value;
    const w = rowWidth.value;
    const [c0, c1, c2] = tabCenters.value;
    // 2026-10-30 (boss: underline must sit exactly under the active tab):
    // never show the indicator from estimated centers — an estimate is
    // visibly off-center, and a wrong base/estimate put it a full tab off
    // on his phone. Centers measure on mount (one frame); until then hide.
    const isMeasured = w > 0 && c0 > 0 && c1 > 0 && c2 > 0;
    const e0 = c0 || w / 6;
    const e1 = c1 || w / 2;
    const e2 = c2 || (5 * w) / 6;
    const center = interpolate(
      p,
      [-1, 0, 1, 2],
      [DP_CENTER_REL, e0, e1, e2],
      { extrapolateLeft: Extrapolation.CLAMP, extrapolateRight: Extrapolation.CLAMP },
    );
    return {
      transform: [{ translateX: center - 16 }],
      opacity: activeTab === 'none' || !isMeasured ? 0 : 1,
    };
    // Deps refresh the closure when the settled tab changes, so the
    // opacity (and the none-hide) can never go stale on the UI thread.
  }, [activeTab]);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        // 2026-10-30 (boss: top lines light grey, faint): was '#E0E0E0'.
        borderBottomColor: '#EAEAEA',
      }}
    >
      {/* Profile DP */}
      <TouchableOpacity onPress={onProfilePress} activeOpacity={0.7}>
        {profilePhotoURL ? (
          <Image
            source={{ uri: profilePhotoURL }}
            style={{ width: 40, height: 40, borderRadius: 20 }}
          />
        ) : (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: '#E0E0E0',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#757575' }}>
              {profileInitials}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Tabs */}
      <View
        style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 16 }}
        onLayout={(e) => { rowWidth.value = e.nativeEvent.layout.width; }}
      >
        {/* Chat tab */}
        <TouchableOpacity
          onPress={() => onTabPress('chat')}
          activeOpacity={0.7}
          // NOTE (2026-10-11): enlarged touch target x2 — Sumon reported taps still missing.
          hitSlop={{ top: 22, bottom: 22, left: 32, right: 32 }}
          style={{ alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 }}
          onLayout={(e) => setTabCenter(0, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
        >
          <View>
            <ChatTabIcon
              size={28}
              color={activeTab === 'chat' ? '#2196F3' : '#9E9E9E'}
            />
            {chatBadgeCount > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -10,
                  backgroundColor: '#4CAF50',
                  borderRadius: 10,
                  minWidth: 20,
                  height: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                  {chatBadgeCount > 99 ? '99+' : chatBadgeCount}
                </Text>
              </View>
            )}
          </View>
          {pagerProgress ? (
            // Spacer keeps the button exactly as tall as before; the
            // animated underline below carries the active mark.
            <View style={{ marginTop: 4, height: 3, width: 32 }} />
          ) : activeTab === 'chat' ? (
            <View
              style={{
                marginTop: 4,
                height: 3,
                width: 32,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              }}
            />
          ) : null}
        </TouchableOpacity>

        {/* Voice tab */}
        <TouchableOpacity
          onPress={() => onTabPress('voice')}
          activeOpacity={0.7}
          // NOTE (2026-10-11): enlarged touch target x2 — Sumon reported taps still missing.
          hitSlop={{ top: 22, bottom: 22, left: 32, right: 32 }}
          style={{ alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 }}
          onLayout={(e) => setTabCenter(1, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
        >
          {/* 2026-10-13 (Sumon): custom voice icon — তাঁর দেওয়া design হুবহু */}
          <Image
            source={require('@/assets/images/voice-tab-icon.png')}
            style={{
              // Fix #25: 33 (not 28) — see header note; matches contacts ink size.
              width: 33,
              height: 33,
              tintColor: activeTab === 'voice' ? '#2196F3' : '#9E9E9E',
            }}
            resizeMode="contain"
          />
          {pagerProgress ? (
            <View style={{ marginTop: 4, height: 3, width: 32 }} />
          ) : activeTab === 'voice' ? (
            <View
              style={{
                marginTop: 4,
                height: 3,
                width: 32,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              }}
            />
          ) : null}
        </TouchableOpacity>

        {/* Contacts tab */}
        <TouchableOpacity
          onPress={() => onTabPress('contacts')}
          activeOpacity={0.7}
          // NOTE (2026-10-11): enlarged touch target x2 — Sumon reported taps still missing.
          hitSlop={{ top: 22, bottom: 22, left: 32, right: 32 }}
          style={{ alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 }}
          onLayout={(e) => setTabCenter(2, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
        >
          <Ionicons
            name="people"
            size={28}
            color={activeTab === 'contacts' ? '#2196F3' : '#9E9E9E'}
          />
          {pagerProgress ? (
            <View style={{ marginTop: 4, height: 3, width: 32 }} />
          ) : activeTab === 'contacts' ? (
            <View
              style={{
                marginTop: 4,
                height: 3,
                width: 32,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              }}
            />
          ) : null}
        </TouchableOpacity>
        {/* 2026-10-30 (boss: page-swipe): the single sliding indicator.
            bottom: 10 matches the discrete underline's old spot (button
            bottom padding); translateX comes from the pager progress. */}
        {pagerProgress && (
          <Animated.View
            style={[
              {
                position: 'absolute',
                // 2026-10-30 (boss: exact underline): explicit physical
                // left anchor — without it the base position is Yoga's
                // static-flow guess, which shifted the dash a full tab
                // off on his phone. translateX is measured from here.
                left: 0,
                bottom: 10,
                width: 32,
                height: 3,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              },
              underlineStyle,
            ]}
          />
        )}
      </View>
    </View>
  );
}
