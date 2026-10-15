/**
 * NobleRankPreview — 2026-10-15 (Sumon).
 * User sees how EACH Nobel rank looks on their own profile.
 * REAL data only: user's DP/name + rank's actual CDN designs from catalog.
 * Luxury premium modal, no demo content.
 */
import React from 'react';
import { View, Text, Image, Modal, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { NOBLE_REWARDS_CATALOG, rewardIcon } from '@/src/services/nobleRewardsCatalog';
import { NOBLE_RANKS, formatXP } from '@/src/services/nobleService';
import MistNameplate from '@/src/components/MistNameplate';

type Props = {
  visible: boolean;
  onClose: () => void;
  rankIndex: number;
  userName: string;
  userPhotoURL?: string | null;
  userXP: number;
};

export default function NobleRankPreview({
  visible, onClose, rankIndex, userName, userPhotoURL, userXP,
}: Props) {
  const rank = NOBLE_RANKS[rankIndex];
  const catalog = NOBLE_REWARDS_CATALOG.find(c => c.rankKey === rank.key);
  if (!rank || !catalog) return null;

  const nameplateUrl = catalog.nameplate?.designUrl;
  const badgeUrl = catalog.badge?.designUrl;
  const frameUrl = catalog.frame?.designUrl;
  const mistColor = catalog.nameplate?.mistColor;

  const xpNeeded = Math.max(0, rank.minXP - userXP);
  const isUnlocked = userXP >= rank.minXP;

  const rewards: { icon: string; label: string; url?: string }[] = [];
  if (catalog.nameplate) {
    rewards.push({
      icon: '📛',
      label: `${rank.name} Nameplate`,
      url: nameplateUrl,
    });
  }
  if (catalog.badge) {
    rewards.push({
      icon: '🏅',
      label: `${rank.name} Badge`,
      url: badgeUrl,
    });
  }
  if (catalog.frame) {
    rewards.push({
      icon: '👑',
      label: `${rank.name} Frame`,
      url: frameUrl,
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: '#fff', borderRadius: 24,
            width: '100%', maxWidth: 360, maxHeight: '90%',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
          }}>
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: rank.color + '22',
              alignItems: 'center', justifyContent: 'center', marginRight: 12,
            }}>
              <Text style={{ fontSize: 18 }}>{catalog.nameplate ? '📛' : '👑'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#000' }}>
                {rank.name} Preview
              </Text>
              <Text style={{ fontSize: 12, color: rank.color, fontWeight: '700' }}>
                {formatXP(rank.minXP)} XP required
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={24} color="#999" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Profile Preview */}
            <View style={{
              backgroundColor: '#1a1a2e', padding: 24, alignItems: 'center',
            }}>
              {/* DP with Frame - 1.6x matches voice room implementation */}
              <View style={{ width: 144, height: 144, marginBottom: 12 }}>
                {userPhotoURL ? (
                  <Image
                    source={{ uri: userPhotoURL }}
                    style={{ width: 90, height: 90, borderRadius: 45, margin: 27 }}
                  />
                ) : (
                  <View style={{
                    width: 90, height: 90, borderRadius: 45, margin: 27,
                    backgroundColor: '#667eea', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: '#fff' }}>
                      {(userName || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                {frameUrl && /^https?:\/\//i.test(frameUrl) ? (
                  <Image
                    source={{ uri: frameUrl }}
                    style={{
                      position: 'absolute', width: 144, height: 144,
                    }}
                    resizeMode="contain"
                  />
                ) : null}
              </View>

              {/* Name */}
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 }}>
                {userName || 'Vee User'}
              </Text>

              {/* Nameplate - 5:1 ratio matches actual design */}
              {nameplateUrl && /^https?:\/\//i.test(nameplateUrl) ? (
                mistColor ? (
                  <MistNameplate
                    imageUrl={nameplateUrl}
                    mistColor={mistColor}
                    width={150}
                    height={30}
                  />
                ) : (
                  <Image
                    source={{ uri: nameplateUrl }}
                    style={{ width: 150, height: 30 }}
                    resizeMode="contain"
                  />
                )
              ) : (
                <View style={{
                  backgroundColor: rank.color + '33',
                  borderWidth: 1.5, borderColor: rank.color,
                  borderRadius: 14, paddingHorizontal: 14, paddingVertical: 5,
                }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: rank.color }}>
                    {rank.name}
                  </Text>
                </View>
              )}

              {/* Badge */}
              {badgeUrl && /^https?:\/\//i.test(badgeUrl) ? (
                <Image
                  source={{ uri: badgeUrl }}
                  style={{ width: 56, height: 56, marginTop: 12 }}
                  resizeMode="contain"
                />
              ) : null}
            </View>

            {/* Rewards List */}
            <View style={{ padding: 20 }}>
              <Text style={{
                fontSize: 15, fontWeight: '800', color: '#000', marginBottom: 12,
              }}>
                🎁 {rank.name} Rewards
              </Text>
              {rewards.map((r, idx) => (
                <View
                  key={idx}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 10, borderBottomWidth: idx < rewards.length - 1 ? 1 : 0,
                    borderBottomColor: '#f0f0f0',
                  }}
                >
                  {r.url && /^https?:\/\//i.test(r.url) ? (
                    <Image
                      source={{ uri: r.url }}
                      style={{ width: 40, height: 40, marginRight: 12 }}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={{ fontSize: 28, marginRight: 12 }}>{r.icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#000' }}>
                      {r.label}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#888' }}>
                      Permanent • Auto-granted on rank up
                    </Text>
                  </View>
                  {isUnlocked ? (
                    <Feather name="check-circle" size={20} color="#4CAF50" />
                  ) : (
                    <Feather name="lock" size={18} color="#ccc" />
                  )}
                </View>
              ))}

              {/* CTA */}
              {!isUnlocked && (
                <View style={{
                  backgroundColor: '#FFF8E1', borderRadius: 14, padding: 14, marginTop: 16,
                  borderWidth: 1, borderColor: '#FFE0B2',
                }}>
                  <Text style={{
                    fontSize: 13, color: '#E65100', textAlign: 'center', lineHeight: 20,
                  }}>
                    Send <Text style={{ fontWeight: '800' }}>👑{formatXP(xpNeeded)}</Text> more in gifts{'\n'}to unlock {rank.name}
                  </Text>
                </View>
              )}
              {isUnlocked && (
                <View style={{
                  backgroundColor: '#E8F5E9', borderRadius: 14, padding: 14, marginTop: 16,
                  borderWidth: 1, borderColor: '#A5D6A7',
                }}>
                  <Text style={{
                    fontSize: 13, color: '#2E7D32', textAlign: 'center', fontWeight: '700',
                  }}>
                    ✅ You've unlocked {rank.name}!
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
