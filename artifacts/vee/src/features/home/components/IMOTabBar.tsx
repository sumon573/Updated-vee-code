/**
 * IMOTabBar — IMO-style bottom tab bar (2026-10-19).
 * 5 TEXT tabs (15sp, 56dp bar): Chats · Contacts · Stories · Calls · Me.
 * Selected #009dff (medium), unselected #333333. Red #ff3b30 badge pills.
 * Per ~/workspace/imo-voiceroom/ui-preview/HOME-PROFILE-TOKENS.md
 */
import { View, Text, TouchableOpacity } from 'react-native';

export type HomeTab = 'chats' | 'contacts' | 'stories' | 'calls' | 'me';

interface IMOTabBarProps {
  activeTab: HomeTab;
  chatsBadgeCount?: number;
  callsBadgeCount?: number;
  onTabPress: (tab: HomeTab) => void;
}

const TABS: Array<{ key: HomeTab; label: string }> = [
  { key: 'chats', label: 'Chats' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'stories', label: 'Stories' },
  { key: 'calls', label: 'Calls' },
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
  callsBadgeCount = 0,
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
        const badge =
          tab.key === 'chats' ? chatsBadgeCount : tab.key === 'calls' ? callsBadgeCount : 0;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
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
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
