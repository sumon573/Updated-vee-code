import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, Image, TextInput,
  Dimensions, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useTranslation } from 'react-i18next';

const { width, height } = Dimensions.get('window');

// 8 background colors for TEXT stories (IMO style)
const BG_COLORS = [
  '#7C3AED', // purple
  '#EC4899', // pink
  '#F59E0B', // orange
  '#10B981', // green
  '#3B82F6', // blue
  '#EF4444', // red
  '#8B5CF6', // violet
  '#000000', // black
];

type Audience = 'everyone' | 'contacts';

export default function StoryShareScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  
  const mode = params.mode as string || 'photo';
  const assetUri = params.uri as string;
  const assetId = params.assetId as string;
  
  const [text, setText] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [audience, setAudience] = useState<Audience>('everyone');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [musicUri, setMusicUri] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const isTextMode = mode === 'text';

  const handleSelectMusic = useCallback(async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('story.error', { defaultValue: 'Error' }),
          t('story.noPermission', { defaultValue: 'Please grant media access' })
        );
        return;
      }
      // Get audio files from media library
      const result = await MediaLibrary.getAssetsAsync({
        first: 50,
        mediaType: MediaLibrary.MediaType.audio,
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      if (result.assets.length === 0) {
        Alert.alert(
          t('story.noMusic', { defaultValue: 'No music found' }),
          t('story.noMusicMsg', { defaultValue: 'No audio files found on your device' })
        );
        return;
      }
      // For now, pick the first one — in a full implementation, show a picker
      const firstAudio = result.assets[0];
      setMusicUri(firstAudio.uri);
      setMusicName(firstAudio.filename || 'Music');
      Alert.alert(
        t('story.musicSelected', { defaultValue: 'Music selected' }),
        firstAudio.filename || 'Music'
      );
    } catch (error) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.musicError', { defaultValue: 'Could not select music' })
      );
    }
  }, [t]);

  const handleShare = useCallback(async () => {
    if (isTextMode && !text.trim()) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.emptyText', { defaultValue: 'Please write something' })
      );
      return;
    }
    
    setPosting(true);
    try {
      // TODO: Upload to Firebase and create story
      // For now, simulate
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      Alert.alert(
        t('story.success', { defaultValue: 'Success' }),
        t('story.posted', { defaultValue: 'Story posted!' }),
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.postError', { defaultValue: 'Could not post story' })
      );
    } finally {
      setPosting(false);
    }
  }, [text, isTextMode, t, router]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Top bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <Feather name="x" size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Pressable
            onPress={handleSelectMusic}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
            }}
          >
            <Feather name="music" size={14} color="#fff" style={{ marginRight: 6 }} />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
              {musicName || t('story.selectMusic', { defaultValue: 'Select Music' })}
            </Text>
          </Pressable>
        </View>
        <View style={{ width: 32 }} />
      </View>

      {/* Story content */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        {isTextMode ? (
          <View style={{
            width: width - 40, minHeight: 300,
            backgroundColor: bgColor, borderRadius: 16,
            justifyContent: 'center', alignItems: 'center', padding: 20,
          }}>
            <TextInput
              style={{
                color: '#fff', fontSize: 24, fontWeight: '700',
                textAlign: 'center', width: '100%',
              }}
              placeholder={t('story.writeSomething', { defaultValue: 'Write something...' })}
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
            />
          </View>
        ) : assetUri ? (
          <Image
            source={{ uri: assetUri }}
            style={{ width, height: height * 0.7 }}
            resizeMode="contain"
          />
        ) : (
          <Text style={{ color: '#fff' }}>
            {t('story.noMedia', { defaultValue: 'No media selected' })}
          </Text>
        )}
      </View>

      {/* Right toolbar */}
      <View style={{
        position: 'absolute', right: 12, top: height * 0.3,
        gap: 20, zIndex: 10,
      }}>
        <Pressable style={{ alignItems: 'center' }}>
          <Feather name="smile" size={24} color="#fff" />
        </Pressable>
        <Pressable style={{ alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>A</Text>
        </Pressable>
        <Pressable style={{ alignItems: 'center' }}>
          <Feather name="edit-3" size={24} color="#fff" />
        </Pressable>
        <Pressable style={{ alignItems: 'center' }}>
          <Feather name="map-pin" size={24} color="#fff" />
        </Pressable>
        <Pressable style={{ alignItems: 'center' }}>
          <Feather name="at-sign" size={24} color="#fff" />
        </Pressable>
        <Pressable style={{ alignItems: 'center' }}>
          <Feather name="camera" size={24} color="#fff" />
        </Pressable>
      </View>

      {/* Bottom area */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingHorizontal: 16, paddingBottom: 30, zIndex: 10,
      }}>
        {/* Background colors (TEXT ONLY) */}
        {isTextMode && (
          <View style={{
            flexDirection: 'row', justifyContent: 'center',
            marginBottom: 16, gap: 8,
          }}>
            {BG_COLORS.map((color) => (
              <Pressable
                key={color}
                onPress={() => setBgColor(color)}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: color,
                  borderWidth: bgColor === color ? 3 : 1,
                  borderColor: bgColor === color ? '#fff' : 'rgba(255,255,255,0.3)',
                }}
              />
            ))}
          </View>
        )}

        {/* Audience selector + Share button */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Pressable
            onPress={() => setAudienceOpen(!audienceOpen)}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10,
            }}
          >
            <Feather
              name="globe"
              size={14}
              color="#fff"
              style={{ marginRight: 6 }}
            />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginRight: 4 }}>
              {audience === 'everyone'
                ? t('story.everyone', { defaultValue: 'Everyone' })
                : t('story.myContacts', { defaultValue: 'My Contact' })}
            </Text>
            <Feather name="chevron-right" size={14} color="#fff" />
          </Pressable>

          <Pressable
            onPress={handleShare}
            disabled={posting}
            style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: '#1877F2',
              alignItems: 'center', justifyContent: 'center',
              opacity: posting ? 0.6 : 1,
            }}
          >
            {posting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="send" size={24} color="#fff" />
            )}
          </Pressable>
        </View>

        {/* Audience dropdown */}
        {audienceOpen && (
          <View style={{
            position: 'absolute', bottom: 80, left: 16,
            backgroundColor: '#fff', borderRadius: 12,
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
            overflow: 'hidden',
          }}>
            <Pressable
              onPress={() => { setAudience('everyone'); setAudienceOpen(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: audience === 'everyone' ? '#f0f7ff' : '#fff',
              }}
            >
              <Feather name="globe" size={16} color="#000" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>
                  {t('story.everyone', { defaultValue: 'Everyone' })}
                </Text>
                <Text style={{ fontSize: 11, color: '#666' }}>
                  {t('story.everyoneDesc', { defaultValue: 'Public — visible in Planet' })}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => { setAudience('contacts'); setAudienceOpen(false); }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: audience === 'contacts' ? '#f0f7ff' : '#fff',
              }}
            >
              <Feather name="users" size={16} color="#000" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>
                  {t('story.myContacts', { defaultValue: 'My Contact' })}
                </Text>
                <Text style={{ fontSize: 11, color: '#666' }}>
                  {t('story.contactsDesc', { defaultValue: 'Only your contacts can see' })}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
