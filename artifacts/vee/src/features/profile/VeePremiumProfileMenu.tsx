/**
 * Vee Premium Profile Menu — approved purple/gold flat design.
 * UI ONLY. The host Vee app owns real profile data, wallet balances, routing,
 * permissions, subscriptions, status and all existing behavior.
 *
 * Integration notes for host:
 *  - onNoble -> existing /profile/nobel (NOT a new Noble page)
 *  - onSvip -> existing /svip
 *  - onDecoration -> existing /profile/decoration
 *  - onGiftWall -> existing /profile/gifts if that is the intended gift view
 *  - Other callbacks -> host's existing appropriate actions; do not invent routes.
 *  - No Family row by explicit user instruction.
 *  - All value props must come from real current-user data; never pass samples.
 *  - All labels are English. No wallet/payment code or new dependencies.
 */
import React, { memo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs, LinearGradient as SvgGradient, Stop, Path, Rect, Circle,
  Polygon, Line, Ellipse,
} from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

export type VeePremiumProfileMenuProps = {
  displayName: string;
  photoUrl?: string | null;
  followersLabel: string;
  ageLabel?: string | null;
  gender?: 'male' | 'female' | null;
  countryLabel?: string | null;
  diamondBalanceLabel: string;
  achievementLabel?: string | null;
  nobleRankLabel?: string | null;
  giftCountLabel: string;
  onBack: () => void;
  onSettings: () => void;
  onProfilePhoto: () => void;
  onFollowers: () => void;
  onTaskCenter: () => void;
  onDiamonds: () => void;
  onAchievement: () => void;
  onSvip: () => void;
  onNoble: () => void;
  onDecoration: () => void;
  onGiftWall: () => void;
  onRank: () => void;
  onMyEvent: () => void;
};

const P = {
  ink: '#24163B',
  muted: '#81778F',
  purple: '#7634C4',
  purpleDark: '#4B1F87',
  lilac: '#F4EAFF',
  gold: '#E8B84B',
  goldDark: '#BC8123',
  border: '#EBE2F3',
  white: '#FFFFFF',
  base: '#F7F3FD',
  rose: '#EC4899',
} as const;

type GlyphName =
  | 'diamond' | 'achievement' | 'svip' | 'noble' | 'decoration'
  | 'gift' | 'rank' | 'event' | 'task' | 'back' | 'settings'
  | 'arrow' | 'star' | 'location' | 'male' | 'female' | 'person';

