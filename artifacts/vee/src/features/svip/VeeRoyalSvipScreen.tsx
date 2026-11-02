/**
 * Vee Royal SVIP — review-approved Snake/Dragon design, UI only.
 *
 * Source of truth: host's existing svip_config, svip_design, membership
 * subscription and waitlist service. No Firebase / wallet / navigation here.
 * Replace the live screen only after Muse verifies asset URLs and navigation.
 *
 * Pure UI: no new dependencies, no purchases, no simulated activations.
 */
import React, { memo, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

type PrivilegeKey = 'badge' | 'nameplate' | 'entryEffect' | 'antiKick' | 'kickOut';

export interface VeeSvipTier {
  tier: number;
  name: string;
  color?: string;
  priceDiamonds: number;
  durationDays: number;
}

export interface VeeSvipPrivilege {
  key: PrivilegeKey;
  name: string;
  minTier: number;
  enforced?: boolean;
}

export interface VeeSvipDesignAssets {
  /** Host resolves the SERVER's art URLs (svip_design), falling back to existing live art. */
  emblemUrls?: Partial<Record<number, string>>;
  /** Static tier badges; never animate these. */
  badgeUrls?: Partial<Record<number, string>>;
  /** Static approved dragon frame overlays, NOT an added entitlement. */
  frameUrls?: Partial<Record<number, string>>;
  nameplateUrls?: Partial<Record<number, string>>;
  privilegeUrls?: Partial<Record<PrivilegeKey, string>>;
}

export interface VeeRoyalSvipProps {
  tiers: ReadonlyArray<VeeSvipTier>;
  privileges: ReadonlyArray<VeeSvipPrivilege>;
  assets: VeeSvipDesignAssets;
  activeTier?: number | null;
  validUntilLabel?: string | null;
  isWaitlisted: boolean;
  isJoining: boolean;
  onBack: () => void;
  onJoinWaitlist: () => void;
  /** Optional: host-approved one-shot preview. NEVER auto-loop. */
  onPreviewEntryEffect?: (tier: number) => void;
}

const C = {
  bg: '#130D31',
  surface: '#20133F',
  surface2: '#2A194B',
  gold: '#E8B84B',
  cream: '#FFE6AA',
  white: '#FCF8FF',
  muted: '#B6AACD',
  divider: 'rgba(232,184,75,0.21)',
};
const tierAccents: Record<number, string> = {
  1: '#C6A4EA',
  2: '#69B8FF',
  3: '#B673FF',
  4: '#E8B84B',
  5: '#FF8A55',
};
function numeral(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : 'PLACEHOLDER';
}
function Icon({ kind, size = 22, color = C.gold }: { kind: PrivilegeKey | 'back' | 'arrow' | 'diamond' | 'lock'; size?: number; color?: string }) {
  if (kind === 'diamond') return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M7 15L13 7H27L33 15L20 34Z" fill="#EC4899" stroke="#FFD2EC" strokeWidth={1.2} />
      <Path d="M7 15H33L20 34L14 15L20 7L26 15" stroke="#FFEAF6" strokeWidth={1.25} fill="none" />
      <Path d="M14 15L20 34L26 15" fill="#DB2777" opacity={0.7}/>
    </Svg>
  );
  if (kind === 'back') return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M19 6L9 16L19 26M10 16H28" stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  if (kind === 'arrow') return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M12 6L22 16L12 26" stroke={color} strokeWidth={2.3} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  if (kind === 'lock') return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M9 13V10A7 7 0 0 1 23 10V13M7 13H25V28H7Z" stroke={color} fill="none" strokeWidth={2} strokeLinejoin="round"/><Circle cx={16} cy={20} r={1.8} fill={color}/></Svg>;
  if (kind === 'badge') return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M6 10L13 17L20 6L27 17L34 10L30 29H10Z" stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round"/><Path d="M11 33H29" stroke={color} strokeWidth={2}/></Svg>;
  if (kind === 'nameplate') return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M5 13H35V28H5Z" stroke={color} strokeWidth={2} fill="none"/><Path d="M11 20H29M16 8L20 5L24 8" stroke={color} strokeWidth={2}/></Svg>;
  if (kind === 'entryEffect') return <Svg width={size} height={size} viewBox="0 0 40 40"><Circle cx={20} cy={26} r={11} stroke={color} strokeWidth={2} fill="none"/><Path d="M20 2V14M15 9L20 3L25 9M4 13L12 17M36 13L28 17" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round"/></Svg>;
  if (kind === 'antiKick') return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M20 4L33 10V19C33 28 27 33 20 37C13 33 7 28 7 19V10Z" stroke={color} strokeWidth={2} fill="none"/><Path d="M13 21L18 26L27 15" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round"/></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M6 20H30M24 12L33 20L24 28M8 9V31" stroke={color} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round"/></Svg>;
}

