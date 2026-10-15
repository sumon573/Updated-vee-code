/**
 * VIDSearchScreen — Search users by V-ID (short ID) and send friend requests.
 * Opened from IMO Search page's "Add Friends".
 */
import { useState } from 'react';
import { View, Text, TextInput, FlatList, Image, TouchableOpacity } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { getUserByShortId } from '@/src/services/userService';
import { getBlockDirection, BlockDirection } from '@/src/services/blockService';
import { showErrorWithCause } from '@/src/utils/errorDisplay';
import { VerifiedName } from '@/src/components/VerifiedName';
import AnimatedFrame from '@/src/components/AnimatedFrame';
import { truncateTo12 } from '@/src/utils/truncateName';

export default function VIDSearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [searched, setSearched] = useState(false);
  // 2026-10-13 (Sumon): রেজাল্ট ব্লকড হলে — byThem হলে লুকানো হয়,
  // byMe হলে "Unblock" অ্যাকশন দেখায়।
  const [resultBlockedByMe, setResultBlockedByMe] = useState(false);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    setResultBlockedByMe(false);
    try {
      const found = await getUserByShortId(q);
      // Don't show self
      if (found && found.uid === user?.uid) {
        setResult(null);
      } else if (found && user?.uid) {
        // ব্লক চেক (Sumon 2026-10-13): ও আমাকে ব্লক করলে সার্চে
        // দেখানো যাবে না; আমি ব্লক করলে Unblock অপশন থাকবে।
        const dir = await getBlockDirection(user.uid, found.uid).catch(() => 'none' as BlockDirection);
        if (dir === 'byThem' || dir === 'mutual') {
          setResult(null);
        } else {
          setResult(found);
          setResultBlockedByMe(dir === 'byMe');
        }
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
    const fallbackName = result.name || (result.email ? result.email.split('@')[0] : '');
    router.push(`/user-profile?uid=${result.uid}&name=${encodeURIComponent(fallbackName)}` as any);
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
            paddingVertical: 10 }}
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
            <PremiumLoader size="small" />
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
            <PremiumLoader size="large" />
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
              alignItems: 'center' }}
          >
            {result.photoURL ? (
              <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                <Image
                  source={{ uri: result.photoURL }}
                  style={{ width: 56, height: 56, borderRadius: 28 }}
                />
                {/* 2026-10-13 (Sumon): Server-hosted animated frame in v-id search */}
                {!!result.activeFrame && result.activeFrame !== 'none' && (
                  <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
                    <AnimatedFrame size={56} frameId={result.activeFrame} />
                  </View>
                )}
              </View>
            ) : (
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: '#E0E0E0',
                  alignItems: 'center',
                  justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 22, fontWeight: '700', color: '#757575' }}>
                  {((result.name || (result.email ? result.email.split('@')[0] : null) || '?')).charAt(0).toUpperCase()}
                </Text>
                {/* 2026-10-13 (Sumon): Server-hosted animated frame in v-id search */}
                {!!result.activeFrame && result.activeFrame !== 'none' && (
                  <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
                    <AnimatedFrame size={56} frameId={result.activeFrame} />
                  </View>
                )}
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <VerifiedName
                name={truncateTo12(result.name || (result.email ? result.email.split('@')[0] : null) || 'User')}
                uid={result.uid || result.id}
                nameStyle={{ fontSize: 17, fontWeight: '700', color: '#212121' }}
                logoSize={18}
              />
              <Text style={{ fontSize: 14, color: '#757575', marginTop: 2 }}>
                V-ID: {result.shortId}
              </Text>
            </View>
            <View
              style={{
                // 2026-10-13 (Sumon): বাটন স্ট্যান্ডার্ড #E3F2FD bg + #007AFF text
                backgroundColor: '#E3F2FD',
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 8 }}
            >
              <Text style={{ color: '#007AFF', fontWeight: '600' }}>
                {resultBlockedByMe ? 'Unblock' : 'Add'}
              </Text>
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
