/**
 * DP Viewer — full-screen profile photo viewer.
 * Route: /profile/dp-viewer?uid=xxx
 * 2026-10-13 (Sumon): Converted from Modal to dedicated route —
 * Modal was showing 404 on other users' profiles.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/src/context/AuthContext';
import { getUser, updateUser } from '@/src/services/userService';
import * as ImagePicker from 'expo-image-picker';
import { uploadProfilePhoto } from '@/src/services/cloudinaryService';

export default function DpViewerScreen() {
  const { user } = useAuth();
  const { uid } = useLocalSearchParams<{ uid?: string }>();
  const targetUid = uid ?? user?.uid;
  const isMe = !uid || uid === user?.uid;

  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('User');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!targetUid) { setLoading(false); return; }
    getUser(targetUid).then((u) => {
      setPhotoURL(u?.photoURL || null);
      setDisplayName(u?.name || 'User');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [targetUid]);

  const handleChangeDp = async () => {
    if (!isMe || !user?.uid) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8 });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploading(true);
      const upload = await uploadProfilePhoto(result.assets[0].uri);
      await updateUser(user.uid, { photoURL: upload.url });
      setPhotoURL(upload.url);
    } catch {
      // Silent fail — user can retry
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Pressable
          onPress={() => router.back()}
          style={{ position: 'absolute', top: 55, right: 20, zIndex: 10, padding: 8 }}
          hitSlop={12}
        >
          <Feather name="x" size={28} color="#fff" />
        </Pressable>
        {loading ? (
          <PremiumLoader size="large" />
        ) : photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{ width: '100%', aspectRatio: 1, maxHeight: '70%' }}
            resizeMode="contain"
          />
        ) : (
          <View style={{ width: 160, height: 160, borderRadius: 80, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 64, fontWeight: '800', color: '#fff' }}>{displayName[0]?.toUpperCase()}</Text>
          </View>
        )}
        {isMe && (
          <Pressable
            onPress={handleChangeDp}
            disabled={uploading}
            style={{
              marginTop: 32, flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#1C1C1E', borderRadius: 24,
              paddingHorizontal: 28, paddingVertical: 12,
              opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? (
              <PremiumLoader size="small" />
            ) : (
              <Feather name="edit-2" size={16} color="#fff" style={{ marginRight: 8 }} />
            )}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {uploading ? 'Uploading…' : 'Change'}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}
