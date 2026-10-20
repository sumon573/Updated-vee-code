/**
 * IMOTabBar — IMO-style bottom tab bar (2026-10-19).
 * TEXT tabs (15sp, 56dp bar): Chats · Contacts · Me.
 * Selected #009dff (medium), unselected #333333. Red #ff3b30 badge pills.
 * Per ~/workspace/imo-voiceroom/ui-preview/HOME-PROFILE-TOKENS.md
 * 2026-10-20 (boss's order): Stories + Calls tabs REMOVED from the bar;
 * the "Me" text is replaced by the user's own profile DP (photo), with a
 * blue ring when selected. Tab content screens themselves are untouched.
 */
import { View, Text, TouchableOpacity, Image } from 'react-native';

export type HomeTab = 'chats' | 'contacts' | 'stories' | 'calls' | 'me';

interface IMOTabBarProps {
  activeTab: HomeTab;
  chatsBadgeCount?: number;
  callsBadgeCount?: number;
  /** 2026-10-20 (boss): the user's profile photo for the Me tab. */
  myAvatar?: string | null;
  onTabPress: (tab: HomeTab) => void;
}

const TABS: Array<{ key: HomeTab; label: string }> = [
  { key: 'chats', label: 'Chats' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'me', label: 'Me' },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  const text = count > 99 ? '99+' : String(count);
  return (
    <View
      style={{
        position: 'absolute',
        top: -9,
        right: -16,
        backgroundColor: '#ff3b30',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 5,
        borderWidth: 2,
        borderColor: '#FFFFFF',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export default function IMOTabBar({
  activeTab,
  chatsBadgeCount = 0,
  myAvatar,
  onTabPress,
}: IMOTabBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        height: 56,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#F0F1F2',
      }}
    >
      {TABS.map((tab) => {
        const selected = activeTab === tab.key;
        const badge = tab.key === 'chats' ? chatsBadgeCount : 0;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            {tab.key === 'me' ? (
              /* 2026-10-20 (boss): profile DP instead of the "Me" text */
              <View
                style={{
                  width: 32, height: 32, borderRadius: 16,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? '#009dff' : '#D8DBDE',
                  alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                  backgroundColor: '#E8EAED',
                }}
              >
                {myAvatar ? (
                  <Image source={{ uri: myAvatar }} style={{ width: 32, height: 32 }} />
                ) : (
                  <Text style={{ fontSize: 15 }}>👤</Text>
                )}
              </View>
            ) : (
              <View>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: selected ? '600' : '400',
                    color: selected ? '#009dff' : '#333333',
                  }}
                >
                  {tab.label}
                </Text>
                <Badge count={badge} />
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
