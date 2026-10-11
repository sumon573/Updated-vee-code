/**
 * PlanetScreen — Trending Planet (Note 3, Batch C).
 *
 * - Header: X + "Trending Planet" title only + camera. Story/Marketplace tabs
 *   removed per Sumon.
 * - Real data: subscribePlanetStories() from Firebase — ONLY public
 *   ("Everyone") stories, ranked live by trending score.
 * - TikTok-style vertical full-screen feed: video stories play with expo-video
 *   (only the active item plays), image stories show, text stories render as
 *   cards, audio stories play with expo-audio.
 * - Likes, shares, views PERSIST to Firebase (reactions map, shareCount,
 *   viewCount via transactions) — never local-only counters.
 * - Every error surfaces its actual cause (getErrorCause).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, Image,
  Dimensions, ActivityIndicator, Share, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useRealAuthor } from '../hooks/useRealAuthor';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import {
  subscribePlanetStories,
  reactToStory,
  recordStoryView,
  recordStoryShare,
} from '@/src/features/chat/services/firebaseStoryService';
import type { Story, UserStories } from '@/src/features/chat/types';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import { storyEffectTint } from '@/src/features/chat/data/storyEffects';

const { width, height } = Dimensions.get('window');

interface PlanetItem {
  key: string;
  story: Story;
  userId: string;
  userName: string;
  userAvatar?: string;
}

function PlanetVideoItem({ item, active, overlay }: { item: PlanetItem; active: boolean; overlay: React.ReactNode }) {
  const player = useVideoPlayer(item.story.content, (p) => {
    p.loop = true;
    if (active) p.play();
  });

  useEffect(() => {
    try {
      if (active) player.play();
      else player.pause();
    } catch { /* ignore */ }
  }, [active, player]);

  useEffect(() => {
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player]);

  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height: '100%' }}
        contentFit="cover"
        nativeControls={false}
      />
      <PlanetMediaOverlay story={item.story} />
      {overlay}
    </View>
  );
}

function PlanetAudioItem({ item, overlay }: { item: PlanetItem; overlay: React.ReactNode }) {
  const player = useAudioPlayer(item.story.content);
  const [playing, setPlaying] = useState(false);

  const toggle = useCallback(() => {
    try {
      if (playing) {
        player.pause();
        setPlaying(false);
      } else {
        player.play();
        setPlaying(true);
      }
    } catch { /* ignore */ }
  }, [player, playing]);

  useEffect(() => {
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player]);

  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <LinearGradient
        colors={['#1a1a2e', '#4C1D95']}
        style={{ width, height: '100%', alignItems: 'center', justifyContent: 'center', padding: 32 }}
      >
        <Feather name="music" size={56} color="#8B5CF6" style={{ marginBottom: 12 }} />
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>
          {item.story.audioName || 'Audio story'}
        </Text>
        <Pressable
          onPress={toggle}
          hitSlop={12}
          style={{
            marginTop: 20, width: 64, height: 64, borderRadius: 32,
            backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Feather name={playing ? 'pause' : 'play'} size={28} color="#fff" />
        </Pressable>
      </LinearGradient>
      <PlanetMediaOverlay story={item.story} />
      {overlay}
    </View>
  );
}

/** Saved effect tint + location chip rendered over media items. */
function PlanetMediaOverlay({ story }: { story: Story }) {
  const tint = storyEffectTint(story.effect);
  return (
    <>
      {tint ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint }}
        />
      ) : null}
      {story.locationName ? (
        <View style={{
          position: 'absolute', top: 90, alignSelf: 'center',
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16,
          paddingHorizontal: 12, paddingVertical: 6,
        }}>
          <Feather name="map-pin" size={12} color="#fff" style={{ marginRight: 4 }} />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
            {story.locationName}
          </Text>
        </View>
      ) : null}
    </>
  );
}

