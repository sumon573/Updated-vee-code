import React from 'react';
import { View, Text, Pressable, Modal, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { SpeakingRipple } from '@/src/features/voice-room/components/Avatar';
import { NOBLE_RANKS, PRIVILEGES, formatXP } from '@/src/services/nobleService';
import { rewardsForRankKey } from '@/src/services/nobleRewardsCatalog';

const { width } = Dimensions.get('window');

// Generic privilege icons — same VPS art set as NobelScreen's PRIV_ART
// (duplicated here to avoid a circular import with NobelScreen).
const NOBEL_ART_BASE = 'https://vee-club.duckdns.org/nobel-art';
const artUri = (f: string) => ({ uri: `${NOBEL_ART_BASE}/${f}` });
const PRIV_ART: Record<string, any> = {
  nameplate: artUri('priv-nameplate.png'),
  badge: artUri('priv-badge.png'),
  gift: artUri('priv-gift.png'),
  avatarFrame: artUri('priv-frame.png'),
  entryEffects: artUri('priv-entry.png'),
  seatPriority: artUri('priv-seat.png'),
  upgradeBanner: artUri('priv-banner.png'),
  micRipple: artUri('priv-ripple.png'),
  homepageSkin: artUri('priv-skin.png'),
};

type Props = {
  visible: boolean;
  onClose: () => void;
  rewardKey: string;
  rankIndex: number;
  userName: string;
  userPhotoURL?: string;
  locked: boolean;
  unlockXP: number;
};

function DP({ photoURL, name, size }: { photoURL?: string; name: string; size: number }) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }
  const initial = (name || 'V').trim().charAt(0).toUpperCase() || 'V';
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: '#7E57C2', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: '#fff' }}>{initial}</Text>
    </View>
  );
}

