/**
 * IMOStoryRow — IMO-style story circles row (2026-10-10).
 * "Add a story" + horizontal scrollable story DPs with unread badges.
 */
import { View, Text, Image, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface IMOStory {
  id: string;
  name: string;
  photoURL?: string | null;
  unreadCount?: number;
}

interface IMOStoryRowProps {
  stories: IMOStory[];
  onAddStory: () => void;
  onStoryPress: (storyId: string) => void;
}

export default function IMOStoryRow({ stories, onAddStory, onStoryPress }: IMOStoryRowProps) {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
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
              <Ionicons name="camera" size={28} color="#757575" />
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
            Add a story
          </Text>
        </TouchableOpacity>

        {/* Story items */}
        {stories.map((story) => {
          const hasUnread = (story.unreadCount ?? 0) > 0;
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
              {story.photoURL ? (
                <Image
                  source={{ uri: story.photoURL }}
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
      </ScrollView>
    </View>
  );
}
