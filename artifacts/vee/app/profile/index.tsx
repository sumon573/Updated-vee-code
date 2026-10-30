/**
 * Profile — IMO-style (light mode)
 * Exact IMO layout: avatar, badges, sections, Edit button
 * 2026-10-20 (boss, option A): profile cover photo REMOVED entirely —
 * clean IMO-style header, no cover banner anywhere on the profile.
 * All data real from Firebase; all buttons functional
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Alert, Modal, Pressable, FlatList, Animated } from 'react-native';
import { Image } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import MistNameplate from '@/src/components/MistNameplate';
import { getActiveCatalog, resolveGrantedArt } from '@/src/services/nobleRewardsCatalog';
import { subscribeLevel, getLevelFromXP } from '@/src/services/levelService';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, getUser, VeeUser } from '@/src/services/userService';
import { uploadProfilePhoto, uploadCoverPhoto, deleteCloudinaryAsset } from '@/src/services/cloudinaryService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import { subscribeBadges, subscribeFrames, subscribeNameplates, type GrantedFrame, type GrantedNameplate } from '@/src/services/badgeService';
import { hasOfficialBadge, getOfficialBadgeIconUrl } from '@/src/services/verifiedService';
import { GrantedBadge } from '@/src/data/honor';
import { subscribeFollowCounts, followUser, unfollowUser, subscribeIsFollowing } from '@/src/services/followService';
import { subscribeVisitors, recordVisit, countUnseenListed, countListed } from '@/src/services/visitorService';
import {
  sendFriendRequest, cancelFriendRequest, acceptFriendRequest, rejectFriendRequest,
  subscribeFriendStatus, FriendStatus } from '@/src/services/friendRequestService';
import { buildChatId } from '@/src/features/chat/services/firebaseDmService';
import {
  unblockUser, getBlockDirection,
  subscribeBlockedUsers, BlockDirection } from '@/src/services/blockService';
import { subscribeMyRoomsCombined } from '@/src/features/voice-room/services/firebaseRoomService';
import { usePrivateRoomGate } from '@/src/components/PrivateRoomGate';
import AnimatedFrame from '@/src/components/AnimatedFrame';
import { subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import { subscribeNoble, NOBLE_RANKS, type NobleState , checkNobleMaintenance } from '@/src/services/nobleService';
import {
  subscribeMyIntimacies, fetchPeerProfile, intimacyLevelFor,
  type IntimacyEntry } from '@/src/features/voice-room/services/intimacyService';
import {
  subscribeCoupleState, type CoupleState } from '@/src/features/intimacy/coupleLevels';
import {
  subscribeUserFriends, MAX_FRIENDS,
  type FriendEntry } from '@/src/features/intimacy/friendService';
import {
  CoupleTile, IntimacyFriendTile, FriendPlusTile } from '@/src/features/intimacy/IntimacyTiles';
import { useTranslation } from 'react-i18next';

// Gift emojis — canonical catalog, matches api-server GIFT_CATALOG + GiftsModal
const GIFTS: Record<string, string> = {
  '1': '💝', '2': '🌹', '3': '🎁', '4': '💎',
  '5': '🏆', '6': '🚀', '7': '👑', '8': '🎆' };

// Gift diamond prices (for ranking "big gifts" in the 1-line preview)
const GIFT_RANK_PRICE: Record<string, number> = {
  '1': 10, '2': 25, '3': 50, '4': 100,
  '5': 200, '6': 500, '7': 1000, '8': 2000,
  // 2026-10-18 (Sumon): canonical string IDs (for legacy-resolved counts)
  'heart': 1, 'pink-rose': 50, 'winter-dream': 100, 'golden-crown': 10,
  'blossom-dream': 500, 'dream-rider': 2000, 'kiss': 1,
  'rose-heart': 100, 'crystal-palace': 600, 'sakura-falls': 700,
  'cloud-temple': 1000, 'fairy-princess': 1200, 'emerald-garden': 1500,
  'wedding-kiss': 2500, 'first-dance': 3000, 'blind-love': 4000,
  'pink-love': 500, 'vee-brand-castle': 1000, 'vee-dream-castle': 5000 };

/**
 * 2026-10-18 (Sumon): PERMANENT legacy gift ID mapping.
 * Old numeric gift IDs (1-8) automatically resolve to new string IDs.
 * Works for ALL users (current + future) — no data migration ever needed.
 */
const LEGACY_GIFT_ID_MAP: Record<string, string> = {
  '1': 'heart', '2': 'pink-rose', '3': 'pink-rose', '4': 'winter-dream',
  '5': 'golden-crown', '6': 'blossom-dream', '7': 'golden-crown', '8': 'dream-rider',
};
/** Resolve a gift ID through the legacy map to its canonical string ID. */
function resolveGiftId(giftId: string): string {
  return LEGACY_GIFT_ID_MAP[giftId] || giftId;
}

// IMO BIUI light tokens (2026-10-19, Me-tab spec): bg #f4f5f5, white cards,
// primary text #25292d, secondary #788187. Boss button standard #E3F2FD/#007AFF kept.
const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  mutedLight: '#C7C7CC',
  border: '#F0F1F2',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  green: '#34C759',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  goldText: '#B8860B' } as const;

// ─── Card Header (IMO Me-tab: 16sp semibold title, count + chevron right) ───

function SectionHeader({ title, count, onPress }: { title: string; count?: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingTop: 6, paddingBottom: 6 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {count !== undefined && (
          <Text style={{ fontSize: 14, color: C.muted, marginRight: 4 }}>{count}</Text>
        )}
        <Feather name="chevron-right" size={18} color={C.mutedLight} />
      </View>
    </Pressable>
  );
}


// 2026-10-27 (boss, flat imo profile): sections flow flat on the page bg —
// no white cards, no side margins, no radius.
// 2026-10-29 (boss, tight profile): inter-section rhythm compressed to a
// uniform 11dp (SectionHeader paddingTop 6 + previous section paddingBottom 5),
// matching the tightened preview's 28px gaps at ~2.56px/dp. Intra-section
// title->content gaps are untouched.
const flatSectionStyle = { paddingBottom: 5 } as const;

// ─── Badge Pill (IMO style) ───

// ─── Premium Level Badge (2026-10-12, Sumon concept) ───
// Tiers: 1-30 Bronze, 31-60 Silver, 61-99 Gold, 100 Max.
// Each tier has its own premium gradient; the level NUMBER shows inside.
// Subtle drifting mist particles (winter-fog style) for the premium feel.
// Level grows SLOWLY from diamond sending + voice-room activity.

export type LevelTier = 'bronze' | 'silver' | 'gold' | 'max';

export function getLevelTier(level: number): LevelTier {
  if (level >= 49) return 'max';
  if (level >= 33) return 'gold';
  if (level >= 17) return 'silver';
  return 'bronze';
}

/** Get level within tier (1-16) from total level */
export function getLevelInTier(totalLevel: number): number {
  if (totalLevel >= 49) return 0; // Max
  if (totalLevel >= 33) return totalLevel - 32;
  if (totalLevel >= 17) return totalLevel - 16;
  return totalLevel;
}

const TIER_STYLE: Record<LevelTier, { colors: [string, string, string]; label: string; glow: string }> = {
  bronze: {
    colors: ['#8C6239', '#CD7F32', '#F0B46A'],
    label: 'Bronze',
    glow: 'rgba(205,127,50,0.35)' },
  silver: {
    colors: ['#7E8FA0', '#B8C6D4', '#EDF2F7'],
    label: 'Silver',
    glow: 'rgba(184,198,212,0.4)' },
  gold: {
    colors: ['#9A6B0F', '#E8B91A', '#FFE873'],
    label: 'Gold',
    glow: 'rgba(232,185,26,0.45)' },
  max: {
    colors: ['#5B1A9E', '#9D4EDD', '#FFD700'],
    label: 'Max',
    glow: 'rgba(157,78,221,0.5)' } };