export default function RewardPreview({
  visible, onClose, rewardKey, rankIndex, userName, userPhotoURL, locked, unlockXP,
}: Props) {
  const rank = NOBLE_RANKS[rankIndex] || NOBLE_RANKS[0];
  const def = PRIVILEGES.find((p) => p.key === rewardKey);
  const cat = rewardsForRankKey(rank.key);
  const title = def ? def.name : rewardKey;
  const cardW = Math.min(width - 48, 420);

  let body: React.ReactNode = null;

  if (rewardKey === 'nameplate' && cat?.nameplate) {
    const np = cat.nameplate as any;
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <DP photoURL={userPhotoURL} name={userName} size={56} />
          <View style={{ marginLeft: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#000' }} numberOfLines={1}>
              {userName}
            </Text>
            <View style={{ marginTop: 6 }}>
              {np.designUrl ? (
                <Image
                  source={{ uri: np.designUrl }}
                  style={{ width: 100, height: 20 }}
                  contentFit="contain"
                />
              ) : (
                <View
                  style={{
                    height: 20, borderRadius: 10, paddingHorizontal: 8,
                    backgroundColor: rank.color, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>
                    {rank.name.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 16, textAlign: 'center' }}>
          How your nameplate looks on your profile
        </Text>
      </View>
    );
  } else if (rewardKey === 'badge') {
    const url = (cat?.badge as any)?.designUrl;
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Image
          source={url ? { uri: url } : PRIV_ART.badge}
          style={{ width: 150, height: 150 }}
          contentFit="contain"
        />
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 12, textAlign: 'center' }}>
          Your {rank.name} badge, as it appears on Honor and your profile
        </Text>
      </View>
    );
  } else if (rewardKey === 'avatarFrame') {
    const url = (cat?.frame as any)?.designUrl;
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <View style={{ width: 170, height: 170, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
            <DP photoURL={userPhotoURL} name={userName} size={88} />
          </View>
          <Image
            source={url ? { uri: url } : PRIV_ART.avatarFrame}
            style={{ width: 110, height: 110 }}
            contentFit="contain"
          />
        </View>
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 8, textAlign: 'center' }}>
          Your DP with the {rank.name} frame, as it appears on seats and your profile
        </Text>
      </View>
    );
  } else if (rewardKey === 'micRipple') {
    const colors = (cat?.ripple as any)?.config?.colors as string[] | undefined;
    const rippleSize = 110;
    const area = rippleSize * 2.7;
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 8 }}>
        <View style={{ width: area, height: area, alignItems: 'center', justifyContent: 'center' }}>
          <SpeakingRipple
            size={rippleSize}
            visible={visible}
            nobleRankIndex={rankIndex}
            rippleColors={colors}
          />
          <DP photoURL={userPhotoURL} name={userName} size={rippleSize} />
        </View>
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 4, textAlign: 'center' }}>
          Your speaking ripple, live while you talk on a seat
        </Text>
      </View>
    );
  } else if (rewardKey === 'entryEffects') {
    const url = (cat?.entryEffect as any)?.designUrl;
    const bannerW = cardW - 48;
    const isViscount = rank.key === 'viscount';
    const isCount = rank.key === 'count';
    const bannerH = isViscount ? (bannerW * 826) / 1903 : isCount ? (bannerW * 586) / 1922 : (bannerW * 533) / 1600;
    const dpSize = isViscount ? bannerW * 0.1923 : isCount ? bannerW * 0.1717 : bannerW * 0.127;
    const dpLeft = isViscount ? bannerW * 0.0799 : isCount ? bannerW * 0.1009 : bannerW * 0.1788;
    const dpTop = isViscount ? bannerH * 0.2723 : isCount ? bannerH * 0.1792 : bannerH * 0.295;
    const nameLeft = isViscount ? bannerW * 0.3153 : isCount ? bannerW * 0.330 : bannerW * 0.372;
    const nameTop = isViscount ? bannerH * 0.35 : isCount ? bannerH * 0.324 : bannerH * 0.36;
    const nameFont = bannerW * 0.042;
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        {url ? (
          <View style={{ width: bannerW, height: bannerH }}>
            <Image source={{ uri: url }} style={{ width: bannerW, height: bannerH }} contentFit="contain" />
            <View style={{ position: 'absolute', left: dpLeft, top: dpTop }}>
              <DP photoURL={userPhotoURL} name={userName} size={dpSize} />
            </View>
            <View style={{ position: 'absolute', left: nameLeft, top: nameTop, width: bannerW * 0.305 }}>
              <Text
                style={{
                  color: '#FFD94D', fontSize: nameFont, lineHeight: nameFont * 1.05,
                  fontWeight: '800', fontFamily: 'serif',
                  textShadowColor: 'rgba(30,10,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {userName}
              </Text>
              <Text
                style={{
                  color: '#FFFFFF', fontSize: bannerW * 0.03, lineHeight: bannerW * 0.03 * 1.1,
                  fontWeight: '700', fontFamily: 'serif',
                  textShadowColor: 'rgba(30,10,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
                  marginTop: isCount ? bannerH * 0.06 : 4,
                }}
                numberOfLines={1}
              >
                is coming...
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4F5F5', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
            <DP photoURL={userPhotoURL} name={userName} size={32} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#212121', marginLeft: 8 }}>
              {userName} is coming
            </Text>
          </View>
        )}
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 12, textAlign: 'center' }}>
          Your {rank.name} entry, as it appears when you join a room
        </Text>
      </View>
    );
  } else if (rewardKey === 'gift') {
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Image source={PRIV_ART.gift} style={{ width: 150, height: 150 }} contentFit="contain" />
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 12, textAlign: 'center' }}>
          The {rank.name} gift, as it appears when sent in a room
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 16 }}>
        <Image
          source={PRIV_ART[rewardKey] || PRIV_ART.gift}
          style={{ width: 100, height: 100 }}
          contentFit="contain"
        />
        <Text style={{ fontSize: 13, color: '#7F8C8D', marginTop: 12, textAlign: 'center' }}>
          This privilege activates when it ships.
        </Text>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{ width: cardW, backgroundColor: '#fff', borderRadius: 20, padding: 20, maxHeight: '82%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: '#000', flex: 1 }} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={24} color="#000" />
            </Pressable>
          </View>
          <Text style={{ fontSize: 13, color: '#7F8C8D', marginBottom: 4 }}>
            {rank.name} · preview on your DP / profile
          </Text>
          {body}
          {locked && (
            <View style={{ backgroundColor: '#FFF8E6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#B8860B', textAlign: 'center' }}>
                🔒 Unlocks at {formatXP(unlockXP)} XP — preview of how it will look
              </Text>
            </View>
          )}
          <Pressable
            onPress={onClose}
            style={{ backgroundColor: '#007AFF', borderRadius: 12, paddingVertical: 12, marginTop: 16, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#fff' }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