const PremiumGlyph = memo(function PremiumGlyph({
  kind, size = 34,
}: { kind: GlyphName; size?: number }) {
  const violet = P.purple;
  const gold = P.gold;
  const common = { strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  // The diamonds replicate Vee's existing rose-pink DiamondIcon vector palette.
  if (kind === 'diamond') {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Polygon points="6,40 26,14 32,40" fill="#F9A8D4" />
        <Polygon points="26,14 50,14 50,40 32,40" fill="#FCE7F3" />
        <Polygon points="50,14 74,14 68,40 50,40" fill="#F472B6" />
        <Polygon points="74,14 94,40 68,40" fill="#EC4899" />
        <Polygon points="6,40 32,40 50,90" fill="#F472B6" />
        <Polygon points="32,40 50,40 50,90" fill="#DB2777" />
        <Polygon points="50,40 68,40 50,90" fill="#EC4899" />
        <Polygon points="68,40 94,40 50,90" fill="#9D174D" />
        <Path d="M34 20 L36.5 27 L34 34 L31.5 27 Z" fill="#FFFFFF" opacity={0.9} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <SvgGradient id="vg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#AA6DF3" />
          <Stop offset="100%" stopColor="#49207F" />
        </SvgGradient>
        <SvgGradient id="gg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#FFE5A6" />
          <Stop offset="100%" stopColor="#D99B31" />
        </SvgGradient>
      </Defs>
      {kind === 'achievement' && <>
        <Path d="M11 7 H29 V17 C29 24 25 28 20 28 C15 28 11 24 11 17 Z" fill="url(#vg)" stroke={gold} {...common}/>
        <Path d="M11 11 H5 V16 C5 20 8 22 12 22 M29 11 H35 V16 C35 20 32 22 28 22" fill="none" stroke={gold} {...common}/>
        <Path d="M20 11 L22 15.1 L26.5 15.6 L23.2 18.7 L24.2 23 L20 20.8 L15.8 23 L16.8 18.7 L13.5 15.6 L18 15.1 Z" fill="#FFE5A6" />
        <Path d="M20 28 V33 M13 35 H27" stroke={violet} {...common}/>
      </>}
      {kind === 'svip' && <>
        <Path d="M20 5 L34 15 L30 28 L20 36 L10 28 L6 15 Z" fill="url(#vg)" stroke={gold} {...common}/>
        <Path d="M12 17 L20 27 L29 14 M14 13 L20 10 L26 13" fill="none" stroke="#FFF0BF" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"/>
        <Path d="M17 6 L20 2 L23 6" fill="none" stroke={gold} strokeWidth={1.9} strokeLinecap="round"/>
      </>}
      {kind === 'noble' && <>
        <Path d="M20 5 L32 11 V22 C32 29 26 34 20 37 C14 34 8 29 8 22 V11 Z" fill="url(#vg)" stroke="url(#gg)" {...common}/>
        <Path d="M13.5 19.5 C13.5 15 18 14 20 18 C22 14 26.5 15 26.5 19.5 C26.5 23 22.5 27 20 29 C17.5 27 13.5 23 13.5 19.5 Z" fill="url(#gg)"/>
        <Path d="M14 8 L16 4 L20 7 L24 4 L26 8" fill="none" stroke={gold} strokeWidth={1.7}/>
      </>}
      {kind === 'decoration' && <>
        <Path d="M5 13 L12 20 L20 8 L28 20 L35 13 L32 30 H8 Z" fill="url(#vg)" stroke="url(#gg)" {...common}/>
        <Rect x={8} y={30} width={24} height={4} rx={1.8} fill="url(#gg)"/>
        <Polygon points="20,15 24,21 20,27 16,21" fill="#FFE8B0"/>
        <Circle cx={5} cy={12} r={2.4} fill={gold}/>
        <Circle cx={20} cy={7} r={2.4} fill={gold}/>
        <Circle cx={35} cy={12} r={2.4} fill={gold}/>
      </>}
      {kind === 'gift' && <>
        <Rect x={7} y={18} width={26} height={17} rx={3} fill="url(#vg)" stroke={gold} {...common}/>
        <Rect x={5} y={14} width={30} height={7} rx={2} fill="url(#gg)" />
        <Path d="M20 14 V35" stroke="#FBE5AB" strokeWidth={3}/>
        <Path d="M19 13 C11 13 8 11 9 7 C10 2 19 6 20 14 C21 6 30 2 31 7 C32 11 29 13 21 13" fill="none" stroke={violet} {...common}/>
      </>}
      {kind === 'rank' && <>
        <Rect x={5} y={23} width={8} height={12} rx={2} fill="#B68BEF"/>
        <Rect x={16} y={15} width={8} height={20} rx={2} fill="url(#vg)"/>
        <Rect x={27} y={7} width={8} height={28} rx={2} fill="url(#gg)"/>
        <Path d="M5 36 H35" fill="none" stroke={violet} strokeWidth={1.5}/>
      </>}
      {kind === 'event' && <>
        <Ellipse cx={14} cy={13} rx={8} ry={10} fill="url(#vg)"/>
        <Path d="M14 23 L12 27 H16 Z M14 27 C11 31 18 32 14 37" stroke={violet} fill="none" strokeWidth={1.8}/>
        <Ellipse cx={29} cy={16} rx={6} ry={8} fill="url(#gg)" />
        <Path d="M29 24 L27 27 H31 Z M29 27 C26 31 32 32 30 36" stroke={gold} fill="none" strokeWidth={1.6}/>
      </>}
      {kind === 'task' && <>
        <Rect x={7} y={8} width={26} height={27} rx={5} fill="url(#vg)" stroke="#F9D486" strokeWidth={1.5}/>
        <Path d="M13 5 V12 M27 5 V12 M8 16 H32" stroke="#FFE5A6" strokeWidth={2.4} strokeLinecap="round"/>
        <Path d="M13 25 L18 29 L27 20" fill="none" stroke="#FFE5A6" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"/>
      </>}
      {kind === 'back' && <Path d="M25 8 L13 20 L25 32 M13 20 H34" stroke={P.ink} fill="none" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />}
      {kind === 'arrow' && <Path d="M15 10 L25 20 L15 30" stroke="#B6AEC4" fill="none" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />}
      {kind === 'settings' && <>
        <Path d="M17 4 H23 L24 9 L29 11 L33 9 L36 15 L32 18 V23 L36 26 L33 32 L28 30 L24 32 L23 36 H17 L16 32 L11 30 L7 32 L4 26 L8 23 V18 L4 15 L7 9 L12 11 L16 9 Z" fill="none" stroke={P.ink} strokeWidth={2.3} strokeLinejoin="round"/>
        <Circle cx={20} cy={20} r={5.4} fill="none" stroke={P.ink} strokeWidth={2.3}/>
      </>}
      {kind === 'star' && <Path d="M20 5 L24.6 14.9 L35 16.2 L27.4 23.6 L29.3 34 L20 28.8 L10.7 34 L12.6 23.6 L5 16.2 L15.4 14.9 Z" fill="#DBC0FC" stroke="#B68AE9" strokeWidth={1.2}/>}
      {kind === 'location' && <>
        <Path d="M20 35 C16 29 10 23 10 17 C10 10 14 6 20 6 C26 6 30 10 30 17 C30 23 24 29 20 35 Z" fill="none" stroke="#35B65B" strokeWidth={2.5}/>
        <Circle cx={20} cy={17} r={4} fill="none" stroke="#35B65B" strokeWidth={2.4}/>
      </>}
      {kind === 'male' && <><Circle cx={16} cy={24} r={8} fill="none" stroke="#1597EA" strokeWidth={2.4}/><Path d="M22 18 L32 8 M23 8 H32 V17" fill="none" stroke="#1597EA" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/></>}
      {kind === 'female' && <><Circle cx={20} cy={16} r={8} fill="none" stroke="#DC68BC" strokeWidth={2.4}/><Path d="M20 24 V35 M14 30 H26" fill="none" stroke="#DC68BC" strokeWidth={2.5} strokeLinecap="round"/></>}
      {kind === 'person' && <><Circle cx={20} cy={14} r={7} fill="#BAA1D5"/><Path d="M7 34 C8 25 15 23 20 23 C25 23 32 25 33 34 Z" fill="#BAA1D5"/></>}
    </Svg>
  );
});

function valueOrPlaceholder(value?: string | null): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

const SmallChip = memo(function SmallChip({
  icon, text, onPress,
}: { icon: GlyphName; text: string; onPress?: () => void }) {
  const content = (
    <View style={styles.chip}>
      <PremiumGlyph kind={icon} size={17} />
      <Text style={styles.chipText} numberOfLines={1}>{text}</Text>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={onPress} hitSlop={6}>{content}</Pressable>
  ) : content;
});

const MenuRow = memo(function MenuRow({
  title, icon, onPress, detail, final = false, statusIcon,
}: {
  title: string;
  icon: GlyphName;
  onPress: () => void;
  detail?: string | null;
  final?: boolean;
  statusIcon?: GlyphName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.rowPressed]}
    >
      <View style={styles.menuGlyph}><PremiumGlyph kind={icon} size={34}/></View>
      <Text style={styles.menuLabel} numberOfLines={1}>{title}</Text>
      {statusIcon ? <View style={styles.statusIcon}><PremiumGlyph kind={statusIcon} size={19}/></View> : null}
      {detail != null ? <Text style={styles.menuDetail} numberOfLines={1}>{detail}</Text> : null}
      <PremiumGlyph kind="arrow" size={21}/>
      {!final && <View style={styles.divider}/>}
    </Pressable>
  );
});

