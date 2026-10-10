import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, Image, TextInput,
  Dimensions, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { publishStory } from '@/src/features/chat/services/firebaseStoryService';
import { uploadStoryImage, uploadStoryVideo } from '@/src/features/chat/services/cloudinaryService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import * as DocumentPicker from 'expo-document-picker';

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
  const { user } = useAuth();
  const params = useLocalSearchParams();

  const mode = params.mode as string || 'photo';
  const assetUri = params.uri as string;
  const assetId = params.assetId as string;
  // 'video' if the picked asset is a video (passed from CreateStoryScreen as mediaType)
  const assetType = (params.mediaType as string) || 'image';
  
  const [text, setText] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [audience, setAudience] = useState<Audience>('everyone');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [musicUri, setMusicUri] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [cameraUri, setCameraUri] = useState<string | null>(null);
  const [cameraIsVideo, setCameraIsVideo] = useState(false);

  const isTextMode = mode === 'text';
  const isCameraMode = mode === 'camera';

  useEffect(() => {
    if (isCameraMode && !cameraUri) {
      (async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            t('story.error', { defaultValue: 'Error' }),
            t('story.cameraPermission', { defaultValue: 'Camera permission required' }),
            [{ text: 'OK', onPress: () => router.back() }]
          );
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          // NOTE 2 (2026-10-11): allow both photo and video capture for stories.
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          quality: 0.8,
          videoMaxDuration: 60,
        });
        if (!result.canceled && result.assets[0]) {
          setCameraUri(result.assets[0].uri);
          setCameraIsVideo(result.assets[0].type === 'video');
        } else {
          router.back();
        }
      })();
    }
  }, [isCameraMode, cameraUri, router, t]);

  const handleSelectMusic = useCallback(async () => {
    try {
      // NOTE 2 (2026-10-11): real file-manager picker — user chooses the audio file.
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      setMusicUri(file.uri);
      setMusicName(file.name || 'Music');
    } catch (error) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        getErrorCause(error)
      );
    }
  }, [t]);

  // Music mode: auto-open music picker on mount (after handleSelectMusic is defined)
  useEffect(() => {
    if (mode === 'music' && !musicUri) {
      handleSelectMusic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleShare = useCallback(async () => {
    if (isTextMode && !text.trim()) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.emptyText', { defaultValue: 'Please write something' })
      );
      return;
    }
    if (!user?.uid) {
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        t('story.notLoggedIn', { defaultValue: 'Please log in to post a story' })
      );
      return;
    }

    setPosting(true);
    try {
      // NOTE 2 (2026-10-11): REAL story posting to Firebase.
      // privacy: 'everyone' → public (stories/ + Planet), 'contacts' → contactStories/ only.
      const privacy = audience === 'everyone' ? 'public' : 'contacts';
      const userName = user.displayName || 'Vee User';
      const userAvatar = user.photoURL || undefined;
      const mediaUri = assetUri || cameraUri;

      if (isTextMode || mode === 'music') {
        // Text story (music mode: text + music name attached)
        const content = mode === 'music' && musicName
          ? `${text.trim()}\n🎵 ${musicName}`
          : text.trim();
        await publishStory(user.uid, userName, userAvatar, {
          type: 'text',
          content,
          bgGradient: [bgColor, bgColor],
          mentions: [],
          privacy,
        });
      } else if (mediaUri) {
        // Camera captures: use cameraIsVideo; gallery picks: use mediaType param
        const isVideo = cameraUri ? cameraIsVideo : assetType === 'video';
        if (isVideo) {
          const result = await uploadStoryVideo(mediaUri);
          await publishStory(user.uid, userName, userAvatar, {
            type: 'video',
            content: result.url,
            bgGradient: ['#000000', '#000000'],
            mentions: [],
            cloudinaryId: result.publicId,
            privacy,
          });
        } else {
          const result = await uploadStoryImage(mediaUri);
          await publishStory(user.uid, userName, userAvatar, {
            type: 'image',
            content: result.url,
            bgGradient: ['#000000', '#000000'],
            mentions: [],
            cloudinaryId: result.publicId,
            privacy,
          });
        }
      } else {
        throw new Error(t('story.noMedia', { defaultValue: 'No media selected' }));
      }

      Alert.alert(
        t('story.success', { defaultValue: 'Success' }),
        t('story.posted', { defaultValue: 'Story posted!' }),
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      // Standing rule: show the ACTUAL cause, never a generic message.
      Alert.alert(
        t('story.error', { defaultValue: 'Error' }),
        getErrorCause(error)
      );
    } finally {
      setPosting(false);
    }
  }, [text, isTextMode, mode, assetUri, cameraUri, cameraIsVideo, assetType, audience, musicName, bgColor, user, t, router]);

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
        ) : (assetUri || cameraUri) ? (
          <Image
            source={{ uri: (assetUri || cameraUri) as string }}
            style={{ width, height: height * 0.7 }}
            resizeMode="contain"
          />
        ) : mode === 'music' ? (
          <View style={{
            width: width - 40, minHeight: 300,
            backgroundColor: bgColor, borderRadius: 16,
            justifyContent: 'center', alignItems: 'center', padding: 20,
          }}>
            <Feather name="music" size={48} color="#fff" style={{ marginBottom: 16 }} />
            <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>
              {musicName || t('story.tapMusic', { defaultValue: 'Tap "Select Music" above to add music' })}
            </Text>
            <TextInput
              style={{
                color: '#fff', fontSize: 20, fontWeight: '700',
                textAlign: 'center', width: '100%',
              }}
              placeholder={t('story.writeSomething', { defaultValue: 'Write something...' })}
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={text}
              onChangeText={setText}
              multiline
            />
          </View>
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
