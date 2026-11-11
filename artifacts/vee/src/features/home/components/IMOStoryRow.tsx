/**
 * IMOStoryRow — IMO-style story circles row (2026-10-10).
 * "Add a story" + horizontal scrollable story DPs with unread badges.
 */
import { memo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useLiveProfiles } from '@/src/hooks/useLiveUserProfile';

export interface IMOStory {
  id: string;
  /** Author uid — the strip resolves the CURRENT photo live from RTDB. */
  userId?: string;
  name: string;
  photoURL?: string | null;
  unreadCount?: number;
}

interface IMOStoryRowProps {
  stories: IMOStory[];
  onAddStory: () => void;
  onStoryPress: (storyId: string) => void;
}

// 2026-11-07 (IMO home scroll smoothness): memo()'d — the shell
// re-renders on every chat/presence/story update, and the old plain
// component re-rendered the whole story strip (all its images) each
// time. Props are stable (useMemo'd stories, stable callbacks), so
// unrelated shell renders now skip the strip entirely.
export default memo(function IMOStoryRow({ stories, onAddStory, onStoryPress }: IMOStoryRowProps) {
  // 2026-11-11 (boss: photo change shows EVERYWHERE): the circle photo
  // was the publish-time snapshot (story.userAvatar) — an author who
  // changed their photo kept the OLD circle until the story expired.
  // Live RTDB photo per author (ref-counted hub) wins; the snapshot is
  // only the first-paint fallback. id is the author uid on the one caller
  // (IMOHomeScreen), userId is the explicit field when set.
  const liveProfiles = useLiveProfiles(stories.map((s) => s.userId ?? s.id));
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        // 2026-10-30 (boss: top lines light grey, faint): was '#E0E0E0'.
        borderBottomColor: '#EAEAEA',
        paddingVertical: 12,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      >
        {/* Add a story */}
        <TouchableOpacity
          onPress={onAddStory}
          activeOpacity={0.7}
          style={{ alignItems: 'center', marginRight: 16, width: 64 }}
        >
          <View>
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: '#F5F5F5',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="camera" size={28} color="#000000" />
            </View>
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: '#2196F3',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: '#FFFFFF',
              }}
            >
              <Ionicons name="add" size={14} color="#fff" />
            </View>
          </View>
          <Text
            style={{ marginTop: 6, fontSize: 12, color: '#212121' }}
            numberOfLines={1}
          >
            Story
          </Text>
        </TouchableOpacity>

        {/* Story items */}
        {stories.map((story) => {
          const hasUnread = (story.unreadCount ?? 0) > 0;
          const authorUid = story.userId ?? story.id;
          const livePhotoURL = liveProfiles[authorUid]?.avatar ?? story.photoURL ?? null;
          return (
          <TouchableOpacity
            key={story.id}
            onPress={() => onStoryPress(story.id)}
            activeOpacity={0.7}
            style={{ alignItems: 'center', marginRight: 16, width: 64 }}
          >
            <View
              style={
                hasUnread
                  ? {
                      width: 66,
                      height: 66,
                      borderRadius: 33,
                      borderWidth: 2,
                      borderColor: '#2196F3',
                      padding: 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }
                  : undefined
              }
            >
              {livePhotoURL ? (
                <Image
                  source={{ uri: livePhotoURL }}
                  style={{ width: hasUnread ? 58 : 60, height: hasUnread ? 58 : 60, borderRadius: hasUnread ? 29 : 30 }}
                />
              ) : (
                <View
                  style={{
                    width: hasUnread ? 58 : 60,
                    height: hasUnread ? 58 : 60,
                    borderRadius: hasUnread ? 29 : 30,
                    backgroundColor: '#E0E0E0',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: '700', color: '#757575' }}>
                    {story.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              {hasUnread && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    backgroundColor: '#4CAF50',
                    borderRadius: 10,
                    minWidth: 20,
                    height: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                    {story.unreadCount}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={{ marginTop: 6, fontSize: 12, color: '#212121' }}
              numberOfLines={1}
            >
              {story.name}
            </Text>
          </TouchableOpacity>
          );
        })}
        {/* Planet — TikTok-style public video feed */}
        <TouchableOpacity
          onPress={() => onStoryPress('__planet__')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', marginRight: 16, width: 64 }}
        >
          <View
            style={{
              width: 60, height: 60, borderRadius: 30,
              backgroundColor: '#E8F5E9',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: '#4CAF50',
            }}
          >
            <Feather name="globe" size={28} color="#4CAF50" />
          </View>
          <Text
            style={{ marginTop: 6, fontSize: 12, color: '#212121', fontWeight: '600' }}
            numberOfLines={1}
          >
            Planet
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
})