// 2026-10-16 (Sumon): Animated level badges — Bronze static, Silver shimmer,
// Gold sparkle, Max PREMIUM dazzling. Animation ONLY inside the 100x20 box.
function ShimmerOverlay({ speed = 2500, opacity = 0.6 }: { speed?: number; opacity?: number }) {
  const shimmer = useRef(new Animated.Value(-1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, { toValue: 2, duration: speed, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [speed, shimmer]);
  return (
    <Animated.View
      style={{
        position: 'absolute', top: 0, bottom: 0, width: 40,
        backgroundColor: '#FFFFFF', opacity,
        transform: [{ translateX: shimmer.interpolate({ inputRange: [-1, 2], outputRange: [-60, 140] }) },
          { skewX: '-20deg' }],
      }}
    />
  );
}

function Sparkle({ delay, left, top, size = 4, color = '#FFFFFF' }:
  { delay: number; left: number; top: number; size?: number; color?: string }) {
  const twinkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(twinkle, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(twinkle, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, twinkle]);
  return (
    <Animated.View
      style={{
        position: 'absolute', left, top, width: size, height: size,
        borderRadius: size / 2, backgroundColor: color,
        opacity: twinkle.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
        transform: [{ scale: twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }],
        shadowColor: color, shadowOpacity: 0.8, shadowRadius: 4,
      }}
    />
  );
}

export function LevelBadge({ level }: { level: number }) {
  const tier = getLevelTier(level);
  const levelInTier = getLevelInTier(level);
  const style = TIER_STYLE[tier];
  // Level pill redesign (2026-10-30, boss spec 21:47): SMALL COMPACT pill —
  // hug content everywhere (no fixed width), NO tier name text, rank by COLOR
  // only + medal icon + "Lv.<number>". Sparkles/shimmer are MAX-ONLY; lower
  // tiers are static gradients. Level computation untouched: bronze/silver/
  // gold show the in-tier number as before. 2026-10-30 01:39 (boss order):
  // max shows "Lv Max" again (previous rule) — NOT the total level.
  const displayText = tier === 'max' ? 'Lv Max' : `Lv.${levelInTier}`;
  return (
    <View style={{ marginRight: 6 }}>
      <LinearGradient
        colors={style.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height: 20, borderRadius: 10, paddingHorizontal: 8,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden' }}
      >
        {tier === 'max' && (
          <>
            <ShimmerOverlay speed={900} opacity={0.8} />
            <Sparkle delay={0} left={15} top={3} size={5} color="#FFD700" />
            <Sparkle delay={300} left={55} top={12} size={4} color="#FFFFFF" />
            <Sparkle delay={600} left={80} top={5} size={5} color="#FFD700" />
            <Sparkle delay={200} left={35} top={10} size={3} color="#FFE873" />
            <Sparkle delay={700} left={65} top={4} size={4} color="#FFD700" />
          </>
        )}
        <Feather name="award" size={12} color="#FFFFFF" style={{ marginRight: 3, zIndex: 1 }} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF', zIndex: 1 }} numberOfLines={1}>
          {displayText}
        </Text>
      </LinearGradient>
    </View>
  );
}

function BadgePill({ label, icon }: { label: string; icon?: string }) {
  return (
    <View style={{
      backgroundColor: C.card, borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, marginBottom: 6,
      flexDirection: 'row', alignItems: 'center' }}>
      {icon && <Text style={{ fontSize: 12, marginRight: 4 }}>{icon}</Text>}
      <Text style={{ fontSize: 12, color: C.muted, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

// 2026-10-15 (Sumon): Nobel rank helpers — the profile pill must show the
// ACTUAL rank (name + sub-level like "Knight I") in the rank's own color.
// Previously the pill was hardcoded purple and never changed on upgrade.
const NOBLE_ROMAN = ['I', 'II', 'III'] as const;
function nobleSubLevel(xp: number, rankIdx: number): number {
  const r = NOBLE_RANKS[rankIdx];
  if (!r) return 1;
  const span = r.maxXP - r.minXP;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.min(3, Math.floor(((xp - r.minXP) / span) * 3) + 1);
}
/** Lighten a hex color — second stop of the pill gradient. */
function lightenHex(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// 2026-10-16 (Sumon): compact count so the fixed 100px pill never overflows.
function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 1000) return `${parseFloat((n / 1000).toFixed(1))}k`;
  return `${n}`;
}

// 2026-10-12 (Sumon): Premium gradient pills for Nobel & Follower —
// gorgeous, premium look. Same size as LevelBadge.
function PremiumPill({ label, icon, colors, width = 100 }: { label: string; icon?: string; colors: [string, string]; width?: number }) {
  // 2026-10-16 (Sumon): FIXED 100x20 — same uniform size as the Nobel nameplate.
  return (
    <View style={{ marginRight: 6 }}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width, height: 20, borderRadius: 10,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
      >
        {icon && <Text style={{ fontSize: 10, marginRight: 3 }}>{icon}</Text>}
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF' }} numberOfLines={1}>{label}</Text>
      </LinearGradient>
    </View>
  );
}


// ─── 2026-10-29 (boss, profile mirror): shared profile helpers ───
// Age is ALWAYS calculated from the birthday, never typed (boss 20:01).
// Apr 12, 2004 -> 22 in Oct 2026 proves the rule.
export function calcAge(birthday: string | undefined | null): number | null {
  if (!birthday || typeof birthday !== 'string') return null;
  const m = birthday.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

/** Gender symbol for the profile age chip (imo: "♂ 22"). Unknown -> ''. */
export function genderSymbol(gender: string | undefined | null): string {
  if (!gender) return '';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm' || g === '♂') return '♂';
  if (g === 'female' || g === 'f' || g === '♀') return '♀';
  return '';
}

// Country name (or 2-letter code) -> ISO flag code. Unknown -> null (globe).
// Covers EVERY name in the Country/Region picker (app/profile/countries.ts)
// verbatim, so any owner's stored country resolves to its own flag disc;
// only a truly missing/unknown stored country falls back to the globe.
const COUNTRY_TO_CODE: Record<string, string> = {
  afghanistan: 'af', 'aland islands': 'ax', albania: 'al', algeria: 'dz',
  'american samoa': 'as', andorra: 'ad', angola: 'ao', anguilla: 'ai',
  antarctica: 'aq', 'antigua & barbuda': 'ag', argentina: 'ar', armenia: 'am',
  aruba: 'aw', australia: 'au', austria: 'at', azerbaijan: 'az',
  bahamas: 'bs', bahrain: 'bh', bangladesh: 'bd', barbados: 'bb',
  belarus: 'by', belgium: 'be', belize: 'bz', benin: 'bj', bermuda: 'bm',
  bhutan: 'bt', bolivia: 'bo', 'bosnia & herzegovina': 'ba', botswana: 'bw',
  'bouvet island': 'bv', brazil: 'br', 'british indian ocean territory': 'io',
  'british virgin islands': 'vg', brunei: 'bn', bulgaria: 'bg',
  'burkina faso': 'bf', burundi: 'bi', cambodia: 'kh', cameroon: 'cm',
  canada: 'ca', 'cape verde': 'cv', 'cayman islands': 'ky',
  'central african republic': 'cf', chad: 'td', chile: 'cl', china: 'cn',
  'christmas island': 'cx', 'cocos (keeling) islands': 'cc', colombia: 'co',
  comoros: 'km', congo: 'cg', 'congo (drc)': 'cd', 'cook islands': 'ck',
  'costa rica': 'cr', croatia: 'hr', cuba: 'cu', 'curaçao': 'cw',
  cyprus: 'cy', 'czech republic': 'cz', denmark: 'dk', djibouti: 'dj',
  dominica: 'dm', 'dominican republic': 'do', ecuador: 'ec', egypt: 'eg',
  'el salvador': 'sv', 'equatorial guinea': 'gq', eritrea: 'er',
  estonia: 'ee', eswatini: 'sz', ethiopia: 'et', 'falkland islands': 'fk',
  'faroe islands': 'fo', fiji: 'fj', finland: 'fi', france: 'fr',
  'french guiana': 'gf', 'french polynesia': 'pf',
  'french southern territories': 'tf', gabon: 'ga', gambia: 'gm',
  georgia: 'ge', germany: 'de', ghana: 'gh', gibraltar: 'gi',
  greece: 'gr', greenland: 'gl', grenada: 'gd', guadeloupe: 'gp',
  guam: 'gu', guatemala: 'gt', guernsey: 'gg', guinea: 'gn',
  'guinea-bissau': 'gw', guyana: 'gy', haiti: 'ht', honduras: 'hn',
  'hong kong': 'hk', hungary: 'hu', iceland: 'is', india: 'in',
  indonesia: 'id', iran: 'ir', iraq: 'iq', ireland: 'ie',
  'isle of man': 'im', israel: 'il', italy: 'it', 'ivory coast': 'ci',
  jamaica: 'jm', japan: 'jp', jersey: 'je', jordan: 'jo',
  kazakhstan: 'kz', kenya: 'ke', kiribati: 'ki', kosovo: 'xk',
  kuwait: 'kw', kyrgyzstan: 'kg', laos: 'la', latvia: 'lv',
  lebanon: 'lb', lesotho: 'ls', liberia: 'lr', libya: 'ly',
  liechtenstein: 'li', lithuania: 'lt', luxembourg: 'lu', macao: 'mo',
  madagascar: 'mg', malawi: 'mw', malaysia: 'my', maldives: 'mv',
  mali: 'ml', malta: 'mt', 'marshall islands': 'mh', martinique: 'mq',
  mauritania: 'mr', mauritius: 'mu', mayotte: 'yt', mexico: 'mx',
  micronesia: 'fm', moldova: 'md', monaco: 'mc', mongolia: 'mn',
  montenegro: 'me', montserrat: 'ms', morocco: 'ma', mozambique: 'mz',
  myanmar: 'mm', namibia: 'na', nauru: 'nr', nepal: 'np',
  netherlands: 'nl', 'new caledonia': 'nc', 'new zealand': 'nz',
  nicaragua: 'ni', niger: 'ne', nigeria: 'ng', niue: 'nu',
  'norfolk island': 'nf', 'north korea': 'kp', 'north macedonia': 'mk',
  'northern mariana islands': 'mp', norway: 'no', oman: 'om',
  pakistan: 'pk', palau: 'pw', palestine: 'ps', panama: 'pa',
  'papua new guinea': 'pg', paraguay: 'py', peru: 'pe',
  philippines: 'ph', 'pitcairn islands': 'pn', poland: 'pl',
  portugal: 'pt', 'puerto rico': 'pr', qatar: 'qa', 'réunion': 're',
  romania: 'ro', russia: 'ru', rwanda: 'rw', 'saint barthélemy': 'bl',
  'saint helena': 'sh', 'saint kitts & nevis': 'kn', 'saint lucia': 'lc',
  'saint martin': 'mf', 'saint vincent & the grenadines': 'vc',
  samoa: 'ws', 'san marino': 'sm', 'são tomé & príncipe': 'st',
  'saudi arabia': 'sa', senegal: 'sn', serbia: 'rs', seychelles: 'sc',
  'sierra leone': 'sl', singapore: 'sg', 'sint maarten': 'sx',
  slovakia: 'sk', slovenia: 'si', 'solomon islands': 'sb', somalia: 'so',
  'south africa': 'za', 'south georgia & the south sandwich islands': 'gs',
  'south korea': 'kr', 'south sudan': 'ss', spain: 'es',
  'sri lanka': 'lk', sudan: 'sd', suriname: 'sr',
  'svalbard & jan mayen': 'sj', sweden: 'se', switzerland: 'ch',
  syria: 'sy', taiwan: 'tw', tajikistan: 'tj', tanzania: 'tz',
  thailand: 'th', 'timor-leste': 'tl', togo: 'tg', tokelau: 'tk',
  tonga: 'to', 'trinidad & tobago': 'tt', tunisia: 'tn',
  turkey: 'tr', turkmenistan: 'tm', 'turks & caicos islands': 'tc',
  tuvalu: 'tv', uganda: 'ug', ukraine: 'ua',
  'united arab emirates': 'ae', 'united kingdom': 'gb',
  'united states': 'us', 'us minor outlying islands': 'um',
  uruguay: 'uy', uzbekistan: 'uz', vanuatu: 'vu', 'vatican city': 'va',
  venezuela: 've', vietnam: 'vn', 'virgin islands (us)': 'vi',
  'wallis & futuna': 'wf', 'western sahara': 'eh', yemen: 'ye',
  zambia: 'zm', zimbabwe: 'zw',
  // Common aliases (kept from the original map).
  usa: 'us', america: 'us', uk: 'gb', england: 'gb', uae: 'ae',
  korea: 'kr', czechia: 'cz', macedonia: 'mk', vatican: 'va',
  swaziland: 'sz', "cote d'ivoire": 'ci',
};
export function countryToFlagCode(value: string | undefined | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toLowerCase();
  return COUNTRY_TO_CODE[v.toLowerCase()] ?? null;
}
export function flagUrl(code: string): string {
  return `https://flagcdn.com/w80/${code}.png`;
}

// Light imo chip (Followers / age / country) — replaces the old gradient pills.
function LightChip({ children, onPress }: { children: any; onPress?: () => void }) {
  const inner = (
    <View style={{
      backgroundColor: C.tile, borderRadius: 11,
      paddingHorizontal: 9, paddingVertical: 4, marginRight: 6,
      flexDirection: 'row', alignItems: 'center' }}>
      {children}
    </View>
  );
  if (onPress) return <Pressable onPress={onPress}>{inner}</Pressable>;
  return inner;
}
// Premium location marker (boss, 2026-10-30): bespoke gradient pin — NOT an
// emoji, NOT a stock pin. Violet→fuchsia gradient head with a white ring and
// white core dot, tapering to a point in the deep violet end: a gem-like
// marker that reads premium on the light chip.
function PremiumLocationIcon() {
  return (
    <View style={{ width: 13, height: 15, marginRight: 4, alignItems: 'center' }}>
      <LinearGradient
        colors={['#C4B5FD', '#8B5CF6', '#D946EF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
      </LinearGradient>
      <View style={{ width: 4, height: 4, backgroundColor: '#8B5CF6', transform: [{ rotate: '45deg' }], marginTop: -2 }} />
    </View>
  );
}

// Small voice waveform (imo count pill, live only) — 4 bars, 2px wide,
// heights 13/10/9/13px at preview scale -> 5/4/4/5dp; FIX #43: shortened to 3/2/2/3dp (imo-like tiny pill equalizer). Animated wave.
function WaveformBars() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const heights = [3, 2, 2, 3];
  const phases: Array<[number, number, number]> = [
    [0.6, 1, 0.6], [1, 0.6, 1], [0.6, 1, 0.6], [1, 0.6, 1],
  ];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 3, height: 3 }}>
      {heights.map((h, i) => (
        <Animated.View
          key={i}
          style={{
            width: 1, height: h, backgroundColor: '#FFFFFF', borderRadius: 0.5,
            marginLeft: i === 0 ? 0 : (i === 2 ? 3 : 2),
            transform: [{ scaleY: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: phases[i] }) }],
          }}
        />
      ))}
    </View>
  );
}

// ─── Voice Room Card (IMO style with live indicator) ───
// 2026-10-29 (boss, refined cards v2): top corner = owner-country flag disc
// (16dp, 1px white ring, soft shadow, exact globe-badge spot) or lock when
// private; bottom-left = role disc (16dp, GOLD owner / BLUE admin / NONE for
// plain members); bottom-right = uniform count pill (person + live count)
// with a SMALL waveform ONLY when the real live count > 0 (never at 0,
// never a demo number). Derived from the approved v2 preview at ~2.56px/dp:
// flag 42px->16dp, badge 40px->16dp, glyph 17x18px->7dp silhouette,
// insets left 15px->6dp / bottom 12px->5dp, pill right 9px->4dp,
// pill bottom 6dp (shared centerline with the badge at 13dp from bottom),
// waveform bars 2px->1dp wide, heights 13/10/9/13px->5/4/4/5dp.
// Roles come from the PROFILE OWNER's role per room (ownerId + userRooms
// role map) — the same reading the boss saw; he corrects if he meant the
// viewer's role. Unknown owner country -> globe, NEVER a fake flag.
function RoomCard({ item, role, ownerCountry, onPress }: {
  item: any;
  role: 'owner' | 'admin' | 'member';
  ownerCountry?: string | null;
  onPress: () => void;
}) {
  const liveCount = item.liveCount ?? item.memberCount ?? 0;
  const flagCode = item.isPublic === false ? null : countryToFlagCode(ownerCountry);
  const roleColor = role === 'owner' ? '#FCB01A' : '#599DF9';
  return (
    <Pressable onPress={onPress} style={{ width: 80, padding: 4, alignItems: 'center' }}>
      <View style={{ width: 72, height: 72, borderRadius: 16, overflow: 'hidden', backgroundColor: C.card }}>
        {item.coverImageUrl ? (
          <Image source={{ uri: item.coverImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8E8ED' }}>
            <Text style={{ fontSize: 36 }}>🎙️</Text>
          </View>
        )}
        {/* Top corner: flag disc (public + known country) else globe/lock badge */}
        {item.isPublic === false ? (
          <View style={{
            position: 'absolute', top: 6, right: 6,
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
            padding: 4 }}>
            <Feather name="lock" size={12} color="#F59E0B" />
          </View>
        ) : flagCode ? (
          <View style={{
            position: 'absolute', top: 8, right: 8, width: 16, height: 16,
            borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF',
            backgroundColor: '#E8E8ED',
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
            <Image source={{ uri: flagUrl(flagCode) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
        ) : (
          <View style={{
            position: 'absolute', top: 6, right: 6,
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
            padding: 4 }}>
            <Feather name="globe" size={12} color="#10B981" />
          </View>
        )}
        {/* Bottom-left role disc: GOLD owner / BLUE admin / none for members */}
        {role !== 'member' && (
          <View style={{
            position: 'absolute', left: 6, bottom: 5, width: 16, height: 16,
            borderRadius: 8, backgroundColor: '#FFFFFF',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: roleColor }} />
              <View style={{
                width: 8, height: 4, borderTopLeftRadius: 2, borderTopRightRadius: 2,
                backgroundColor: roleColor, marginTop: 1 }} />
            </View>
          </View>
        )}
        {/* FIX #2/#3: count pill — no person icon, number + waveform only; uniform compact size; >100 shows "100+". */}
        <View style={{
          position: 'absolute', right: 4, bottom: 6,
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 7,
          paddingHorizontal: 6, paddingVertical: 2 }}>
          {liveCount > 0 && <WaveformBars />}
          <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
            {liveCount > 100 ? '100+' : String(liveCount)}
          </Text>
        </View>
      </View>
      <Text style={{ fontSize: 12, color: C.text, marginTop: 6, fontWeight: '600' }} numberOfLines={1}>
        {item.name || 'Room'}
      </Text>
    </Pressable>
  );
}

// ─── Main Component ───

/**
 * Card friend tile (2026-10-27, friendship correction): the blue Lv pill
 * keeps the OLD meaning — the pair's intimacy level when a pair exists —
 * and falls back to the friend's own user total level (Lv Max at 49)
 * when no pair exists; no pill at all when neither record exists.
 */
function CardFriendTile({ friendUid, peer, pairValue, onPress }: {
  friendUid: string;
  peer: { name: string; photoURL: string | null } | undefined;
  pairValue: number | undefined;
  onPress?: () => void;
}) {
  const [totalLevel, setTotalLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!friendUid) return;
    return subscribeLevel(friendUid, (l) => setTotalLevel(l.totalLevel));
  }, [friendUid]);
  const pairLabel = pairValue !== undefined ? `Lv.${intimacyLevelFor(pairValue).id}` : null;
  const ownLabel = totalLevel === null
    ? null
    : totalLevel >= 49
      ? 'Lv Max'
      : `Lv.${totalLevel}`;
  const label = pairLabel ?? ownLabel;
  return (
    <IntimacyFriendTile
      photoURL={peer?.photoURL ?? null}
      name={peer?.name || ''}
      levelLabel={label}
      onPress={onPress}
    />
  );
}

export default function ProfileScreen({
  onNavigateToContacts,
  targetUid,
  targetName }: {
  onNavigateToContacts?: () => void;
  /** When set, renders ANOTHER user's profile with the IDENTICAL layout.
   *  Only differences: no settings icon, three-dots shows their vId,
   *  bottom action buttons instead of Edit. */
  targetUid?: string;
  /** Display name passed from the navigation source (e.g. member list).
   *  Used as fallback when the target's DB name is empty — NEVER falls
   *  back to the viewer's own name. */
  targetName?: string;
} = {}) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  // The UID whose profile data we display (own or another user's)
  const displayUid = targetUid ?? user?.uid;
  const isMe = !targetUid || targetUid === user?.uid;

  // 2026-10-16 (Sumon): Enforce 30-day Nobel maintenance on profile load.
  // Inactive users don't keep their rank forever — check on every visit.
  useEffect(() => {
    if (!isMe || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      try {
        await checkNobleMaintenance(user.uid);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [isMe, user?.uid]);
  // 2026-10-30 (boss, visitors bell): record a visit when viewing ANOTHER
  // user's profile (once per profile mount); own profile is never recorded.
  // Write is silent until the profileVisitors rules patch lands (see visitorService).
  useEffect(() => {
    if (isMe || !displayUid || !user?.uid) return;
    void recordVisit(displayUid, user.uid);
  }, [displayUid, isMe, user?.uid]);
  // 2026-10-30 (boss, visitors bell + imo bell design): live bell counts
  // (own profile only; listed 7-day window only, so viewing the list always
  // clears the dot): beside-number = TOTAL listed visitors; green dot iff
  // unseen-listed > 0.
  useEffect(() => {
    if (!isMe || !user?.uid) { setUnseenVisitorCount(0); setListedVisitorTotal(0); return; }
    return subscribeVisitors(user.uid, (map) => {
      setUnseenVisitorCount(countUnseenListed(map));
      setListedVisitorTotal(countListed(map));
    });
  }, [isMe, user?.uid]);
  // 2026-10-30 (boss, visitors bell): gentle bell sway loop (own profile only).
  useEffect(() => {
    if (!isMe) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bellSway, { toValue: 1, duration: 1100, useNativeDriver: true }),
      Animated.timing(bellSway, { toValue: -1, duration: 2200, useNativeDriver: true }),
      Animated.timing(bellSway, { toValue: 0, duration: 1100, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isMe, bellSway]);
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [rooms, setRooms] = useState<any[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<Record<string, number>>({});
  // 2026-10-17 (Sumon): server gift catalog for real gift images in preview
  const [giftCatalog, setGiftCatalog] = useState<Record<string, { name: string; thumbnailUrl?: string }>>({});
  // 2026-10-12 (Sumon): diamonds sent — primary XP driver for the slow,
  // premium level system (1 XP per diamond sent as gift).
  const [diamondsSent, setDiamondsSent] = useState(0);
  // 2026-10-24 (Sumon): level XP accumulated server-side by gift sends
  // (levelService.recordLevelXP) — the profile level now comes from the
  // ONE permanent level system, not a local estimate.
  const [levelXp, setLevelXp] = useState(0);
  const [nobleState, setNobleState] = useState<NobleState | null>(null);
  // PIN gate for private rooms (enforced from EVERYWHERE)
  const { requestRoomAccess, pinDialog } = usePrivateRoomGate();
  // (Gift History section removed 2026-10-10 per Sumon: gifts live ONLY inside
  // /profile/gifts with x2/x3 aggregation, not on the profile screen.)
  const [vidCopied, setVidCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // NOTE 11 (2026-10-11): full-screen DP viewer + Change flow
  const [showDpViewer, setShowDpViewer] = useState(false); // DEPRECATED 2026-10-13: DP viewer is now /profile/dp-viewer route
  const [uploadingDp, setUploadingDp] = useState(false);
  // 2026-10-29 (boss, imo mirror): "..." popup, bio More/Collapse, card roles,
  // owner countries, raw profile fields, cover upload state.
  const [showVidPopup, setShowVidPopup] = useState(false);
  // 2026-10-30 (boss, visitors bell): green dot iff unseen-listed > 0.
  const [unseenVisitorCount, setUnseenVisitorCount] = useState(0);
  // 2026-10-30 (boss, imo bell design): beside-number = TOTAL listed visitors
  // (7-day window, same as the Recent Visitors TitleBar count), 99+ cap.
  const [listedVisitorTotal, setListedVisitorTotal] = useState(0);
  // 2026-10-30 (boss, visitors bell): gentle bell sway value (±6deg).
  const bellSway = useRef(new Animated.Value(0)).current;
  // 2026-10-30 (boss, imo-style overlay header): status-bar inset for the
  // overlay icons (cover reaches the screen top; icons sit below the bar).
  const insets = useSafeAreaInsets();
  const [bioExpanded, setBioExpanded] = useState(false);
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [ownerCountryMap, setOwnerCountryMap] = useState<Record<string, string>>({});
  const [extraFields, setExtraFields] = useState<{
    city?: string; hometown?: string; birthday?: string; gender?: string; country?: string;
  }>({});
  const [uploadingCover, setUploadingCover] = useState(false);
  // NOTE 7 (2026-10-11): real granted badges from Firebase (official/event only)
  const [grantedBadges, setGrantedBadges] = useState<GrantedBadge[]>([]);
  // 2026-10-26: Intimacy card — real pairs for the VIEWED uid + couple pointer (null = no couple).
  const [intimacyEntries, setIntimacyEntries] = useState<IntimacyEntry[]>([]);
  const [intimacyPeers, setIntimacyPeers] = useState<Record<string, { name: string; photoURL: string | null }>>({});
  const [intimacyCouple, setIntimacyCouple] = useState<CoupleState | null>(null);
  // 2026-10-27 (boss correction): EXPLICIT friends only — intimacy pairs
  // NEVER render as Friend tiles. Empty (+) slots fill up to MAX_FRIENDS.
  const [intimacyFriends, setIntimacyFriends] = useState<FriendEntry[]>([]);
  // 2026-10-13 (Sumon): official badge check for verified logo next to name
  const [isOfficial, setIsOfficial] = useState(false);
  // 2026-10-13 (Sumon): server-driven badge icon (his design) next to name
  const [badgeIconUrl, setBadgeIconUrl] = useState<string | null>(null);
  // P1-4/P1-5 (2026-10-12): frames for the DP overlay + real owned counts
  const [grantedFrames, setGrantedFrames] = useState<GrantedFrame[]>([]);
  const [grantedNameplates, setGrantedNameplates] = useState<GrantedNameplate[]>([]);
  // ── Other-user action buttons state (only used when !isMe) ──
  const [isFollowingTarget, setIsFollowingTarget] = useState(false);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
  // দুই দিকের ব্লক স্টেট: 'none' | 'byMe' | 'byThem' | 'mutual'
  const [blockDirection, setBlockDirection] = useState<BlockDirection>('none');
  const [actionLoading, setActionLoading] = useState(false);
  // আমি ব্লক করেছি (byMe/mutual) — তখন বাম বাটনে Unblock দেখায়
  const isBlockedTarget = blockDirection === 'byMe' || blockDirection === 'mutual';
  // ও আমাকে ব্লক করেছে — প্রোফাইল ডেটা + অ্যাকশন সব বন্ধ
  const blockedByThem = blockDirection === 'byThem' || blockDirection === 'mutual';

  useEffect(() => {
    if (!displayUid) { setLoading(false); return; }
    const unsub = subscribeUser(displayUid, (u) => { setProfile(u); setLoading(false); });
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [displayUid]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeFollowCounts(displayUid, setFollowCounts);
  }, [displayUid]);

  // 2026-10-24 (Sumon): subscribe to the permanent server level XP.
  useEffect(() => {
    if (!displayUid) { setLevelXp(0); return; }
    return subscribeLevel(displayUid, (l) => setLevelXp(l.xp));
  }, [displayUid]);

  // 2026-10-12 (Sumon): subscribe to diamonds sent (gift_sent transactions)
  // for the premium level system. Best-effort — level falls back gracefully.
  useEffect(() => {
    if (!displayUid) { setDiamondsSent(0); return; }
    let cancelled = false;
    void (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `wallets/${displayUid}/transactions`));
        if (cancelled) return;
        let total = 0;
        if (snap.exists()) {
          snap.forEach((child) => {
            const tx = child.val() as { type?: string; diamonds?: number } | null;
            // 2026-10-12 review fix: gift_sent stores diamonds as NEGATIVE
            // (it's a debit) — use abs() or the level becomes NaN.
            if (tx?.type === 'gift_sent' && typeof tx.diamonds === 'number') {
              total += Math.abs(tx.diamonds);
            }
          });
        }
        if (!cancelled) setDiamondsSent(total);
      } catch {
        // background: safe to swallow — level uses fallback
      }
    })();
    return () => { cancelled = true; };
  }, [displayUid]);

  // NOTE 7 (2026-10-11): subscribe to real granted badges (official/event only)
  useEffect(() => {
    if (!displayUid) { setGrantedBadges([]); return; }
    return subscribeBadges(displayUid, setGrantedBadges);
  }, [displayUid]);

  // 2026-10-26: Intimacy card data — pairs (value-desc) + couple pointer for the viewed uid.
  // 2026-10-27: + explicit friends (the ONLY source of Friend tiles).
  useEffect(() => {
    if (!displayUid) { setIntimacyEntries([]); setIntimacyCouple(null); setIntimacyFriends([]); return; }
    const unsubI = subscribeMyIntimacies(displayUid, setIntimacyEntries);
    const unsubC = subscribeCoupleState(displayUid, setIntimacyCouple);
    const unsubF = subscribeUserFriends(displayUid, setIntimacyFriends);
    return () => { unsubI(); unsubC(); unsubF(); };
  }, [displayUid]);

  // 2026-10-26: peer names/photos for intimacy tiles (best-effort, cached).
  useEffect(() => {
    const missing = new Set<string>();
    for (const e of intimacyEntries) {
      if (e.otherUid && !intimacyPeers[e.otherUid]) missing.add(e.otherUid);
    }
    for (const f of intimacyFriends) {
      if (f.uid && !intimacyPeers[f.uid]) missing.add(f.uid);
    }
    if (intimacyCouple?.partnerUid && !intimacyPeers[intimacyCouple.partnerUid]) {
      missing.add(intimacyCouple.partnerUid);
    }
    if (missing.size === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, { name: string; photoURL: string | null }> = {};
      for (const uid of missing) {
        try {
          next[uid] = await fetchPeerProfile(uid);
        } catch {
          next[uid] = { name: '', photoURL: null };
        }
      }
      if (!cancelled) setIntimacyPeers((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
  }, [intimacyEntries, intimacyFriends, intimacyCouple?.partnerUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-10-13 (Sumon): Check for valid Vee Official badge → verified logo next to name
  useEffect(() => {
    if (!displayUid) { setIsOfficial(false); return; }
    let cancelled = false;
    hasOfficialBadge(displayUid).then((v) => { if (!cancelled) setIsOfficial(v); });
    // Fetch server-driven badge icon (Sumon's design from catalog)
    getOfficialBadgeIconUrl().then((url) => { if (!cancelled) setBadgeIconUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [displayUid, grantedBadges]);

  // P1-4/P1-5 (2026-10-12): subscribe to frames + nameplates (expiry-filtered
  // inside the service — expired items are visible nowhere).
  useEffect(() => {
    if (!displayUid) { setGrantedFrames([]); setGrantedNameplates([]); return; }
    const unsubF = subscribeFrames(displayUid, setGrantedFrames);
    // 2026-10-24 (Sumon): never render a stale demo icon — resolve the
    // nameplate art from the server-driven catalog when the stored icon
    // is only a fallback emoji.
    const unsubN = subscribeNameplates(displayUid, (plates) =>
      setGrantedNameplates(plates.map((x) => ({ ...x, icon: resolveGrantedArt(x.id, x.icon) })))
    );
    return () => { unsubF(); unsubN(); };
  }, [displayUid]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeMyRoomsCombined(displayUid, setRooms);
  }, [displayUid]);

  // ── 2026-10-29 (boss, refined cards): profile-owner role per room.
  // userRooms/{uid} carries the role; ownerId wins (same as rooms.tsx).
  useEffect(() => {
    if (!displayUid) { setRoleMap({}); return; }
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(ref(database, `userRooms/${displayUid}`), (snap) => {
          const map: Record<string, string> = {};
          if (snap.exists()) {
            snap.forEach((child) => {
              const v = child.val() as { role?: string };
              map[child.key!] = v.role ?? 'member';
            });
          }
          setRoleMap(map);
        });
      } catch {}
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [displayUid]);

  // ── 2026-10-29: raw profile fields (city/hometown/birthday/gender/country).
  // NOTE: these are NOT in the VeeUser type and sanitizeVeeUser drops them on
  // read, so they are read raw here. Writes go through updateUser (a plain
  // update) and rules allow owner writes (no field whitelist). Follow-up:
  // add these fields to VeeUser + sanitize (userService change, separate order).
  useEffect(() => {
    if (!displayUid) { setExtraFields({}); return; }
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(ref(database, `users/${displayUid}`), (snap) => {
          const v = snap.val() as any;
          if (!v || typeof v !== 'object') { setExtraFields({}); return; }
          const pick = (k: string) => (typeof v[k] === 'string' ? v[k] : undefined);
          setExtraFields({
            city: pick('city'), hometown: pick('hometown'),
            birthday: pick('birthday'), gender: pick('gender'), country: pick('country'),
          });
        });
      } catch {}
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [displayUid]);

  // ── 2026-10-29: owner countries for the room-card flags (one-shot, cached).
  useEffect(() => {
    if (!displayUid || rooms.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const missing = new Set<string>();
        for (const r of rooms) {
          const oid = (r as any)?.ownerId;
          if (oid && oid !== displayUid && !(oid in ownerCountryMap)) missing.add(oid);
        }
        if (missing.size === 0) return;
        const next: Record<string, string> = {};
        for (const oid of missing) {
          try {
            const snap = await get(ref(database, `users/${oid}/country`));
            if (snap.exists() && typeof snap.val() === 'string' && snap.val()) next[oid] = snap.val();
          } catch {}
        }
        if (!cancelled && Object.keys(next).length > 0) {
          setOwnerCountryMap((prev) => ({ ...prev, ...next }));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [rooms, displayUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nobel tier — always shows the user's current rank name
  useEffect(() => {
    if (!displayUid) { setNobleState(null); return; }
    return subscribeNoble(displayUid, setNobleState);
  }, [displayUid]);

  // ── Private room PIN enforcement (from EVERYWHERE) ──
  const handleRoomPress = useCallback((room: any) => {
    requestRoomAccess(room, () => {
      router.push({ pathname: '/voice-room', params: { roomId: room.id } } as never);
    });
  }, [requestRoomAccess]);

  useEffect(() => {
    if (!displayUid) return;
    return subscribeTransactionHistory(displayUid, (txs) => {
      const counts: Record<string, number> = {};
      for (const tx of txs) {
        if (tx.type === 'gift_received' && tx.giftId) {
          // 2026-10-18 (Sumon): PERMANENT — resolve legacy numeric IDs to canonical
          const canonical = resolveGiftId(tx.giftId);
          counts[canonical] = (counts[canonical] ?? 0) + 1;
        }
      }
      setReceivedGifts(counts);
    });
  }, [displayUid]);

  // 2026-10-17 (Sumon): load server gift catalog for real gift images (realtime)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        return onValue(ref(database, 'gift_catalog'), (snap) => {
          if (cancelled) return;
          const catalog: Record<string, { name: string; thumbnailUrl?: string }> = {};
          if (snap.exists()) {
            snap.forEach((child) => {
              const v = child.val() as any;
              if (v && v.active !== false) {
                catalog[child.key as string] = {
                  name: v.name || child.key,
                  thumbnailUrl: v.thumbnailUrl || v.animationUrl,
                };
              }
            });
          }
          setGiftCatalog(catalog);
        });
      } catch {
        // non-critical: emoji fallback remains
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  // ── Other-user: subscribe to follow/friend/block status ──
  // 2026-10-13 (Sumon): ব্লক দুই দিকেই চেক — ও আমাকে ব্লক করলে প্রোফাইল
  // দেখা যাবে না, কোনো অ্যাকশনও হবে না। byMe সাইড লাইভ সাবস্ক্রিপশনে
  // আপডেট হয় (অন্য স্ক্রিন থেকে ব্লক/আনব্লক করলেও stale থাকে না)।
  useEffect(() => {
    if (isMe || !user?.uid || !displayUid) return;
    const unsub1 = subscribeIsFollowing(user.uid, displayUid, setIsFollowingTarget);
    const unsub2 = subscribeFriendStatus(user.uid, displayUid, setFriendStatus);
    let cancelled = false;
    getBlockDirection(user.uid, displayUid)
      .then((d) => { if (!cancelled) setBlockDirection(d); })
      .catch(() => {});
    const unsub3 = subscribeBlockedUsers(user.uid, (blocks) => {
      if (cancelled) return;
      const byMeNow = blocks.some((b) => b.targetUid === displayUid);
      setBlockDirection((prev) => {
        const themSide = prev === 'byThem' || prev === 'mutual';
        if (byMeNow && themSide) return 'mutual';
        if (byMeNow) return 'byMe';
        if (themSide) return 'byThem';
        return 'none';
      });
    });
    return () => { cancelled = true; unsub1(); unsub2(); unsub3(); };
  }, [isMe, user?.uid, displayUid]);

  // ── Other-user: action handlers ──
  const handleLeftAction = useCallback(async () => {
    if (!user?.uid || !displayUid || actionLoading) return;
    // 2026-10-13 (Sumon): request-received হলে Accept/Decline দুটো অপশন —
    // আগে প্রোফাইল থেকে ডিক্লাইন করার কোনো পথ ছিল না (UX dead-end)।
    if (friendStatus === 'request-received' && !isBlockedTarget) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // NOTE: displayName const নিচে ডিক্লেয়ার হয় — deps array-এ রাখলে
      // TDZ crash হবে, তাই এখানে profile?.name সরাসরি ব্যবহার।
      Alert.alert(profile?.name || t('userProfile.defaultName', 'User'), '', [
        {
          text: t('userProfile.accept', 'Accept'),
          onPress: async () => {
            setActionLoading(true);
            try {
              // P1 fix (2026-10-12): signature is (myUid, fromUid) — accepter first.
              await acceptFriendRequest(user.uid, displayUid);
            } catch (e) {
              Alert.alert(t('userProfile.error', 'Error'), String(e));
            } finally {
              setActionLoading(false);
            }
          } },
        {
          text: t('userProfile.decline', 'Decline'),
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await rejectFriendRequest(user.uid, displayUid);
            } catch (e) {
              Alert.alert(t('userProfile.error', 'Error'), String(e));
            } finally {
              setActionLoading(false);
            }
          } },
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      ]);
      return;
    }
    setActionLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isBlockedTarget) {
        await unblockUser(user.uid, displayUid);
        // আনব্লকের পর ওর দিকের ব্লক থাকলে 'byThem' থাকে
        setBlockDirection((prev) => (prev === 'mutual' ? 'byThem' : 'none'));
      } else if (friendStatus === 'friends') {
        // Chat-এ যাওয়ার আগে ব্লক আবার চেক — stale স্টেটে বাইপাস হবে না
        const dir = await getBlockDirection(user.uid, displayUid).catch(() => 'none' as BlockDirection);
        setBlockDirection(dir);
        if (dir !== 'none') {
          Alert.alert(
            t('userProfile.error', 'Error'),
            dir === 'byMe' || dir === 'mutual'
              ? t('userProfile.blockedByMeChat', 'You blocked this user. Unblock to chat.')
              : t('userProfile.blockedByThemChat', 'This user has blocked you.'),
          );
          return;
        }
        router.push(`/inbox/${buildChatId(user.uid, displayUid)}`);
      } else if (friendStatus === 'request-sent') {
        await cancelFriendRequest(user.uid, displayUid);
      } else {
        // P1 fix (2026-10-12): sendFriendRequest needs the FULL VeeUser
        // (vId + photoURL). A minimal {uid, name} object produced
        // fromVId: undefined and the RTDB set() threw every time.
        const fullProfile = await getUser(user.uid);
        if (!fullProfile) throw new Error(t('userProfile.tryAgain', 'Please try again.'));
        await sendFriendRequest(fullProfile, displayUid);
      }
    } catch (e) {
      Alert.alert(t('userProfile.error', 'Error'), String(e));
    } finally {
      setActionLoading(false);
    }
  }, [user?.uid, displayUid, friendStatus, isBlockedTarget, actionLoading, t, profile?.name]);

  const handleRightAction = useCallback(async () => {
    if (!user?.uid || !displayUid || actionLoading) return;
    setActionLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isFollowingTarget) {
        await unfollowUser(user.uid, displayUid);
      } else {
        await followUser(user.uid, displayUid);
      }
    } catch (e) {
      Alert.alert(t('userProfile.error', 'Error'), String(e));
    } finally {
      setActionLoading(false);
    }
  }, [user?.uid, displayUid, isFollowingTarget, actionLoading, t]);

  const handleCopyVid = useCallback(async () => {
    const id = profile?.vId;
    if (!id) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Clipboard.setStringAsync(id);
      setVidCopied(true);
      setShowVidPopup(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setVidCopied(false), 2000);
    } catch {}
  }, [profile?.vId]);

  const handleLogout = useCallback(() => {
    Alert.alert(t('profile.signOutTitle'), t('profile.signOutMsg'), [
      { text: t('profile.cancel'), style: 'cancel' },
      { text: t('profile.menuSignOut'), style: 'destructive', onPress: logout },
    ]);
  }, [logout, t]);

  // ── NOTE 11 (2026-10-11): DP Change flow — gallery pick → Cloudinary upload → Firebase photoURL
  const handleChangeDp = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow gallery access to choose a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      setUploadingDp(true);
      try {
        // Delete the old Cloudinary asset so orphans don't accumulate
        const oldPublicId = (profile as any)?.photoPublicId;
        if (oldPublicId) {
          deleteCloudinaryAsset(oldPublicId).catch(() => {/* non-critical */});
        }
        const upload = await uploadProfilePhoto(result.assets[0].uri);
        await updateUser(user.uid, {
          photoURL: upload.url,
          ...(upload.publicId ? { photoPublicId: upload.publicId } : {}) });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        Alert.alert('Could not update photo', `Reason: ${getErrorCause(err)}`);
      } finally {
        setUploadingDp(false);
      }
    } catch (err) {
      Alert.alert('Could not open gallery', `Reason: ${getErrorCause(err)}`);
    }
  }, [user?.uid, profile]);

  // ── 2026-10-29 (boss, imo mirror): Cover Change flow — reached from
  // the cover viewer's Change button (or directly when no cover is set),
  // exactly like DP change, NOT inside the Edit Profile sub-flow.
  // Fixed 180dp cover for ALL users.
  const handleChangeCover = useCallback(async () => {
    if (!user?.uid) return;
    Alert.alert('Cover photo', 'Change your profile cover photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Change photo',
        onPress: async () => {
          try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission needed', 'Please allow gallery access to choose a cover photo.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [16, 9],
              quality: 0.85 });
            if (result.canceled || !result.assets[0]) return;
            setUploadingCover(true);
            try {
              const upload = await uploadCoverPhoto(result.assets[0].uri);
              await updateUser(user.uid, { coverImageUrl: upload.url });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              Alert.alert('Could not update cover', `Reason: ${getErrorCause(err)}`);
            } finally {
              setUploadingCover(false);
            }
          } catch (err) {
            Alert.alert('Could not open gallery', `Reason: ${getErrorCause(err)}`);
          }
        } },
    ]);
  }, [user?.uid]);

  // ── 2026-10-29 (boss, cover viewer): cover tap mirrors the DP tap —
  // show the cover full-screen FIRST (same viewer + same Change pill),
  // and only the viewer's Change button opens the change flow. No cover
  // set -> nothing to view, so the tap goes directly to the change flow.
  const handleCoverTap = useCallback(() => {
    if (profile?.coverImageUrl) {
      router.push({ pathname: '/profile/dp-viewer', params: { kind: 'cover' } } as never);
    } else {
      void handleChangeCover();
    }
  }, [profile?.coverImageUrl, handleChangeCover]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </SafeAreaView>
    );
  }

  // 2026-10-13 (Sumon): ও আমাকে ব্লক করলে প্রোফাইল দেখা যাবে না —
  // নাম/DP/বায়ো/রুম/গিফট/ব্যাজ কিছুই রেন্ডার হবে না, অ্যাকশন বাটনও না।
  // (byMe হলে পুরো প্রোফাইলই দেখায় — বাম বাটনে Unblock থাকে, আগের মতো।)
  if (!isMe && blockedByThem) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/home' as never);
            }}
            style={{ padding: 8 }}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <View style={{
            width: 84, height: 84, borderRadius: 42,
            backgroundColor: '#FEE2E2',
            alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Feather name="slash" size={36} color="#DC2626" />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center' }}>
            {t('userProfile.blockedByThemTitle', 'This profile is unavailable')}
          </Text>
          <Text style={{ fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 10 }}>
            {t('userProfile.blockedByThemMsg', "This user has blocked you, so you can't view their profile.")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile?.name || (isMe ? user?.displayName : (targetName || (profile?.email ? profile.email.split('@')[0] : null))) || 'User';
  const photoURL = profile?.photoURL || (isMe ? user?.photoURL : undefined);
  const vId = profile?.vId || '';
  const bio = profile?.bio || '';
  /* 2026-10-15 (Sumon): ONE active nameplate shows below the name on profile */
  const activeNameplate = grantedNameplates.find((n) => n.id === (profile as any)?.activeNameplate) || null;
  /* Mist color for Viscount+ nameplates */
  const nameplateMist = (() => {
    if (!activeNameplate) return null;
    const entry = getActiveCatalog().find((r) => `noble-plate-${r.rankKey}` === activeNameplate.id);
    return entry?.nameplate.mistColor || null;
  })();
  const giftEntries = Object.entries(receivedGifts);
  const totalGifts = giftEntries.reduce((s, [, c]) => s + c, 0);

  // ─── Permanent Level System (levelService) ───
  // 2026-10-24 (Sumon): the old local estimate (sqrt(xp/50), Max at ~115k
  // XP) made Max far too easy — his test profile hit "Max" quickly. The
  // profile now reads the ONE permanent system: server-accumulated level
  // XP from gift sends, with the lifetime diamondsSent stat as a floor so
  // sends from before the XP wiring still count. Curve (levelService):
  // Bronze 16 = 225k XP · Silver 16 = 900k · Gold 16 / Max = 3,600,000.
  const userLevel = getLevelFromXP(Math.max(levelXp, diamondsSent)).totalLevel;

  // NOTE 7 (2026-10-11): demo badges removed — grantedBadges comes from the
  // Firebase subscription above (official/event grants only).

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home' as never);
  };

  // ── 2026-10-29 (boss, imo mirror): derived profile values ───
  const roleForRoom = (room: any): 'owner' | 'admin' | 'member' => {
    if (room.ownerId === displayUid) return 'owner';
    return (roleMap[room.id] as 'owner' | 'admin' | 'member' | undefined) ?? 'member';
  };
  const ownerCountryForRoom = (room: any): string | null => {
    if (room.ownerId === displayUid) return extraFields.country ?? null;
    return ownerCountryMap[room.ownerId] ?? null;
  };
  const age = calcAge(extraFields.birthday);
  const myCountry = extraFields.country ?? '';
  const myCity = extraFields.city ?? '';
  const myHometown = extraFields.hometown ?? '';
  const myGenderSym = genderSymbol(extraFields.gender);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom', 'left', 'right']}>
      {/* ─── 2026-10-29 (boss, imo mirror): cover + DP + chips ───
          Cover is fixed 180dp for ALL users; DP is 80dp for ALL users.
          Cover tap (own only) opens the full-screen cover viewer first
          (same viewer as DP, same Change pill); Change opens the change
          option — NOT inside the Edit Profile sub-flow. The whole page scrolls as ONE container (imo-like, 2026-10-29 Fix #4):
          cover, DP, name, chips, bio, sections and the bottom action all scroll;
          Header is the imo-style overlay (2026-10-30): NO bar, NO name text — white icons sit ON the cover and scroll away with it. Inline vId +
          short-ID badge were removed here — the ID now lives in the "..."
          popup + Room Profile row. */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View>
        <Pressable
          onPress={isMe ? handleCoverTap : undefined}
          style={{ height: 180, backgroundColor: '#E8E8ED', alignItems: 'center', justifyContent: 'center' }}
        >
          {profile?.coverImageUrl ? (
            <Image source={{ uri: profile.coverImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <Feather name="image" size={40} color={C.mutedLight} />
          )}
          {uploadingCover && (
            <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
              <PremiumLoader size="small" />
            </View>
          )}
        </Pressable>
        {/* 2026-10-30 (boss, imo-style overlay header): NO white bar, NO name
            text — white icons sit ON the cover photo and scroll away with it
            (like the pre-batch-1 overlay + imo). Icons are ABSOLUTE with
            physical left/right so they can never mirror-flip: back left;
            right group left-to-right = bell, gear, three-dot. Bell is white
            outline + plain number beside it (listed total, 99+ cap) + green
            dot iff unseen; bell sways gently left-right (own only). */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 56 }}>
          <Pressable onPress={goBack} style={{ position: 'absolute', left: 4, top: insets.top + 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
            <Feather name="arrow-left" size={24} color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
          </Pressable>
          {isMe ? (
            <Pressable onPress={() => router.push('/profile/visitors')} style={{ position: 'absolute', right: vId ? 84 : 44, top: insets.top + 8, height: 40, flexDirection: 'row', alignItems: 'center' }} hitSlop={8}>
              <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={{ transform: [{ rotate: bellSway.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] }) }] }}>
                  <Feather name="bell" size={22} color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
                </Animated.View>
                {unseenVisitorCount > 0 ? (
                  <View style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: C.green, borderWidth: 1, borderColor: C.card }} />
                ) : null}
              </View>
              {listedVisitorTotal > 0 ? (
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{listedVisitorTotal > 99 ? '99+' : String(listedVisitorTotal)}</Text>
              ) : null}
            </Pressable>
          ) : null}
          {isMe ? (
            <Pressable onPress={() => router.push('/profile/settings')} style={{ position: 'absolute', right: vId ? 44 : 4, top: insets.top + 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
              <Feather name="settings" size={22} color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
            </Pressable>
          ) : null}
          {vId ? (
            <Pressable onPress={() => setShowVidPopup(true)} style={{ position: 'absolute', right: 4, top: insets.top + 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
              <Feather name="more-horizontal" size={24} color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }} />
            </Pressable>
          ) : null}
        </View>
        </View>
        <View style={{ backgroundColor: C.card, paddingHorizontal: 16, paddingBottom: 15 }}>
          <View style={{ marginTop: -40 }}>
            {/* FIX #39: alignSelf flex-start — without a style this Pressable
                stretches to the full header width (column parent defaults to
                stretch), so taps on the EMPTY space right of the DP opened the
                DP viewer. Now the hit box is just the 92x92 DP (+ hitSlop). */}
            <Pressable
              onPress={() => {
                if (isMe) {
                  router.push('/profile/dp-viewer');
                } else {
                  router.push({ pathname: '/profile/dp-viewer', params: { uid: displayUid } } as never);
                }
              }}
              hitSlop={6}
              style={{ alignSelf: 'flex-start' }}
            >
              <View style={{ width: 92, height: 92, alignItems: 'center', justifyContent: 'center' }}>
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: C.card }} />
                ) : (
                  <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.blueLight, borderWidth: 3, borderColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: C.blue }}>{displayName[0]?.toUpperCase()}</Text>
                  </View>
                )}
                {(() => {
                    const activeFrameId = profile?.activeFrame;
                    if (!activeFrameId) return null;
                    // Official animated frame — pure RN AnimatedFrame (no native modules)
                    if (activeFrameId === 'official' || (typeof activeFrameId === 'string' && activeFrameId.toLowerCase().includes('official'))) {
                      return (
                        <View style={{ position: 'absolute', width: 110, height: 110, top: -9, left: -9, alignItems: 'center', justifyContent: 'center' }}>
                          {/* 2026-10-14 (Sumon): frameId pass করতে হবে — না হলে server APNG load হয় না */}
                          <AnimatedFrame size={80} frameId={activeFrameId} />
                        </View>
                      );
                    }
                    const activeFrameObj = grantedFrames.find((f) => f.id === activeFrameId);
                    if (!activeFrameObj) return null;
                    if (/^https?:\/\//i.test(activeFrameObj.icon)) {
                      // 2026-10-15 (Sumon): Nobel frame 110px — fits DP without looking oversized
                      // 2026-10-16 (Sumon): Nobel frames have COUNT text + crown ON TOP.
                      // Shift UP 8.25px so the frame covers the DP fully (no white space on top).
                      const isNobleFrame = activeFrameId.startsWith('noble-frame-');
                      const frameSize = isNobleFrame ? 110 : 92;
                      const nobleOffsetY = isNobleFrame ? -8.25 : 0;
                      return (
                        <Image
                          source={{ uri: activeFrameObj.icon }}
                          style={{
                            position: 'absolute',
                            width: frameSize, height: frameSize,
                            top: (92 - frameSize) / 2 + nobleOffsetY,
                            left: (92 - frameSize) / 2,
                          }}
                          resizeMode="contain"
                        />
                      );
                    }
                    return (
                      <View style={{ position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#FFD54A' }} />
                    );
                  })()}
              </View>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: '500', color: C.text, flexShrink: 1 }} numberOfLines={1}>{displayName}</Text>
            {(profile?.officialBadge || isOfficial) ? (
              <Image
                source={badgeIconUrl ? { uri: badgeIconUrl } : require('@/assets/images/vee-badge.png')}
                style={{ width: 20, height: 20, marginLeft: 6 }}
                resizeMode="contain"
              />
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            {activeNameplate && /^https?:\/\//i.test(activeNameplate.icon) ? (
              <View style={{ marginRight: 6 }}>
                {nameplateMist ? (
                  <MistNameplate imageUrl={activeNameplate.icon} mistColor={nameplateMist} width={100} height={20} fit="cover" />
                ) : (
                  <Image
                    source={{ uri: activeNameplate.icon }}
                    style={{ width: 100, height: 20 }}
                    contentFit="cover"
                  />
                )}
              </View>
            ) : null}
            <LevelBadge level={userLevel} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
            <LightChip onPress={() => router.push({ pathname: '/profile/followers', params: { type: 'followers', uid: displayUid } } as never)}>
              <Text style={{ fontSize: 11, color: C.text, fontWeight: '500' }}>⭐ {fmtCompact(followCounts.followers)} Followers</Text>
            </LightChip>
            {age !== null && (
              <LightChip>
                <Text style={{ fontSize: 11, color: C.text, fontWeight: '500' }}>{myGenderSym ? `${myGenderSym} ` : ''}{age}</Text>
              </LightChip>
            )}
            {myCountry ? (
              <LightChip>
                <PremiumLocationIcon />
                <Text style={{ fontSize: 11, color: C.text, fontWeight: '500' }}>{myCountry}</Text>
              </LightChip>
            ) : null}
          </View>
          {myCity ? (
            <Text style={{ fontSize: 14, color: C.text, marginTop: 8 }}>🏙 {myCity}</Text>
          ) : null}
          {myHometown ? (
            <Text style={{ fontSize: 14, color: C.text, marginTop: 4 }}>🏠 {myHometown}</Text>
          ) : null}
          {bio ? (
            <View style={{ marginTop: 8 }}>
              <Text
                numberOfLines={bioExpanded ? undefined : 2}
                style={{ fontSize: 14, color: C.muted, opacity: bioExpanded ? 1 : 0.6 }}
              >
                {bio}
              </Text>
              <Pressable
                onPress={() => setBioExpanded((v) => !v)}
                hitSlop={6}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}
              >
                <Feather name={bioExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.text} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginLeft: 2 }}>
                  {bioExpanded ? 'Collapse' : 'More'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* ─── VoiceClub Room section ─── */}
        {rooms.length > 0 && (
          <View style={flatSectionStyle}>
            <SectionHeader title="VoiceClub Room" count={rooms.length} onPress={() => router.push(isMe ? '/profile/rooms' : `/profile/rooms?uid=${displayUid}`)} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 15 }}
              nestedScrollEnabled
              directionalLockEnabled
            >
              {rooms.slice(0, 10).map((item, i) => (
                <RoomCard
                  key={item.id || String(i)}
                  item={item}
                  role={roleForRoom(item)}
                  ownerCountry={ownerCountryForRoom(item)}
                  onPress={() => handleRoomPress(item)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ─── Gifts section — 1 line: top 4 by diamond value ─── */}
        {giftEntries.length > 0 && (
          <View style={flatSectionStyle}>
            <SectionHeader title="Gifts" count={totalGifts} onPress={() => router.push(isMe ? '/profile/gifts' : `/profile/gifts?uid=${displayUid}`)} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 15 }}
              nestedScrollEnabled
              directionalLockEnabled
            >
              <Pressable onPress={() => router.push(isMe ? '/profile/gifts' : `/profile/gifts?uid=${displayUid}`)}>
                <View style={{ flexDirection: 'row' }}>
                {[...giftEntries]
                  .sort((a, b) => (GIFT_RANK_PRICE[b[0]] || 0) * b[1] - (GIFT_RANK_PRICE[a[0]] || 0) * a[1])
                  .slice(0, 4)
                  .map(([giftId, count]) => (
                  <View key={giftId} style={{ width: 80, padding: 4, alignItems: 'center' }}>
                    <View style={{ width: 72, height: 72, backgroundColor: '#FFFFFF', borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {giftCatalog[giftId]?.thumbnailUrl ? (
                        <Image source={{ uri: giftCatalog[giftId].thumbnailUrl }} style={{ width: '85%', height: '85%' }} resizeMode="contain" />
                      ) : (
                        <Text style={{ fontSize: 36 }}>{GIFTS[giftId] || '🎁'}</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: '600' }}>x{count}</Text>
                  </View>
                ))}
                </View>
              </Pressable>
            </ScrollView>
          </View>
        )}

        {/* ─── Intimacy section — couple tile first, then EXPLICIT friend tiles + (+) slots (always rendered, Honor shape) ───
            2026-10-27 (boss correction): intimacy pairs NEVER render here.
            Own card: real friends (max 5) + (+) slots filling up to 5.
            Other users' cards: real friends only, or "No friends yet". */}
        <View style={flatSectionStyle}>
          <SectionHeader
            title={t('profile.intimacy', { defaultValue: 'Intimacy' })}
            count={intimacyFriends.length + (intimacyCouple ? 1 : 0)}
            onPress={() => router.push((isMe ? '/profile/intimacy' : `/profile/intimacy?uid=${displayUid}`) as never)}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 15 }}
            nestedScrollEnabled
            directionalLockEnabled
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <CoupleTile
                coupled={!!intimacyCouple}
                partnerPhotoURL={intimacyCouple?.partnerUid ? (intimacyPeers[intimacyCouple.partnerUid]?.photoURL ?? null) : null}
                partnerName={intimacyCouple?.partnerUid ? (intimacyPeers[intimacyCouple.partnerUid]?.name || '') : ''}
                onPress={() => router.push((isMe ? '/profile/intimacy' : `/profile/intimacy?uid=${displayUid}`) as never)}
              />
              {intimacyFriends.map((f) => (
                <CardFriendTile
                  key={f.uid}
                  friendUid={f.uid}
                  peer={intimacyPeers[f.uid]}
                  pairValue={intimacyEntries.find((e) => e.otherUid === f.uid)?.value}
                  onPress={() => router.push({ pathname: '/user-profile', params: { uid: f.uid, name: intimacyPeers[f.uid]?.name || '' } } as Parameters<typeof router.push>[0])}
                />
              ))}
              {isMe && Array.from({ length: Math.max(0, MAX_FRIENDS - intimacyFriends.length) }).map((_, i) => (
                <FriendPlusTile
                  key={`friend-plus-${i}`}
                  onPress={() => router.push('/profile/intimacy?tab=friend' as never)}
                />
              ))}
              {!isMe && intimacyFriends.length === 0 && (
                <View style={{ alignSelf: 'center', paddingLeft: 8 }}>
                  <Text style={{ color: C.muted, fontSize: 13 }}>
                    {t('profile.intimacyNoFriends', { defaultValue: 'No friends yet' })}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>

        {/* ─── Honor section — real granted badges only (sacred: official badge stays next to name) ─── */}
        <View style={flatSectionStyle}>
          <SectionHeader
            title="Honor"
            count={grantedBadges.length}
            onPress={() => router.push(isMe ? '/profile/honor' : `/profile/honor?uid=${displayUid}`)}
          />
          {grantedBadges.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 15 }}
              nestedScrollEnabled
              directionalLockEnabled
            >
              <Pressable
                onPress={() => router.push(isMe ? '/profile/honor' : `/profile/honor?uid=${displayUid}`)}
                style={{ flexDirection: 'row' }}
              >
                {grantedBadges.map((h) => (
                  <View key={h.id} style={{ width: 80, padding: 4, alignItems: 'center' }}>
                    <View style={{ width: 72, aspectRatio: 1, backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                      {/^https?:\/\//i.test(h.icon || '') ? (
                        <Image source={{ uri: h.icon }} style={{ width: 48, height: 48 }} resizeMode="contain" />
                      ) : (
                        <Text style={{ fontSize: 36 }}>{h.icon}</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }} numberOfLines={1}>{h.name}</Text>
                  </View>
                ))}
              </Pressable>
            </ScrollView>
          ) : (
            <Pressable onPress={() => router.push(isMe ? '/profile/honor' : `/profile/honor?uid=${displayUid}`)}>
              <Text style={{ textAlign: 'center', color: C.mutedLight, fontSize: 13, paddingVertical: 14, paddingHorizontal: 40 }}>
                No badges yet
              </Text>
            </Pressable>
          )}
        </View>

        {/* ─── Decoration section ─── */}
        <View style={flatSectionStyle}>
          <SectionHeader title="Decoration" count={grantedFrames.length} onPress={() => router.push(isMe ? '/profile/decoration' : `/profile/decoration?uid=${displayUid}`)} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15 }}>
            <Pressable
              onPress={() => router.push(isMe ? '/profile/decoration' : `/profile/decoration?uid=${displayUid}`)}
              style={{ width: 80, padding: 4, alignItems: 'center' }}
            >
              <LinearGradient
                colors={['#8B5CF6', '#A78BFA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 72, height: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="image" size={32} color="#FFFFFF" />
              </LinearGradient>
              <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Frames</Text>
              <Text style={{ fontSize: 11, color: C.mutedLight }}>{grantedFrames.length} owned</Text>
            </Pressable>
          </View>
        </View>

        {/* 2026-10-27 (boss): Wallet/Store/Notifications/Privacy/Help/About rows REMOVED from
            profile — they already live in Settings (gear screen). No placeholder left. */}
      {/* ─── Bottom Action: Edit (own) or Chat/Add + Follow (other user) ─── */}
      <View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 0.5, borderTopColor: C.border }}>
        {isMe ? (
          <Pressable
            onPress={() => router.push('/profile/room-profile')}
            style={{ backgroundColor: C.blueLight, borderRadius: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="edit-2" size={18} color={C.blue} />
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.blue, marginLeft: 8 }}>Edit</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={handleLeftAction}
              disabled={actionLoading}
              style={{
                flex: 1, backgroundColor: C.blueLight, borderRadius: 16, paddingVertical: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                opacity: actionLoading ? 0.6 : 1 }}
            >
              {actionLoading ? (
                <PremiumLoader size="small" />
              ) : (
                <>
                  <Feather
                    name={
                      isBlockedTarget ? 'unlock'
                      : friendStatus === 'friends' ? 'message-circle'
                      : friendStatus === 'request-received' ? 'user-check'
                      : friendStatus === 'request-sent' ? 'x'
                      : 'user-plus'
                    }
                    size={18} color={C.blue}
                  />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue, marginLeft: 6 }} numberOfLines={1} adjustsFontSizeToFit>
                    {isBlockedTarget ? t('userProfile.unblock', 'Unblock')
                      : friendStatus === 'friends' ? t('userProfile.chat', 'Chat')
                      : friendStatus === 'request-received' ? t('userProfile.accept', 'Accept')
                      : friendStatus === 'request-sent' ? t('userProfile.cancelRequest', 'Cancel Request')
                      : t('userProfile.add', 'Add')}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={handleRightAction}
              disabled={actionLoading}
              style={{
                flex: 1, backgroundColor: isFollowingTarget ? C.tile : C.blueLight,
                borderRadius: 16, paddingVertical: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                opacity: actionLoading ? 0.6 : 1 }}
            >
              <Feather name={isFollowingTarget ? 'check' : 'plus'} size={16} color={C.blue} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: C.blue, marginLeft: 6 }} numberOfLines={1} adjustsFontSizeToFit>
                {isFollowingTarget ? t('userProfile.following', 'Following') : t('userProfile.follow', 'Follow')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      </ScrollView>

      {/* ─── 2026-10-29 (boss): "..." popup — white pill with copy icon + VoiceClub ID.
          The ID is the SAME value as the Room Profile row (profile vId), NOT the short ID. */}
      <Modal visible={showVidPopup} transparent animationType="fade" onRequestClose={() => setShowVidPopup(false)}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => setShowVidPopup(false)}
        />
        <View style={{
          position: 'absolute', top: insets.top + 56, right: 16,
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: '#FFFFFF', borderRadius: 14,
          paddingHorizontal: 16, paddingVertical: 12,
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 }, elevation: 8 }}>
          <Pressable onPress={handleCopyVid} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name={vidCopied ? 'check' : 'copy'} size={18} color={vidCopied ? C.blue : C.muted} />
            <Text style={{ fontSize: 16, color: C.text, marginLeft: 8 }}>ID: {vId}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ─── PIN Dialog for Private Rooms (shared gate) ─── */}
      {pinDialog}

    </SafeAreaView>
  );
}
