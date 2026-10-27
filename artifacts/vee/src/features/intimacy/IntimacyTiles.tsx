/**
 * IntimacyTiles.tsx — shared Intimacy tile/row components (2026-10-26).
 *
 * Used by the profile Intimacy card (app/profile/index.tsx) and the
 * Intimacy detail page (app/profile/intimacy.tsx) so both surfaces render
 * the same tiles. Every tile/row here is pressable only when an onPress
 * is supplied; the profile card and detail rows pass real navigation.
 * No demo names or photos: a missing photo renders the peer's initial,
 * or a neutral person icon when no name is known. Remote photos use
 * expo-image (never RN Image).
 */

import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const C = {
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  pinkTile: '#FFF5F7',
  pinkBorder: '#F472B6',
  pink: '#EC4899',
  red: '#F43F5E',
} as const;

/** 72dp photo box inside an 80dp tile, with an initial/icon fallback. */
function PhotoBox({ photoURL, name }: { photoURL: string | null; name: string }) {
  const initial = name ? name.trim()[0]?.toUpperCase() : '';
  return (
    <View
      style={{
        width: 72, height: 72, borderRadius: 16, backgroundColor: C.tile,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      {photoURL ? (
        <Image source={{ uri: photoURL }} style={{ width: 72, height: 72 }} contentFit="cover" />
      ) : initial ? (
        <Text style={{ fontSize: 28, fontWeight: '800', color: '#0A7CC2' }}>{initial}</Text>
      ) : (
        <Feather name="user" size={30} color={C.muted} />
      )}
    </View>
  );
}

/** Blue gradient Lv pill overlapping the bottom of a tile (preview-exact). */
export function BlueLvPill({ label }: { label: string }) {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: -9, alignItems: 'center' }}>
      <LinearGradient
        colors={['#4FC3F7', '#1E88E5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999,
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
          elevation: 2,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>{label}</Text>
      </LinearGradient>
    </View>
  );
}

/** Solid red Lv pill (couple-track level on friend rows). */
export function RedLvPill({ label }: { label: string }) {
  return (
    <View
      style={{
        backgroundColor: C.red, paddingHorizontal: 8, paddingVertical: 2,
        borderRadius: 999, alignSelf: 'flex-start',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>{label}</Text>
    </View>
  );
}

/**
 * Couple tile (always first in the row): partner photo when coupled, else
 * a light-pink tile with a pink-outlined circle + plus. Label "Couple".
 */
export function CoupleTile({
  coupled, partnerPhotoURL, partnerName, onPress,
}: {
  coupled: boolean;
  partnerPhotoURL: string | null;
  partnerName: string;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const body = (
    <View style={{ width: 80, padding: 4, alignItems: 'center' }}>
      {coupled ? (
        <PhotoBox photoURL={partnerPhotoURL} name={partnerName} />
      ) : (
        <View
          style={{
            width: 72, height: 72, borderRadius: 16, backgroundColor: C.pinkTile,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 56, height: 56, borderRadius: 28, borderWidth: 2,
              borderColor: C.pinkBorder, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 30, fontWeight: '300', color: C.pink, lineHeight: 34 }}>+</Text>
          </View>
        </View>
      )}
      <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }} numberOfLines={1}>
        {t('profile.intimacyCouple', { defaultValue: 'Couple' })}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

/**
 * Friend tile: 72dp photo in an 80dp tile, blue Lv pill overlapping the
 * tile bottom, label "Friend". levelLabel null = no pill (a friend with
 * neither a pair level nor a user level record) — the label then sits
 * tight under the photo like the Couple tile's.
 */
export function IntimacyFriendTile({
  photoURL, name, levelLabel, onPress,
}: {
  photoURL: string | null;
  name: string;
  levelLabel: string | null;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const body = (
    <View style={{ width: 80, padding: 4, alignItems: 'center' }}>
      <View style={{ position: 'relative' }}>
        <PhotoBox photoURL={photoURL} name={name} />
        {levelLabel ? <BlueLvPill label={levelLabel} /> : null}
      </View>
      <Text style={{ fontSize: 12, color: C.muted, marginTop: levelLabel ? 14 : 4 }} numberOfLines={1}>
        {t('profile.intimacyFriend', { defaultValue: 'Friend' })}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

/**
 * Empty friend slot (2026-10-27, boss correction): the Friend tiles
 * start EMPTY like the Couple (+) slot — a light-pink tile with a
 * pink-outlined circle + plus, label "Friend". Rendered only for the
 * viewer's own card, up to MAX_FRIENDS slots total (friends + slots).
 */
export function FriendPlusTile({ onPress }: { onPress?: () => void }) {
  const { t } = useTranslation();
  const body = (
    <View style={{ width: 80, padding: 4, alignItems: 'center' }}>
      <View
        style={{
          width: 72, height: 72, borderRadius: 16, backgroundColor: C.pinkTile,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 56, height: 56, borderRadius: 28, borderWidth: 2,
            borderColor: C.pinkBorder, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 30, fontWeight: '300', color: C.pink, lineHeight: 34 }}>+</Text>
        </View>
      </View>
      <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }} numberOfLines={1}>
        {t('profile.intimacyFriend', { defaultValue: 'Friend' })}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

/** Circular photo (40dp) with initial/icon fallback, for list rows. */
export function RowPhoto({ photoURL, name, size = 44 }: { photoURL: string | null; name: string; size?: number }) {
  const initial = name ? name.trim()[0]?.toUpperCase() : '';
  if (photoURL) {
    return <Image source={{ uri: photoURL }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: C.tile,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {initial ? (
        <Text style={{ fontSize: size * 0.42, fontWeight: '800', color: '#0A7CC2' }}>{initial}</Text>
      ) : (
        <Feather name="user" size={size * 0.45} color={C.muted} />
      )}
    </View>
  );
}

/**
 * Friend list row (detail Friend tab): circular photo + name + red Lv pill
 * (couple-track level for this pair) + blue Lv pill (the friend's own user
 * total level, rendered only when supplied) + hearts points text.
 * No send buttons on this tab — the row only navigates to the profile.
 */
export function FriendRow({
  photoURL, name, redLabel, blueLabel, pointsText, onPress,
}: {
  photoURL: string | null;
  name: string;
  redLabel: string;
  blueLabel: string | null;
  pointsText: string;
  onPress?: () => void;
}) {
  const body = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
        borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
      }}
    >
      <RowPhoto photoURL={photoURL} name={name} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 }}>
          <RedLvPill label={redLabel} />
          {blueLabel ? (
            <View
              style={{
                backgroundColor: '#1E88E5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>{blueLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={{ fontSize: 13, color: C.muted, marginLeft: 8 }} numberOfLines={1}>
        {pointsText}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}
