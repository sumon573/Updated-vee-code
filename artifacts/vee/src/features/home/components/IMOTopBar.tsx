/**
 * IMOTopBar — IMO-style top navigation bar (2026-10-10).
 * Profile DP (left) + 3 tabs: Chat (active, blue), Voice, Contacts (gray).
 * Matches IMO home screenshot exactly.
 */
import { View, Image, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface IMOTopBarProps {
  profilePhotoURL?: string | null;
  profileInitials?: string;
  activeTab: 'chat' | 'voice' | 'contacts';
  chatBadgeCount?: number;
  onProfilePress: () => void;
  onTabPress: (tab: 'chat' | 'voice' | 'contacts') => void;
}

export default function IMOTopBar({
  profilePhotoURL,
  profileInitials = '?',
  activeTab,
  chatBadgeCount = 0,
  onProfilePress,
  onTabPress,
}: IMOTopBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
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
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 16 }}>
        {/* Chat tab */}
        <TouchableOpacity
          onPress={() => onTabPress('chat')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', paddingVertical: 4 }}
        >
          <View>
            <Ionicons
              name="chatbubbles"
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
          {activeTab === 'chat' && (
            <View
              style={{
                marginTop: 4,
                height: 3,
                width: 32,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              }}
            />
          )}
        </TouchableOpacity>

        {/* Voice tab */}
        <TouchableOpacity
          onPress={() => onTabPress('voice')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', paddingVertical: 4 }}
        >
          <Ionicons
            name="megaphone"
            size={28}
            color={activeTab === 'voice' ? '#2196F3' : '#9E9E9E'}
          />
          {activeTab === 'voice' && (
            <View
              style={{
                marginTop: 4,
                height: 3,
                width: 32,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              }}
            />
          )}
        </TouchableOpacity>

        {/* Contacts tab */}
        <TouchableOpacity
          onPress={() => onTabPress('contacts')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', paddingVertical: 4 }}
        >
          <Ionicons
            name="people"
            size={28}
            color={activeTab === 'contacts' ? '#2196F3' : '#9E9E9E'}
          />
          {activeTab === 'contacts' && (
            <View
              style={{
                marginTop: 4,
                height: 3,
                width: 32,
                backgroundColor: '#2196F3',
                borderRadius: 2,
              }}
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
