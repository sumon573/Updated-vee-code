/**
 * StoriesTabScreen — IMO-style stories tab (2026-10-19).
 * Vertical list of story groups: 56dp avatar with blue ring (unseen) /
 * gray ring (seen), 16sp name, relative time. "My Story" row on top with
 * add affordance. Tapping a group opens the shared StoryViewer via the
 * shell's onStoryPress(userId).
 */
import { View, Text, FlatList, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { UserStories } from '@/src/features/chat/types';

interface StoriesTabScreenProps {
  stories: UserStories[];
  myUserId?: string;
  myAvatar?: string | null;
  onStoryPress: (userId: string) => void;
  onAddStory: () => void;
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return '';
  const diffMin = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function StoryAvatar({
  photoURL,
  name,
  unseen,
  size = 56,
}: {
  photoURL?: string | null;
  name: string;
  unseen: boolean;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        padding: 2.5,
        borderWidth: 2.5,
        borderColor: unseen ? '#009dff' : '#E3E6E8',
        backgroundColor: '#FFFFFF',
      }}
    >
      {photoURL ? (
        <Image
          source={{ uri: photoURL }}
          style={{ width: '100%', height: '100%', borderRadius: size / 2 }}
        />
      ) : (
        <View
          style={{
            width: '100%',
            height: '100%',
            borderRadius: size / 2,
            backgroundColor: '#DFE5EA',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: '600', color: '#788187' }}>
            {(name || '?').charAt(0)}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function StoriesTabScreen({
  stories,
  myUserId,
  myAvatar,
  onStoryPress,
  onAddStory,
}: StoriesTabScreenProps) {
  const myGroup = stories.find((s) => s.userId === myUserId);
  const others = stories.filter((s) => s.userId !== myUserId);

  const renderGroup = ({ item }: { item: UserStories }) => {
    const latest = item.stories[item.stories.length - 1];
    const unseen = !item.allSeen;
    return (
      <TouchableOpacity
        onPress={() => onStoryPress(item.userId)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 76,
          paddingLeft: 15,
          paddingRight: 15,
          backgroundColor: '#FFFFFF',
        }}
      >
        <StoryAvatar photoURL={item.userAvatar} name={item.userName} unseen={unseen} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ fontSize: 16, fontWeight: '500', color: '#000000' }}
          >
            {item.userName || 'Vee User'}
          </Text>
          <Text style={{ fontSize: 13, color: '#7a7a7a', marginTop: 2 }}>
            {latest ? timeAgo(latest.createdAt) : ''}
            {item.stories.length > 1 ? ` · ${item.stories.length} stories` : ''}
          </Text>
        </View>
        {unseen && (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: '#009dff',
            }}
          />
        )}
        <View
          style={{
            position: 'absolute',
            left: 79,
            right: 0,
            bottom: 0,
            height: 1,
            backgroundColor: '#F0F1F2',
          }}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* Title bar */}
      <View
        style={{
          height: 48,
          justifyContent: 'center',
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#F0F1F2',
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: '600', color: '#25292D' }}>Stories</Text>
      </View>
      <FlatList
        data={others}
        keyExtractor={(item) => item.userId}
        renderItem={renderGroup}
        ListHeaderComponent={
          <TouchableOpacity
            onPress={onAddStory}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              height: 76,
              paddingLeft: 15,
              paddingRight: 15,
              backgroundColor: '#FFFFFF',
              borderBottomWidth: 1,
              borderBottomColor: '#F0F1F2',
            }}
          >
            <View>
              <StoryAvatar
                photoURL={myAvatar || myGroup?.userAvatar}
                name="You"
                unseen={false}
              />
              <View
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: '#009dff',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2.5,
                  borderColor: '#FFFFFF',
                }}
              >
                <Ionicons name="add" size={14} color="#FFFFFF" />
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '500', color: '#000000' }}>My Story</Text>
              <Text style={{ fontSize: 13, color: '#7a7a7a', marginTop: 2 }}>
                {myGroup && myGroup.stories.length > 0
                  ? `${myGroup.stories.length} stor${myGroup.stories.length === 1 ? 'y' : 'ies'} · Tap to add more`
                  : 'Tap to add to your story'}
              </Text>
            </View>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#111111' }}>
              No stories from others yet
            </Text>
            <Text style={{ fontSize: 13, color: '#666666', marginTop: 6, textAlign: 'center' }}>
              Stories from your contacts will appear here
            </Text>
          </View>
        }
      />
    </View>
  );
}
