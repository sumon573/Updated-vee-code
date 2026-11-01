import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, Pressable, Dimensions, Alert } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useTranslation } from 'react-i18next';
import { getErrorCause } from '@/src/utils/errorDisplay';

const { width, height } = Dimensions.get('window');
const ITEM_SIZE = (width - 4) / 3;

export default function CreateStoryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  // Pagination cursor — loads ALL phone photos/videos, not just the first 100.
  const endCursor = useRef<string | undefined>(undefined);
  const hasNextPage = useRef(true);
  const activeAlbum = useRef<string | null>(null);

  const loadAssets = useCallback(async (albumId?: string, reset = true) => {
    if (reset) {
      endCursor.current = undefined;
      hasNextPage.current = true;
      activeAlbum.current = albumId ?? null;
    }
    const result = await MediaLibrary.getAssetsAsync({
      first: 100,
      after: reset ? undefined : endCursor.current,
      album: (albumId ?? activeAlbum.current) as any,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [MediaLibrary.SortBy.creationTime] });
    endCursor.current = result.endCursor;
    hasNextPage.current = result.hasNextPage;
    if (reset) {
      setPhotos(result.assets);
    } else {
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...result.assets.filter((a) => !seen.has(a.id))];
      });
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasNextPage.current) return;
    setLoadingMore(true);
    try {
      await loadAssets(undefined, false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadAssets]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        setHasPermission(status === 'granted');
        if (status === 'granted') {
          await loadAssets(undefined, true);
          const albumList = await MediaLibrary.getAlbumsAsync();
          setAlbums(albumList);
        }
      } catch (error) {
        Alert.alert(
          t('story.error', { defaultValue: 'Error' }),
          getErrorCause(error),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAssets, t]);

  const handleAlbumSelect = useCallback(async (album: MediaLibrary.Album | null) => {
    setAlbumPickerOpen(false);
    setSelectedAlbum(album?.id ?? null);
    setLoading(true);
    try {
      await loadAssets(album?.id, true);
    } catch (error) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        getErrorCause(error),
      );
    } finally {
      setLoading(false);
    }
  }, [loadAssets, t]);

  const handleMultiSelectToggle = useCallback(() => {
    setMultiSelect(prev => {
      if (prev) setSelected(new Set()); // clear on toggle off
      return !prev;
    });
  }, []);

  const handleSelectPhoto = useCallback((asset: MediaLibrary.Asset) => {
    if (multiSelect) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(asset.id)) {
          next.delete(asset.id);
        } else {
          next.add(asset.id);
        }
        return next;
      });
    } else {
      // Single select → go to share page
      router.push({
        pathname: '/story-share',
        params: { assetId: asset.id, uri: asset.uri, mediaType: asset.mediaType } });
    }
  }, [multiSelect, router]);

  const handleTextStory = useCallback(() => {
    router.push('/story-share?mode=text');
  }, [router]);

  const handleMusicStory = useCallback(() => {
    router.push('/story-share?mode=music');
  }, [router]);

  const handleCollageStory = useCallback(() => {
    setMultiSelect(true);
    Alert.alert(
      t('story.selectPhotos', { defaultValue: 'Select photos' }),
      t('story.selectPhotosMsg', { defaultValue: 'Select multiple photos for your collage' })
    );
  }, [t]);

  const handleCamera = useCallback(() => {
    router.push('/story-share?mode=camera');
  }, [router]);

  const renderItem = ({ item }: { item: MediaLibrary.Asset }) => {
    const isSelected = selected.has(item.id);
    return (
      <Pressable
        onPress={() => handleSelectPhoto(item)}
        style={{
          width: ITEM_SIZE, height: ITEM_SIZE,
          margin: 1,
          opacity: isSelected ? 0.7 : 1 }}
      >
        {/* 2026-10-19 perf: expo-image instead of RN Image — the native
            loader downsamples to the ~130px cell size (Glide on Android)
            instead of decoding the full-resolution asset into every cell,
            plus memory+disk caching for fast grid scrolls. */}
        <ExpoImage
          source={{ uri: item.uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        {item.mediaType === 'video' && (
          <View style={{
            position: 'absolute', bottom: 6, right: 6,
            backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4,
            paddingHorizontal: 6, paddingVertical: 2 }}>
            <Feather name="play" size={12} color="#fff" />
          </View>
        )}
        {isSelected && (
          <View style={{
            position: 'absolute', top: 6, right: 6,
            width: 24, height: 24, borderRadius: 12,
            backgroundColor: '#1877F2', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="check" size={14} color="#fff" />
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingBottom: 12, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <Feather name="x" size={24} color="#000" />
        </Pressable>
        <Text style={{
          flex: 1, textAlign: 'center',
          fontSize: 17, fontWeight: '700', color: '#000',
          marginRight: 28 }}>
          {t('story.createStory', { defaultValue: 'Create story' })}
        </Text>
      </View>

      {/* Three cards: Text, Music, Collage */}
      <View style={{
        flexDirection: 'row', paddingHorizontal: 16,
        paddingVertical: 12, gap: 12 }}>
        <Pressable
          onPress={handleTextStory}
          style={{
            flex: 1, backgroundColor: '#f5f5f5', borderRadius: 12,
            paddingVertical: 20, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 28, fontWeight: '800', color: '#000', marginBottom: 4 }}>Aa</Text>
          <Text style={{ fontSize: 13, color: '#000' }}>
            {t('story.text', { defaultValue: 'Text' })}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleMusicStory}
          style={{
            flex: 1, backgroundColor: '#f5f5f5', borderRadius: 12,
            paddingVertical: 20, alignItems: 'center' }}
        >
          <Feather name="music" size={28} color="#000" style={{ marginBottom: 4 }} />
          <Text style={{ fontSize: 13, color: '#000' }}>
            {t('story.music', { defaultValue: 'Music' })}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleCollageStory}
          style={{
            flex: 1, backgroundColor: '#f5f5f5', borderRadius: 12,
            paddingVertical: 20, alignItems: 'center' }}
        >
          <Feather name="grid" size={28} color="#000" style={{ marginBottom: 4 }} />
          <Text style={{ fontSize: 13, color: '#000' }}>
            {t('story.collage', { defaultValue: 'Collage' })}
          </Text>
        </Pressable>
      </View>

      {/* Gallery header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 8 }}>
        <Pressable
          onPress={() => setAlbumPickerOpen(true)}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#000', marginRight: 4 }}>
            {selectedAlbum
              ? albums.find(a => a.id === selectedAlbum)?.title ?? t('story.gallery', { defaultValue: 'Gallery' })
              : t('story.gallery', { defaultValue: 'Gallery' })}
          </Text>
          <Feather name="chevron-down" size={16} color="#000" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={handleMultiSelectToggle}
          style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: multiSelect ? '#1877F2' : '#f0f0f0',
            borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <Feather
            name="image"
            size={14}
            color={multiSelect ? '#fff' : '#000'}
            style={{ marginRight: 6 }}
          />
          <Text style={{
            fontSize: 13, fontWeight: '600',
            color: multiSelect ? '#fff' : '#000' }}>
            {t('story.selectMultiple', { defaultValue: 'Select multiple' })}
          </Text>
        </Pressable>
      </View>

      {/* Photo grid */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="large" />
        </View>
      ) : !hasPermission ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Text style={{ fontSize: 14, color: '#666', textAlign: 'center' }}>
            {t('story.noPermission', { defaultValue: 'Please grant gallery access to select photos' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={{ paddingBottom: 100 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <PremiumLoader size="small" />
            ) : null
          }
        />
      )}

      {/* Camera button */}
      <Pressable
        onPress={handleCamera}
        style={{
          position: 'absolute', bottom: 30, right: 20,
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: '#fff',
          alignItems: 'center', justifyContent: 'center',
          shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 }}
      >
        <Feather name="camera" size={24} color="#1877F2" />
      </Pressable>

      {/* Multi-select action bar */}
      {multiSelect && selected.size > 0 && (
        <Pressable
          onPress={() => {
            const selectedAssets = photos.filter(p => selected.has(p.id));
            router.push({
              pathname: '/story-share',
              params: {
                mode: 'collage',
                assets: JSON.stringify(selectedAssets.map(a => ({ id: a.id, uri: a.uri }))) } });
          }}
          style={{
            position: 'absolute', bottom: 30, left: 20, right: 90,
            backgroundColor: '#1877F2', borderRadius: 12,
            paddingVertical: 14, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
            {t('story.continue', { defaultValue: 'Continue' })} ({selected.size})
          </Text>
        </Pressable>
      )}

      {/* Album picker */}
      {albumPickerOpen && (
        <Pressable
          onPress={() => setAlbumPickerOpen(false)}
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20,
            justifyContent: 'center', alignItems: 'center' }}
        >
          <View style={{
            backgroundColor: '#fff', borderRadius: 16,
            width: width - 60, maxHeight: height * 0.6,
            overflow: 'hidden' }}>
            <Text style={{
              fontSize: 16, fontWeight: '700', color: '#000',
              padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
              {t('story.selectAlbum', { defaultValue: 'Select album' })}
            </Text>
            <FlatList
              data={[{ id: null, title: t('story.allPhotos', { defaultValue: 'All photos' }) } as any, ...albums]}
              keyExtractor={(item) => item.id ?? 'all'}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleAlbumSelect(item.id ? item : null)}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 14,
                    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
                    backgroundColor: (selectedAlbum ?? null) === item.id ? '#f0f7ff' : '#fff' }}
                >
                  <Text style={{ fontSize: 14, color: '#000' }}>{item.title}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      )}
    </View>
  );
}