const PrivilegeCard = memo(function PrivilegeCard({ item, tier, imageUrl }: {
  item: VeeSvipPrivilege; tier: number; imageUrl?: string;
}) {
  const unlockedForTier = tier >= item.minTier; // design tier, NOT user's entitlement
  return (
    <View style={[styles.privilege, !unlockedForTier && styles.locked]} accessible accessibilityLabel={item.name + (unlockedForTier ? ' included in tier' : ' starts at SVIP ' + item.minTier)}>
      <View style={styles.privilegeArt}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.privilegeImage} contentFit="contain" cachePolicy="memory-disk" transition={0} /> :
          <Icon kind={item.key} size={29} color={unlockedForTier ? C.gold : C.muted} />}
      </View>
      <Text style={styles.privilegeName} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.privilegeStatus}>{unlockedForTier ? 'Included' : 'SVIP ' + item.minTier + '+'}</Text>
    </View>
  );
});

function VeeRoyalSvipScreen({
  tiers, privileges, assets, activeTier, validUntilLabel,
  isWaitlisted, isJoining, onBack, onJoinWaitlist, onPreviewEntryEffect,
}: VeeRoyalSvipProps) {
  const [selectedTier, setSelectedTier] = useState(1);
  const selected = useMemo(() => tiers.find(t => t.tier === selectedTier) ?? tiers[0], [tiers, selectedTier]);
  if (!selected) {
    return (
      <SafeAreaView style={styles.safe}>
        <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.emptyText}>Back</Text></Pressable>
        <Text style={styles.emptyText}>SVIP details unavailable</Text>
      </SafeAreaView>
    );
  }
  const tier = selected.tier;
  const accent = tierAccents[tier] ?? C.gold;
  const emblem = assets.emblemUrls?.[tier];
  const frame = assets.frameUrls?.[tier];
  const badge = assets.badgeUrls?.[tier];
  const nameplate = assets.nameplateUrls?.[tier];
  const isActive = typeof activeTier === 'number' && activeTier > 0;
  const artReady = Boolean(emblem || frame || badge);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient colors={['#241445', C.bg, '#100B29']} style={styles.fill}>
        <View style={styles.nav}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}><Icon kind="back" size={25} color={C.white}/></Pressable>
          <Text style={styles.navTitle}>SVIP Center</Text>
          {isActive ? <Text style={styles.activePill}>SVIP {activeTier} ACTIVE</Text> : <View style={styles.pillSpacer} />}
        </View>
        <View style={styles.tabs}>
          {tiers.map(t => {
            const chosen = t.tier === tier;
            return <Pressable key={t.tier} accessibilityRole="tab" accessibilityState={{ selected: chosen }}
              onPress={() => setSelectedTier(t.tier)} style={[styles.tab, chosen && styles.tabSelected]}>
              <Text style={[styles.tabLabel, chosen && styles.tabTextSelected]}>S{t.tier}</Text>
            </Pressable>;
          })}
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroller}>
          <View style={styles.hero}>
            <View style={styles.auraOuter}><View style={[styles.auraInner, { borderColor: accent + '88' }]} /></View>
            {emblem ? <Image source={{ uri: emblem }} style={styles.emblem} contentFit="contain" cachePolicy="memory-disk" transition={0}/> :
              frame ? <Image source={{ uri: frame }} style={styles.emblem} contentFit="contain" cachePolicy="memory-disk" transition={0}/> :
              <View style={styles.emblemFallback}><Text style={styles.artPending}>ART PLACEHOLDER</Text></View>}
            <Text style={styles.tierTitle}>{selected.name}</Text>
            {isActive && activeTier === tier && validUntilLabel ?
              <Text style={styles.validUntil}>Valid until {validUntilLabel}</Text> : null}
            <Text style={[styles.tierRule, { color: accent }]}>ROYAL • SNAKE–DRAGON</Text>
          </View>
          {artReady && (frame || badge || nameplate) ? (
            <View style={styles.visuals}>
              {badge ? <View style={styles.visualCell}><Image source={{ uri: badge }} style={styles.visualImage} contentFit="contain" cachePolicy="memory-disk" transition={0}/><Text style={styles.visualLabel}>Badge</Text></View> : null}
              {frame ? <View style={styles.visualCell}><Image source={{ uri: frame }} style={styles.visualImage} contentFit="contain" cachePolicy="memory-disk" transition={0}/><Text style={styles.visualLabel}>Dragon Frame Art</Text></View> : null}
              {nameplate ? <View style={styles.visualCell}><Image source={{ uri: nameplate }} style={styles.visualImage} contentFit="contain" cachePolicy="memory-disk" transition={0}/><Text style={styles.visualLabel}>Nameplate</Text></View> : null}
            </View>
          ) : null}
          <View style={styles.sectionHead}><View style={styles.headLine}/><Text style={styles.sectionTitle}>Privileges</Text><View style={styles.headLine}/></View>
          <View style={styles.privilegeGrid}>
            {privileges.filter(p => ['badge', 'nameplate', 'entryEffect', 'antiKick', 'kickOut'].includes(p.key)).map(p => (
              <PrivilegeCard key={p.key} item={p} tier={tier} imageUrl={assets.privilegeUrls?.[p.key]}/>
            ))}
          </View>
          {/* No preview action without a host-supplied approved one-shot effect. */}
          {onPreviewEntryEffect && tier >= 2 ? (
            <Pressable style={styles.preview} accessibilityRole="button" onPress={() => onPreviewEntryEffect(tier)}>
              <Text style={styles.previewText}>Preview Entry Effect</Text><Icon kind="arrow" size={15}/>
            </Pressable>
          ) : null}
          <View style={styles.footer}>
            <View style={styles.priceRow}><Icon kind="diamond" size={22}/><Text style={styles.priceText}>{numeral(selected.priceDiamonds)}</Text><Text style={styles.duration}> / {selected.durationDays} DAYS</Text></View>
            {isActive ? <View style={styles.stateBox}><Text style={styles.stateText}>You are SVIP {activeTier}</Text></View> :
              <Pressable disabled={isWaitlisted || isJoining} accessibilityRole="button" onPress={onJoinWaitlist}
                style={[styles.join, (isWaitlisted || isJoining) && styles.joinDisabled]}>
                <LinearGradient colors={['#F7D98F','#E8B84B','#C99134']} style={styles.joinInner}>
                  <Text style={styles.joinText}>{isJoining ? 'Joining…' : isWaitlisted ? 'You are on the waitlist' : 'Join SVIP Waitlist'}</Text>
                </LinearGradient>
              </Pressable>}
            {!isActive && <Text style={styles.purchaseNote}>Diamond purchase is not available yet.</Text>}
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg}, fill:{flex:1},
  nav:{height:58,flexDirection:'row',alignItems:'center',paddingHorizontal:16},
  back:{width:40,height:42,alignItems:'center',justifyContent:'center'},
  navTitle:{flex:1,fontSize:21,fontWeight:'800',color:C.white,marginLeft:5},
  activePill:{fontSize:10,color:C.bg,backgroundColor:C.gold,overflow:'hidden',borderRadius:12,paddingHorizontal:9,paddingVertical:6,fontWeight:'800'},
  pillSpacer:{width:6},
  tabs:{flexDirection:'row',marginHorizontal:16,gap:6,marginBottom:4},
  tab:{flex:1,borderWidth:1,borderColor:'#51416E',borderRadius:12,paddingVertical:10,alignItems:'center',backgroundColor:'#24183F'},
  tabSelected:{backgroundColor:'#38245F',borderColor:C.gold},
  tabLabel:{fontSize:13,fontWeight:'700',color:C.muted}, tabTextSelected:{color:C.gold},
  scroller:{paddingBottom:26},
  hero:{alignItems:'center',paddingTop:10,paddingBottom:7},
  auraOuter:{position:'absolute',top:20,width:265,height:265,borderRadius:133,backgroundColor:'rgba(135,57,197,0.07)',alignItems:'center',justifyContent:'center'},
  auraInner:{width:245,height:245,borderRadius:123,borderWidth:1},
  emblem:{width:286,height:286},
  emblemFallback:{width:286,height:286,alignItems:'center',justifyContent:'center',borderRadius:143},
  artPending:{fontSize:12,color:C.muted,letterSpacing:2},
  tierTitle:{color:C.white,fontWeight:'900',fontSize:26,marginTop:-3},
  validUntil:{color:C.muted,fontSize:12,marginTop:4},
  tierRule:{fontSize:10,fontWeight:'700',letterSpacing:2.1,marginTop:7},
  visuals:{flexDirection:'row',justifyContent:'center',alignItems:'flex-start',gap:14,paddingTop:12,paddingBottom:8,paddingHorizontal:12},
  visualCell:{alignItems:'center',maxWidth:109},
  visualImage:{width:91,height:91},
  visualLabel:{color:C.muted,fontSize:10,marginTop:4,textAlign:'center'},
  sectionHead:{flexDirection:'row',alignItems:'center',gap:13,paddingHorizontal:20,marginTop:18,marginBottom:15},
  headLine:{height:StyleSheet.hairlineWidth,backgroundColor:C.divider,flex:1},
  sectionTitle:{color:C.cream,fontWeight:'800',fontSize:17},
  privilegeGrid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',paddingHorizontal:10,gap:9},
  privilege:{width:'30.5%',minHeight:123,borderWidth:1,borderColor:C.divider,backgroundColor:C.surface,borderRadius:15,paddingHorizontal:5,paddingVertical:12,alignItems:'center'},
  locked:{opacity:0.55},
  privilegeArt:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  privilegeImage:{width:44,height:44},
  privilegeName:{fontSize:11,color:C.white,fontWeight:'700',textAlign:'center',lineHeight:15,minHeight:30,marginTop:4},
  privilegeStatus:{fontSize:10,color:C.gold,marginTop:3},
  preview:{alignSelf:'center',marginTop:15,flexDirection:'row',gap:6,alignItems:'center',padding:9},
  previewText:{fontSize:12,color:C.gold,fontWeight:'600'},
  footer:{marginHorizontal:18,marginTop:22,paddingTop:18,borderTopWidth:1,borderTopColor:C.divider,alignItems:'center'},
  priceRow:{flexDirection:'row',alignItems:'center',justifyContent:'center'},
  priceText:{color:C.white,fontSize:23,fontWeight:'800',marginLeft:8},
  duration:{color:C.muted,fontSize:12},
  join:{marginTop:14,width:'100%',borderRadius:25,overflow:'hidden'},
  joinDisabled:{opacity:0.6},
  joinInner:{height:51,alignItems:'center',justifyContent:'center'},
  joinText:{fontSize:16,color:'#28183D',fontWeight:'800'},
  stateBox:{marginTop:14,backgroundColor:'#273C32',borderRadius:14,width:'100%',padding:14,alignItems:'center'},
  stateText:{color:'#B5E8C0',fontWeight:'700'},
  purchaseNote:{fontSize:11,color:C.muted,textAlign:'center',marginTop:10},
  emptyText:{color:C.white,padding:18},
});
export default memo(VeeRoyalSvipScreen);