function PremiumProfileMenuScreen(props: VeePremiumProfileMenuProps) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <LinearGradient colors={['#F0E3FF', '#F8F5FD', '#F7F3FD']} style={styles.hero}>
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
            <Path d="M-40 260 C120 120 220 400 460 100" stroke="#CDB1F0" strokeWidth={1.4} fill="none" opacity={0.36}/>
            <Path d="M-60 275 C100 170 250 360 470 155" stroke="#FFFFFF" strokeWidth={2} fill="none" opacity={0.85}/>
            <Circle cx={340} cy={65} r={115} fill="#DECAFC" opacity={0.22}/>
          </Svg>
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={props.onBack} style={styles.topHit}>
              <PremiumGlyph kind="back" size={30}/>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} onPress={props.onSettings} style={styles.topHit}>
              <PremiumGlyph kind="settings" size={28}/>
            </Pressable>
          </View>
          <View style={styles.identity}>
            <Pressable accessibilityRole="button" accessibilityLabel="View profile photo" onPress={props.onProfilePhoto} style={styles.avatarBorder}>
              <View style={styles.avatarInner}>
                {props.photoUrl ? (
                  <Image source={{ uri: props.photoUrl }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" transition={0}/>
                ) : (
                  <View style={styles.avatarFallback}><PremiumGlyph kind="person" size={50}/></View>
                )}
              </View>
            </Pressable>
            <View style={styles.identityInfo}>
              <Text style={styles.profileName} numberOfLines={1}>{valueOrPlaceholder(props.displayName)}</Text>
              <View style={styles.chipLine}>
                <SmallChip icon="star" text={valueOrPlaceholder(props.followersLabel) + ' Followers'} onPress={props.onFollowers}/>
                {props.ageLabel ? <SmallChip icon={props.gender === 'female' ? 'female' : props.gender === 'male' ? 'male' : 'person'} text={props.ageLabel}/> : null}
              </View>
              {props.countryLabel ? (
                <View style={styles.countryLine}><SmallChip icon="location" text={props.countryLabel}/></View>
              ) : null}
            </View>
          </View>
        </LinearGradient>

        <Pressable accessibilityRole="button" accessibilityLabel="Task Center" onPress={props.onTaskCenter} style={({ pressed }) => [styles.taskOuter, pressed && styles.rowPressed]}>
          <LinearGradient colors={['#7D3BCB', '#58218E', '#3B165E']} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.taskCard}>
            <View style={styles.taskIcon}><PremiumGlyph kind="task" size={40}/></View>
            <View style={styles.taskText}>
              <Text style={styles.taskTitle}>Task Center</Text>
              <Text style={styles.taskSubtitle} numberOfLines={2}>Complete tasks to get great rewards!</Text>
            </View>
            <PremiumGlyph kind="arrow" size={23}/>
          </LinearGradient>
        </Pressable>

        <View style={styles.menuCard}>
          <MenuRow title="My Diamonds" icon="diamond" detail={valueOrPlaceholder(props.diamondBalanceLabel)} onPress={props.onDiamonds}/>
          <MenuRow title="Achievement" icon="achievement" detail={valueOrPlaceholder(props.achievementLabel)} onPress={props.onAchievement}/>
          <MenuRow title="SVIP" icon="svip" onPress={props.onSvip}/>
          <MenuRow title="Noble" icon="noble" detail={valueOrPlaceholder(props.nobleRankLabel)} onPress={props.onNoble}/>
          <MenuRow title="Privilege Decoration" icon="decoration" statusIcon="star" onPress={props.onDecoration}/>
          <MenuRow title="Gift Wall" icon="gift" detail={valueOrPlaceholder(props.giftCountLabel)} onPress={props.onGiftWall} final/>
        </View>

        <View style={styles.menuCard}>
          <MenuRow title="Rank" icon="rank" onPress={props.onRank}/>
          <MenuRow title="My Event" icon="event" onPress={props.onMyEvent} final/>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: P.base },
  scrollContent: { paddingBottom: 36 },
  // 2026-11-02 (boss polish: no empty top spaces): hero fits its content
  // (topBar 66 + identity marginTop 28 + identity ~100 + ~30 bottom pad);
  // the old 304 left a ~110px dead band under the identity row.
  hero: { height: 224, overflow: 'hidden' },
  topBar: { height: 66, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  identity: { flexDirection: 'row', marginHorizontal: 22, alignItems: 'center', marginTop: 28 },
  avatarBorder: { width: 100, height: 100, padding: 3, borderRadius: 50, backgroundColor: '#E7B652', borderWidth: 2, borderColor: '#FFF6D7' },
  avatarInner: { flex: 1, overflow: 'hidden', borderRadius: 46, backgroundColor: '#E9D9F8' },
  avatar: { width: '100%', height: '100%' },
  avatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  identityInfo: { marginLeft: 13, flex: 1, minWidth: 0 },
  profileName: { color: P.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.7, marginBottom: 7 },
  chipLine: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  countryLine: { marginTop: 7, alignSelf: 'flex-start' },
  chip: { backgroundColor: 'rgba(255,255,255,0.77)', borderWidth: 1, borderColor: '#E8DDF6', paddingHorizontal: 9, height: 28, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipText: { color: P.ink, fontSize: 12.5, fontWeight: '400', flexShrink: 1 },
  taskOuter: { marginTop: -15, marginHorizontal: 16, borderRadius: 22, elevation: 3, shadowColor: '#412361', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: {width:0,height:3} },
  taskCard: { minHeight: 106, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#9E69D9' },
  taskIcon: { width: 49, marginRight: 9 },
  taskText: { flex: 1, minWidth: 0 },
  taskTitle: { color: '#FFE7AD', fontWeight: '700', fontSize: 21, fontStyle: 'italic' },
  taskSubtitle: { color: '#F4E8FF', fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  menuCard: { marginHorizontal: 16, marginTop: 17, borderRadius: 22, backgroundColor: P.white, borderWidth: 1, borderColor: '#EEE6F6', overflow: 'hidden', elevation: 2, shadowColor: '#3D205D', shadowOpacity: 0.07, shadowRadius: 7, shadowOffset:{width:0,height:2} },
  menuRow: { height: 65, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  rowPressed: { opacity: 0.78 },
  menuGlyph: { width: 43, marginRight: 6, alignItems: 'flex-start', justifyContent: 'center' },
  menuLabel: { color: P.ink, flex: 1, minWidth: 0, fontSize: 16.5, fontWeight: '700' },
  menuDetail: { color: P.muted, marginLeft: 5, marginRight: 4, fontSize: 13.5, fontWeight: '400', maxWidth: 98 },
  statusIcon: { marginRight: 6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: P.border, position: 'absolute', bottom: 0, right: 16, left: 18 },
});

export default memo(PremiumProfileMenuScreen);
