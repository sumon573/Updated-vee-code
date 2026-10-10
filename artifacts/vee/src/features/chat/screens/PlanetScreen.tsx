/**
 * PlanetScreen — Trending Planet (2026-10-11, NOTE 3).
 * - Header: X + "Trending Planet" title only + camera (Story/Marketplace tabs removed per Sumon).
 * - Real data: subscribePlanetStories() from Firebase, ranked by trending.
 * - TikTok-style vertical feed: video stories play (expo-video), image stories show,
 *   text stories render as cards.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, Image,
  Dimensions, ActivityIndicator, Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import { subscribePlanetStories } from '@/src/features/chat/services/firebaseStoryService';
import type { Story, UserStories } from '@/src/features/chat/types';

const { width, height } = Dimensions.get('window');

interface PlanetItem {
  key: string;
  story: Story;
  userId: string;
  userName: string;
  userAvatar?: string;
}

function PlanetVideoItem({ item, active }: { item: PlanetItem; active: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const player = useVideoPlayer(item.story.content, (p) => {
    p.loop = true;
    if (active) p.play();
  });

  useEffect(() => {
    if (active) {
      player.play();
    } else {
      player.pause();
    }
  }, [active, player]);

  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height: '100%' }}
        contentFit="cover"
        nativeControls={false}
      />
      <PlanetOverlay item={item} router={router} t={t} />
    </View>
  );
}

function PlanetOverlay({
  item, router, t,
}: {
  item: PlanetItem;
  router: ReturnType<typeof useRouter>;
  t: TFunction;
}) {
  const [liked, setLiked] = useState(false);
  const likeCount = Object.keys(item.story.reactions ?? {}).length + (liked ? 1 : 0);

  const handleUserPress = () => {
    router.push({ pathname: '/user-profile', params: { uid: item.userId, name: item.userName } });
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: `Check out ${item.userName}'s story on Vee!` });
    } catch { /* share cancelled */ }
  };

  const formatCount = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

  return (
    <>
      {/* Right side actions */}
      <View style={{ position: 'absolute', right: 12, bottom: 100, alignItems: 'center', gap: 20 }}>
        <Pressable onPress={handleShare} style={{ alignItems: 'center' }} hitSlop={8}>
          <Feather name="share-2" size={28} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' }}>
            {t('planet.share', { defaultValue: 'Share' })}
          </Text>
        </Pressable>
        <Pressable onPress={() => setLiked((v) => !v)} style={{ alignItems: 'center' }} hitSlop={8}>
          <Feather name="heart" size={28} color={liked ? '#ff3040' : '#fff'} />
          <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' }}>
            {likeCount > 0 ? formatCount(likeCount) : t('planet.like', { defaultValue: 'Like' })}
          </Text>
        </Pressable>
      </View>

      {/* Bottom-left user info */}
      <View style={{ position: 'absolute', left: 12, bottom: 100, right: 80 }}>
        <Pressable onPress={handleUserPress} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          {item.userAvatar ? (
            <Image source={{ uri: item.userAvatar }} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10 }} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {item.userName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{item.userName}</Text>
        </Pressable>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' }}>
          <Feather name="globe" size={12} color="#000" style={{ marginRight: 6 }} />
          <Text style={{ color: '#000', fontSize: 12, fontWeight: '600' }}>
            {t('planet.public', { defaultValue: 'Everyone' })}
          </Text>
        </View>
      </View>
    </>
  );
}

function PlanetImageItem({ item }: { item: PlanetItem }) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <Image source={{ uri: item.story.content }} style={{ width, height: '100%' }} resizeMode="cover" />
      <PlanetOverlay item={item} router={router} t={t} />
    </View>
  );
}

function PlanetTextItem({ item }: { item: PlanetItem }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [c1, c2] = item.story.bgGradient ?? ['#7C3AED', '#4C1D95'];
  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <LinearGradient colors={[c1, c2]} style={{ width, height: '100%', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: item.story.textColor ?? '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' }}>
          {item.story.content}
        </Text>
      </LinearGradient>
      <PlanetOverlay item={item} router={router} t={t} />
    </View>
  );
}

export default function PlanetScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [items, setItems] = useState<PlanetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    // NOTE 3 (2026-10-11): real public stories from Firebase, trending-ranked.
    const unsub = subscribePlanetStories((groups: UserStories[]) => {
      const flat: PlanetItem[] = [];
      for (const g of groups) {
        for (const s of g.stories) {
          flat.push({
            key: `${g.userId}_${s.id}`,
            story: s,
            userId: g.userId,
            userName: g.userName,
            userAvatar: g.userAvatar,
          });
        }
      }
      setItems(flat);
      setLoading(false);
      if (flat.length > 0 && !activeKey) setActiveKey(flat[0].key);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems?.length > 0) {
      setActiveKey(viewableItems[0].item.key);
    }
  }).current;

  const renderItem = ({ item }: { item: PlanetItem }) => {
    const active = item.key === activeKey;
    if (item.story.type === 'video') {
      return <PlanetVideoItem item={item} active={active} />;
    }
    if (item.story.type === 'image') {
      return <PlanetImageItem item={item} />;
    }
    return <PlanetTextItem item={item} />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Top bar — NOTE 3: only "Trending Planet" title, tabs removed */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4, marginRight: 12 }} hitSlop={8}>
          <Feather name="x" size={24} color="#fff" />
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
          {t('planet.trendingPlanet', { defaultValue: 'Trending Planet' })}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/create-story')} hitSlop={8}>
          <Feather name="camera" size={24} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Feather name="globe" size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' }}>
            {t('planet.empty', { defaultValue: 'No public stories yet. Be the first to share!' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        />
      )}
    </View>
  );
}
