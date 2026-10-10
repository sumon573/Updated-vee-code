import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, Image,
  Dimensions, ActivityIndicator, Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const { width, height } = Dimensions.get('window');

interface PlanetVideo {
  id: string;
  userId: string;
  userName: string;
  userPhotoURL?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  likes: number;
  shares: number;
  audience: string;
  liked?: boolean;
}

export default function PlanetScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [videos, setVideos] = useState<PlanetVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'story' | 'planet' | 'marketplace'>('planet');

  useEffect(() => {
    // TODO: Fetch public videos from Firebase (audience === 'everyone')
    // For now, empty state
    setLoading(false);
  }, []);

  const handleLike = useCallback((videoId: string) => {
    setVideos(prev => prev.map(v => {
      if (v.id === videoId) {
        return {
          ...v,
          liked: !v.liked,
          likes: v.liked ? v.likes - 1 : v.likes + 1,
        };
      }
      return v;
    }));
  }, []);

  const handleShare = useCallback(async (video: PlanetVideo) => {
    try {
      await Share.share({
        message: `Check out this video from ${video.userName} on Vee!`,
      });
      setVideos(prev => prev.map(v =>
        v.id === video.id ? { ...v, shares: v.shares + 1 } : v
      ));
    } catch (error) {
      // Share cancelled
    }
  }, []);

  const handleUserPress = useCallback((userId: string, userName: string) => {
    router.push({ pathname: '/user-profile', params: { uid: userId, name: userName } });
  }, [router]);

  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(2)}K`;
    }
    return count.toString();
  };

  const renderVideo = ({ item, index }: { item: PlanetVideo; index: number }) => {
    return (
      <View style={{ width, height: height - 100, backgroundColor: '#111' }}>
        {/* Video thumbnail (video playback requires expo-av) */}
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={{ width, height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="play-circle" size={64} color="rgba(255,255,255,0.5)" />
          </View>
        )}

        {/* Right side actions */}
        <View style={{
          position: 'absolute', right: 12, bottom: 100,
          alignItems: 'center', gap: 20,
        }}>
          <Pressable
            onPress={() => handleShare(item)}
            style={{ alignItems: 'center' }}
          >
            <Feather name="share-2" size={28} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' }}>
              {item.shares > 0 ? formatCount(item.shares) : t('planet.share', { defaultValue: 'Share' })}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleLike(item.id)}
            style={{ alignItems: 'center' }}
          >
            <Feather
              name="heart"
              size={28}
              color={item.liked ? '#ff3040' : '#fff'}
            />
            <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' }}>
              {item.likes > 0 ? formatCount(item.likes) : t('planet.like', { defaultValue: 'Like' })}
            </Text>
          </Pressable>
        </View>

        {/* Bottom-left user info */}
        <View style={{
          position: 'absolute', left: 12, bottom: 100, right: 80,
        }}>
          <Pressable
            onPress={() => handleUserPress(item.userId, item.userName)}
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
          >
            {item.userPhotoURL ? (
              <Image
                source={{ uri: item.userPhotoURL }}
                style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10 }}
              />
            ) : (
              <View style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.3)',
                alignItems: 'center', justifyContent: 'center', marginRight: 10,
              }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  {item.userName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
              {item.userName}
            </Text>
          </Pressable>
          <View style={{
            backgroundColor: 'rgba(255,255,255,0.9)',
            borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6,
            alignSelf: 'flex-start',
            flexDirection: 'row', alignItems: 'center',
          }}>
            <Feather name="users" size={12} color="#000" style={{ marginRight: 6 }} />
            <Text style={{ color: '#000', fontSize: 12, fontWeight: '600' }}>
              {item.audience === 'everyone'
                ? t('planet.friendsOfFriends', { defaultValue: 'Friends of Friends' })
                : item.audience}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    // Track visible video for future playback control
  }).current;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Top bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4, marginRight: 12 }}>
          <Feather name="x" size={24} color="#fff" />
        </Pressable>
        
        <Pressable onPress={() => router.back()} style={{ marginRight: 20 }}>
          <Text style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 17, fontWeight: '400',
          }}>
            {t('planet.story', { defaultValue: 'Story' })}
          </Text>
        </Pressable>
        
        <Pressable onPress={() => setActiveTab('planet')} style={{ marginRight: 20 }}>
          <Text style={{
            color: activeTab === 'planet' ? '#fff' : 'rgba(255,255,255,0.6)',
            fontSize: 17, fontWeight: activeTab === 'planet' ? '700' : '400',
            textDecorationLine: activeTab === 'planet' ? 'underline' : 'none',
          }}>
            {t('planet.planet', { defaultValue: 'Planet' })}
          </Text>
        </Pressable>
        
        <Pressable onPress={() => setActiveTab('marketplace')}>
          <Text
            style={{
              color: activeTab === 'marketplace' ? '#fff' : 'rgba(255,255,255,0.6)',
              fontSize: 17, fontWeight: activeTab === 'marketplace' ? '700' : '400',
              textDecorationLine: activeTab === 'marketplace' ? 'underline' : 'none',
            }}
            numberOfLines={1}
          >
            {t('planet.marketplace', { defaultValue: 'Marketplace' })}
          </Text>
        </Pressable>

        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/create-story')}>
          <Feather name="camera" size={24} color="#fff" />
        </Pressable>
      </View>

      {/* Video feed */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : activeTab === 'marketplace' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Feather name="shopping-bag" size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' }}>
            {t('planet.marketplaceSoon', { defaultValue: 'Marketplace is coming soon!' })}
          </Text>
        </View>
      ) : videos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Feather name="globe" size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' }}>
            {t('planet.empty', { defaultValue: 'No public videos yet. Be the first to share!' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={videos}
          renderItem={renderVideo}
          keyExtractor={(item) => item.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        />
      )}
    </View>
  );
}