function PlanetOverlay({
  item, router, t, viewerUid,
}: {
  item: PlanetItem;
  router: ReturnType<typeof useRouter>;
  t: TFunction;
  viewerUid?: string;
}) {
  // REAL persisted state — reactions map from Firebase, never local-only.
  const reactions = item.story.reactions ?? {};
  const liked = !!viewerUid && !!reactions[viewerUid];
  const likeCount = Object.keys(reactions).length;
  const shareCount = item.story.shareCount ?? 0;
  const viewCount = item.story.viewCount ?? 0;
  // Real author name/avatar (2026-10-11): resolves from RTDB if stored name is placeholder.
  const author = useRealAuthor(item.userId, item.userName, item.userAvatar);

  const handleUserPress = () => {
    router.push({ pathname: '/user-profile', params: { uid: item.userId, name: author.name } });
  };

  const handleLike = async () => {
    if (!viewerUid) return;
    try {
      // Persists to Firebase reactions/{viewerUid}; toggles off if already liked.
      await reactToStory(item.userId, item.story.id, viewerUid, '❤️');
    } catch (error) {
      Alert.alert(t('planet.error', { defaultValue: 'Error' }), getErrorCause(error));
    }
  };

  const handleShare = async () => {
    try {
      const result = await Share.share({
        message: `Check out ${item.userName}'s story on Vee!`,
      });
      // Only count actual shares, not dismissals.
      if (result.action === Share.sharedAction) {
        recordStoryShare(item.userId, item.story.id);
      }
    } catch (error) {
      Alert.alert(t('planet.error', { defaultValue: 'Error' }), getErrorCause(error));
    }
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
            {shareCount > 0 ? formatCount(shareCount) : t('planet.share', { defaultValue: 'Share' })}
          </Text>
        </Pressable>
        <Pressable onPress={handleLike} style={{ alignItems: 'center' }} hitSlop={8}>
          <Feather
            name="heart"
            size={28}
            color={liked ? '#ff3040' : '#fff'}
          />
          <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' }}>
            {likeCount > 0 ? formatCount(likeCount) : t('planet.like', { defaultValue: 'Like' })}
          </Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Feather name="eye" size={24} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' }}>
            {formatCount(viewCount)}
          </Text>
        </View>
      </View>

      {/* Bottom-left user info */}
      <View style={{ position: 'absolute', left: 12, bottom: 100, right: 80 }}>
        <Pressable onPress={handleUserPress} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          {author.avatar ? (
            <Image source={{ uri: author.avatar }} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10 }} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {author.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{author.name}</Text>
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

function PlanetImageItem({ item, overlay }: { item: PlanetItem; overlay: React.ReactNode }) {
  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <Image source={{ uri: item.story.content }} style={{ width, height: '100%' }} resizeMode="cover" />
      <PlanetMediaOverlay story={item.story} />
      {overlay}
    </View>
  );
}

function PlanetTextItem({ item, overlay }: { item: PlanetItem; overlay: React.ReactNode }) {
  const [c1, c2] = item.story.bgGradient ?? ['#7C3AED', '#4C1D95'];
  return (
    <View style={{ width, height: height - 100, backgroundColor: '#000' }}>
      <LinearGradient colors={[c1, c2]} style={{ width, height: '100%', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: item.story.textColor ?? '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' }}>
          {item.story.content}
        </Text>
      </LinearGradient>
      <PlanetMediaOverlay story={item.story} />
      {overlay}
    </View>
  );
}

export default function PlanetScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<PlanetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Views recorded once per story per session (prevents double-counting).
  const recordedViews = useRef<Set<string>>(new Set());

  useEffect(() => {
    // NOTE 3: real public stories from Firebase, trending-ranked.
    // The subscription itself is live; errors surface via the error state.
    let unsub: (() => void) | null = null;
    try {
      unsub = subscribePlanetStories((groups: UserStories[]) => {
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
        setLoadError(null);
        if (flat.length > 0 && !activeKey) setActiveKey(flat[0].key);
      });
    } catch (error) {
      setLoading(false);
      setLoadError(getErrorCause(error));
    }
    return () => { unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems?.length > 0) {
      const item = viewableItems[0].item as PlanetItem;
      setActiveKey(item.key);
      // Persist the view (once per story per session).
      const viewKey = `${item.userId}/${item.story.id}`;
      if (!recordedViews.current.has(viewKey)) {
        recordedViews.current.add(viewKey);
        recordStoryView(item.userId, item.story.id);
      }
    }
  }).current;

  const renderItem = ({ item }: { item: PlanetItem }) => {
    const active = item.key === activeKey;
    const overlay = (
      <PlanetOverlay item={item} router={router} t={t} viewerUid={user?.uid} />
    );
    if (item.story.type === 'video') {
      return <PlanetVideoItem item={item} active={active} overlay={overlay} />;
    }
    if (item.story.type === 'image') {
      return <PlanetImageItem item={item} overlay={overlay} />;
    }
    if (item.story.type === 'audio') {
      return <PlanetAudioItem item={item} overlay={overlay} />;
    }
    return <PlanetTextItem item={item} overlay={overlay} />;
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

      {/* Video feed */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : loadError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Feather name="alert-circle" size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center' }}>
            {loadError}
          </Text>
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
