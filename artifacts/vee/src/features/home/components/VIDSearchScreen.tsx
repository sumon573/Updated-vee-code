/**
 * VIDSearchScreen — Search users by V-ID (short ID) and send friend requests.
 * Opened from IMO Search page's "Add Friends".
 */
import { useState } from 'react';
import { View, Text, TextInput, FlatList, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { getUserByShortId } from '@/src/services/userService';
import { showErrorWithCause } from '@/src/utils/errorDisplay';

export default function VIDSearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const found = await getUserByShortId(q);
      // Don't show self
      if (found && found.uid === user?.uid) {
        setResult(null);
      } else {
        setResult(found);
      }
    } catch (e) {
      showErrorWithCause('Search failed', e);
      setResult(null);
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = () => {
    if (!result) return;
    // Navigate to user profile to send friend request
    router.push(`/user-profile?uid=${result.uid}` as any);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Search bar */}
      <View style={{ padding: 12, backgroundColor: '#FFFFFF' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#F0F0F0',
            borderRadius: 24,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 8 }}>
            <Ionicons name="arrow-back" size={22} color="#616161" />
          </TouchableOpacity>
          <TextInput
            placeholder="Enter V-ID (e.g. 8888)"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            autoFocus
            keyboardType="numeric"
            style={{ flex: 1, fontSize: 16, color: '#212121' }}
            placeholderTextColor="#9E9E9E"
          />
          {searching ? (
            <ActivityIndicator size="small" color="#2196F3" />
          ) : (
            <TouchableOpacity onPress={handleSearch}>
              <Ionicons name="search" size={22} color="#2196F3" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Result */}
      <View style={{ flex: 1, padding: 16 }}>
        {searching ? (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <ActivityIndicator size="large" color="#2196F3" />
            <Text style={{ marginTop: 12, color: '#757575' }}>Searching...</Text>
          </View>
        ) : searched && !result ? (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Ionicons name="person-outline" size={48} color="#BDBDBD" />
            <Text style={{ marginTop: 12, color: '#757575', fontSize: 16 }}>
              No user found with this V-ID
            </Text>
          </View>
        ) : result ? (
          <TouchableOpacity
            onPress={handleAddFriend}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              padding: 16,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {result.photoURL ? (
              <Image
                source={{ uri: result.photoURL }}
                style={{ width: 56, height: 56, borderRadius: 28 }}
              />
            ) : (
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: '#E0E0E0',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 22, fontWeight: '700', color: '#757575' }}>
                  {(result.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#212121' }}>
                {result.name || 'User'}
              </Text>
              <Text style={{ fontSize: 14, color: '#757575', marginTop: 2 }}>
                V-ID: {result.shortId}
              </Text>
            </View>
            <View
              style={{
                backgroundColor: '#2196F3',
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Add</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Ionicons name="search-outline" size={48} color="#BDBDBD" />
            <Text style={{ marginTop: 12, color: '#757575', fontSize: 16, textAlign: 'center' }}>
              Enter a V-ID to find friends
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
