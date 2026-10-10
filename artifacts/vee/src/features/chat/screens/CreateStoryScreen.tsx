import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, Image,
  Dimensions, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');
const ITEM_SIZE = (width - 4) / 3;

export default function CreateStoryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      setHasPermission(status === 'granted');
      if (status === 'granted') {
        const result = await MediaLibrary.getAssetsAsync({
          first: 100,
          mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
          sortBy: [MediaLibrary.SortBy.creationTime],
        });
        setPhotos(result.assets);
      }
      setLoading(false);
    })();
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
        params: { assetId: asset.id, uri: asset.uri, mediaType: asset.mediaType },
      });
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
          opacity: isSelected ? 0.7 : 1,
        }}
      >
        <Image
          source={{ uri: item.uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
        {item.mediaType === 'video' && (
          <View style={{
            position: 'absolute', bottom: 6, right: 6,
            backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4,
            paddingHorizontal: 6, paddingVertical: 2,
          }}>
            <Feather name="play" size={12} color="#fff" />
          </View>
        )}
        {isSelected && (
          <View style={{
            position: 'absolute', top: 6, right: 6,
            width: 24, height: 24, borderRadius: 12,
            backgroundColor: '#1877F2', alignItems: 'center', justifyContent: 'center',
          }}>
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
        borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <Feather name="x" size={24} color="#000" />
        </Pressable>
        <Text style={{
          flex: 1, textAlign: 'center',
          fontSize: 17, fontWeight: '700', color: '#000',
          marginRight: 28,
        }}>
          {t('story.createStory', { defaultValue: 'Create story' })}
        </Text>
      </View>

      {/* Three cards: Text, Music, Collage */}
      <View style={{
        flexDirection: 'row', paddingHorizontal: 16,
        paddingVertical: 12, gap: 12,
      }}>
        <Pressable
          onPress={handleTextStory}
          style={{
            flex: 1, backgroundColor: '#f5f5f5', borderRadius: 12,
            paddingVertical: 20, alignItems: 'center',
          }}
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
            paddingVertical: 20, alignItems: 'center',
          }}
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
            paddingVertical: 20, alignItems: 'center',
          }}
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
        paddingHorizontal: 16, paddingVertical: 8,
      }}>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#000', marginRight: 4 }}>
            {t('story.gallery', { defaultValue: 'Gallery' })}
          </Text>
          <Feather name="chevron-down" size={16} color="#000" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setMultiSelect(!multiSelect)}
          style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: multiSelect ? '#1877F2' : '#f0f0f0',
            borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
          }}
        >
          <Feather
            name="image"
            size={14}
            color={multiSelect ? '#fff' : '#000'}
            style={{ marginRight: 6 }}
          />
          <Text style={{
            fontSize: 13, fontWeight: '600',
            color: multiSelect ? '#fff' : '#000',
          }}>
            {t('story.selectMultiple', { defaultValue: 'Select multiple' })}
          </Text>
        </Pressable>
      </View>

      {/* Photo grid */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#1877F2" />
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
          shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
        }}
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
                assets: JSON.stringify(selectedAssets.map(a => ({ id: a.id, uri: a.uri }))),
              },
            });
          }}
          style={{
            position: 'absolute', bottom: 30, left: 20, right: 90,
            backgroundColor: '#1877F2', borderRadius: 12,
            paddingVertical: 14, alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
            {t('story.continue', { defaultValue: 'Continue' })} ({selected.size})
          </Text>
        </Pressable>
      )}
    </View>
  );
}
