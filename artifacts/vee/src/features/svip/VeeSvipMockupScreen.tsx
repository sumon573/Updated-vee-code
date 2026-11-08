/**
 * VeeSvipMockupScreen — reproduces the GIVEN ChatGPT mockup
 * (selected-svip-design.png: Vee SVIP main + Details + Preview panels).
 *
 * UI only: no Firebase, wallet, navigation, timers, or animations.
 * All values come from props (server svip_config + svip_design via host).
 * All art is given art: the mockup's own hero crop (svip_design.hero),
 * the shipped dragon badges, and the live nameplate. Icons are the
 * draft's delivered SVG set, in gold. Nothing here is newly designed.
 * Static only — no entry-effect preview, no animation.
 * Join (2026-11-08, Full SVIP) buys the selected tier with wallet
 * diamonds; the host owns the purchase call and the waitlist fallback.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiamondIcon } from '@/src/components/DiamondIcon';

export type MockupPrivilegeKey = 'badge' | 'nameplate' | 'entryEffect' | 'antiKick' | 'kickOut';

export interface MockupTier {
  tier: number;
  name: string;
  priceDiamonds: number;
  durationDays: number;
}

export interface MockupPrivilege {
  key: MockupPrivilegeKey;
  minTier: number;
  enforced?: boolean;
}

export interface MockupAssets {
  hero?: string;
  badgeUrls?: Partial<Record<number, string>>;
  nameplateUrl?: string;
}

export interface VeeSvipMockupProps {
  tiers: ReadonlyArray<MockupTier>;
  privileges: ReadonlyArray<MockupPrivilege>;
  assets: MockupAssets;
  activeTier?: number | null;
  validUntilLabel?: string | null;
  isWaitlisted: boolean;
  isJoining: boolean;
  onBack: () => void;
  onJoin: () => void;
  onTierChange?: (tier: number) => void;
}

const GOLD = '#E8B84B';
const GOLD_SOFT = '#F5C451';
const LAVENDER = '#B9A8E8';
const MUTED = 'rgba(255,255,255,0.55)';
const CARD = '#2A1652';
const CARD_DARK = '#1E0E3E';

/** Display copy from the given mockup panels, keyed by privilege key. */
const PRIVILEGE_COPY: Record<MockupPrivilegeKey, { name: string; desc: string }> = {
  badge: { name: 'Membership Badge', desc: 'Exclusive SVIP badge in your profile' },
  nameplate: { name: 'Nameplate', desc: 'Premium nameplate in rooms & profile' },
  entryEffect: { name: 'Entry Effect', desc: 'Special entry effect when you join a room' },
  antiKick: { name: 'Anti-Kick', desc: 'Cannot be kicked by room host' },
  kickOut: { name: 'Kick-Out', desc: 'Remove users from the room' },
};

const PRIVILEGE_ORDER: MockupPrivilegeKey[] = ['badge', 'nameplate', 'entryEffect', 'antiKick', 'kickOut'];

function PrivIcon({ kind, size = 28, color = GOLD }: { kind: MockupPrivilegeKey; size?: number; color?: string }) {
  if (kind === 'badge') return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M6 10L13 17L20 6L27 17L34 10L30 29H10Z" stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" /><Path d="M11 33H29" stroke={color} strokeWidth={2} /></Svg>;
  if (kind === 'nameplate') return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M5 13H35V28H5Z" stroke={color} strokeWidth={2} fill="none" /><Path d="M11 20H29M16 8L20 5L24 8" stroke={color} strokeWidth={2} /></Svg>;
  if (kind === 'entryEffect') return <Svg width={size} height={size} viewBox="0 0 40 40"><Circle cx={20} cy={26} r={11} stroke={color} strokeWidth={2} fill="none" /><Path d="M20 2V14M15 9L20 3L25 9M4 13L12 17M36 13L28 17" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" /></Svg>;
  if (kind === 'antiKick') return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M20 4L33 10V19C33 28 27 33 20 37C13 33 7 28 7 19V10Z" stroke={color} strokeWidth={2} fill="none" /><Path d="M13 21L18 26L27 15" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" /></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 40 40"><Path d="M6 20H30M24 12L33 20L24 28M8 9V31" stroke={color} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function BackIcon({ size = 25, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M19 6L9 16L19 26M10 16H28" stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function CheckDot({ on, size = 26 }: { on: boolean; size?: number }) {
  if (!on) return <View style={[styles.checkDot, { borderColor: MUTED, backgroundColor: 'transparent' }]} />;
  return (
    <View style={[styles.checkDot, { borderColor: GOLD, backgroundColor: GOLD }]}>
      <Text style={styles.checkMark}>✓</Text>
    </View>
  );
}

function InfoNote({ text }: { text: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoCircle}><Text style={styles.infoLetter}>i</Text></View>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function PriceText({ n, size = 15 }: { n: number; size?: number }) {
  return (
    <View style={styles.priceRow}>
      <DiamondIcon size={size} />
      <Text style={[styles.priceText, { fontSize: size }]}>{n.toLocaleString('en-US')}</Text>
    </View>
  );
}

export default function VeeSvipMockupScreen({
  tiers, privileges, assets, activeTier, validUntilLabel,
  isWaitlisted, isJoining, onBack, onJoin, onTierChange,
}: VeeSvipMockupProps) {
  const [selectedTier, setSelectedTier] = useState(1);
  useEffect(() => { onTierChange?.(selectedTier); }, [selectedTier]);
  const [view, setView] = useState<'main' | 'details' | 'preview'>('main');
  const [detailsTab, setDetailsTab] = useState<'privileges' | 'facts'>('privileges');
  const selected = useMemo(() => tiers.find((t) => t.tier === selectedTier) ?? tiers[0], [tiers, selectedTier]);
  const ordered = useMemo(
    () => PRIVILEGE_ORDER.map((k) => privileges.find((p) => p.key === k)).filter((p): p is MockupPrivilege => !!p),
    [privileges],
  );
  if (!selected) {
    return (
      <SafeAreaView style={styles.safe}>
        <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.emptyText}>Back</Text></Pressable>
        <Text style={styles.emptyText}>SVIP details unavailable</Text>
      </SafeAreaView>
    );
  }
  const tier = selected.tier;
  const isActive = typeof activeTier === 'number' && activeTier > 0;
  const viewingOwnTier = isActive && activeTier === tier;
  const badge = assets.badgeUrls?.[tier];
  const hero = assets.hero ?? badge;

  const shieldRow = (
    <View style={styles.shields}>
      {tiers.map((t) => {
        const chosen = t.tier === tier;
        const url = assets.badgeUrls?.[t.tier];
        return (
          <Pressable key={t.tier} accessibilityRole="tab" accessibilityState={{ selected: chosen }}
            onPress={() => setSelectedTier(t.tier)} style={styles.shieldCell}>
            <View style={[styles.shieldRing, chosen && styles.shieldRingChosen]}>
              {url ? <Image source={{ uri: url }} style={styles.shieldImg} contentFit="contain" cachePolicy="memory-disk" transition={0} />
                : <View style={styles.shieldImg} />}
            </View>
            <Text style={[styles.shieldLabel, chosen && styles.shieldLabelChosen]}>S{t.tier}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const joinBlock = (
    <View>
      {viewingOwnTier ? (
        <View style={styles.activeBox}>
          <Text style={styles.activeText}>{selected.name} ACTIVE</Text>
          {validUntilLabel ? <Text style={styles.activeSub}>Valid until {validUntilLabel}</Text> : null}
        </View>
      ) : (
        <Pressable onPress={onJoin} disabled={isJoining || isWaitlisted} accessibilityRole="button"
          style={[styles.joinBtn, (isJoining || isWaitlisted) && styles.joinBtnDim]}>
          <Text style={styles.joinText}>{isJoining ? 'Processing…' : isWaitlisted ? 'You are on the waitlist' : 'Join Now'}</Text>
        </Pressable>
      )}
    </View>
  );

  const tabPills = (current: 'privileges' | 'preview' | 'facts') => (
    <View style={styles.pills}>
      <Pressable onPress={() => { setView('details'); setDetailsTab('privileges'); }} style={[styles.pill, current === 'privileges' && styles.pillGold]}>
        <Text style={[styles.pillText, current === 'privileges' && styles.pillTextGold]}>Privileges</Text>
      </Pressable>
      <Pressable onPress={() => setView('preview')} style={[styles.pill, current === 'preview' && styles.pillGold]}>
        <Text style={[styles.pillText, current === 'preview' && styles.pillTextGold]}>Preview</Text>
      </Pressable>
      <Pressable onPress={() => { setView('details'); setDetailsTab('facts'); }} style={[styles.pill, current === 'facts' && styles.pillGold]}>
        <Text style={[styles.pillText, current === 'facts' && styles.pillTextGold]}>Details</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient colors={['#2B1358', '#1A0B33']} style={styles.fill}>
        {view === 'main' ? (
          <>
            <View style={styles.nav}>
              <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}><BackIcon /></Pressable>
              <View style={styles.brandBlock}>
                <Text style={styles.brandSmall}>Vee</Text>
                <Text style={styles.brandBig}>Vee SVIP</Text>
                <Text style={styles.brandSub}>Exclusive Membership for Vee Family</Text>
              </View>
              <View style={styles.back} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroller}>
              {hero ? <Image source={{ uri: hero }} style={styles.hero} contentFit="cover" cachePolicy="memory-disk" transition={0} /> : null}
              {shieldRow}
              <View style={styles.tierCard}>
                <View>
                  <Text style={styles.tierName}>{selected.name}</Text>
                  <Text style={styles.tierDays}>{selected.durationDays} Days Membership</Text>
                </View>
                <View style={styles.pricePill}><PriceText n={selected.priceDiamonds} size={15} /></View>
              </View>
              <View style={styles.sectionHead}><View style={styles.headLine} /><Text style={styles.sectionTitle}>SVIP Privileges</Text><View style={styles.headLine} /></View>
              <View style={styles.privGrid}>
                {ordered.map((p) => (
                  <View key={p.key} style={styles.privCard}>
                    <PrivIcon kind={p.key} size={28} />
                    <Text style={styles.privLabel} numberOfLines={2}>{PRIVILEGE_COPY[p.key].name}</Text>
                  </View>
                ))}
              </View>
              {joinBlock}
            </ScrollView>
          </>
        ) : view === 'details' ? (
          <>
            <View style={styles.nav}>
              <Pressable onPress={() => setView('main')} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}><BackIcon /></Pressable>
              <Text style={styles.navTitle}>{selected.name} Details</Text>
              <View style={styles.back} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroller}>
              <View style={styles.detailHero}>
                <View style={styles.detailGlow}>
                  {badge ? <Image source={{ uri: badge }} style={styles.detailBadge} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
                </View>
                <Text style={styles.detailTier}>{selected.name}</Text>
                <Text style={styles.detailDays}>{selected.durationDays} Days Membership</Text>
              </View>
              {tabPills(detailsTab === 'facts' ? 'facts' : 'privileges')}
              {detailsTab === 'privileges' ? (
                <View style={styles.listCard}>
                  {ordered.map((p) => {
                    const unlocked = tier >= p.minTier;
                    const art = p.key === 'badge' ? badge : p.key === 'nameplate' ? assets.nameplateUrl : undefined;
                    return (
                      <View key={p.key} style={styles.listRow}>
                        <View style={styles.listIcon}>
                          {art ? <Image source={{ uri: art }} style={styles.listArt} contentFit="contain" cachePolicy="memory-disk" transition={0} />
                            : <PrivIcon kind={p.key} size={28} color={unlocked ? GOLD : MUTED} />}
                        </View>
                        <View style={styles.listText}>
                          <Text style={styles.listName}>{PRIVILEGE_COPY[p.key].name}</Text>
                          <Text style={styles.listDesc}>{PRIVILEGE_COPY[p.key].desc}</Text>
                        </View>
                        <CheckDot on={unlocked} />
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.listCard}>
                  <View style={styles.factRow}><Text style={styles.factLabel}>Price</Text><PriceText n={selected.priceDiamonds} size={15} /></View>
                  <View style={styles.factRow}><Text style={styles.factLabel}>Duration</Text><Text style={styles.factValue}>{selected.durationDays} Days</Text></View>
                  <View style={styles.factRow}><Text style={styles.factLabel}>Privileges</Text><Text style={styles.factValue}>{ordered.length} privileges</Text></View>
                  <View style={styles.factRow}><Text style={styles.factLabel}>Status</Text><Text style={styles.factValue}>{viewingOwnTier ? 'Active' : isWaitlisted ? 'On the waitlist' : 'Not a member'}</Text></View>
                </View>
              )}
              <View style={styles.bottomJoin}>
                <View style={styles.bottomPrice}><PriceText n={selected.priceDiamonds} size={16} /></View>
                {viewingOwnTier ? (
                  <View style={[styles.joinBtn, styles.joinBtnFlex, styles.joinBtnDim]}><Text style={styles.joinText}>{selected.name} ACTIVE</Text></View>
                ) : (
                  <Pressable onPress={onJoin} disabled={isJoining || isWaitlisted} accessibilityRole="button"
                    style={[styles.joinBtn, styles.joinBtnFlex, (isJoining || isWaitlisted) && styles.joinBtnDim]}>
                    <Text style={styles.joinText}>{isJoining ? 'Processing…' : isWaitlisted ? 'You are on the waitlist' : 'Join Now'}</Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>
          </>
        ) : (
          <>
            <View style={styles.nav}>
              <Pressable onPress={() => setView('main')} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}><BackIcon /></Pressable>
              <Text style={styles.navTitle}>{selected.name} Preview</Text>
              <View style={styles.back} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroller}>
              {shieldRow}
              {tabPills('preview')}
              <Text style={styles.previewSub}>See how your {selected.name} rewards will look in the app</Text>
              {ordered.map((p) => {
                const art = p.key === 'badge' ? badge : p.key === 'nameplate' ? assets.nameplateUrl : undefined;
                return (
                  <View key={p.key} style={styles.previewCard}>
                    <Text style={styles.previewLabel}>{PRIVILEGE_COPY[p.key].name}</Text>
                    {art ? <Image source={{ uri: art }} style={styles.previewArt} contentFit="contain" cachePolicy="memory-disk" transition={0} />
                      : <PrivIcon kind={p.key} size={44} />}
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1A0B33' },
  fill: { flex: 1 },
  emptyText: { color: '#FFFFFF', fontSize: 16, textAlign: 'center', marginTop: 24 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  brandBlock: { alignItems: 'center' },
  brandSmall: { color: GOLD, fontSize: 15, fontWeight: '800' },
  brandBig: { color: GOLD_SOFT, fontSize: 30, fontWeight: '800', letterSpacing: 0.5 },
  brandSub: { color: LAVENDER, fontSize: 12, marginTop: 2 },
  scroller: { paddingHorizontal: 16, paddingBottom: 28 },
  hero: { width: '100%', aspectRatio: 920 / 446, borderRadius: 14, marginTop: 6 },
  shields: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  shieldCell: { alignItems: 'center', flex: 1 },
  shieldRing: { width: 62, height: 62, borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  shieldRingChosen: { borderColor: GOLD },
  shieldImg: { width: 56, height: 56 },
  shieldLabel: { color: MUTED, fontSize: 13, fontWeight: '700', marginTop: 4 },
  shieldLabelChosen: { color: GOLD },
  tierCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderWidth: 1, borderColor: GOLD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginTop: 18 },
  tierName: { color: GOLD_SOFT, fontSize: 24, fontWeight: '800' },
  tierDays: { color: LAVENDER, fontSize: 12, marginTop: 2 },
  pricePill: { backgroundColor: CARD_DARK, borderWidth: 1, borderColor: GOLD, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  priceText: { color: '#FFFFFF', fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 12 },
  headLine: { flex: 1, height: 1, backgroundColor: 'rgba(232,184,75,0.5)' },
  sectionTitle: { color: GOLD_SOFT, fontSize: 17, fontWeight: '700', marginHorizontal: 10 },
  privGrid: { flexDirection: 'row', gap: 8 },
  privCard: { flex: 1, backgroundColor: CARD, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', gap: 6 },
  privLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '600', textAlign: 'center', lineHeight: 13 },
  joinBtn: { backgroundColor: GOLD, borderRadius: 24, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  joinBtnFlex: { flex: 1, marginTop: 0 },
  joinBtnDim: { opacity: 0.7 },
  joinText: { color: '#212121', fontSize: 17, fontWeight: '800' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  infoCircle: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: MUTED, alignItems: 'center', justifyContent: 'center' },
  infoLetter: { color: MUTED, fontSize: 10, fontWeight: '700' },
  infoText: { color: MUTED, fontSize: 12 },
  activeBox: { backgroundColor: 'rgba(129,199,132,0.12)', borderWidth: 1, borderColor: 'rgba(129,199,132,0.4)', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 20 },
  activeText: { color: '#81C784', fontSize: 15, fontWeight: '700' },
  activeSub: { color: MUTED, fontSize: 12, marginTop: 4 },
  detailHero: { alignItems: 'center', marginTop: 8 },
  detailGlow: { width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(232,184,75,0.12)', alignItems: 'center', justifyContent: 'center' },
  detailBadge: { width: 190, height: 190 },
  detailTier: { color: GOLD_SOFT, fontSize: 26, fontWeight: '800', marginTop: 10 },
  detailDays: { color: LAVENDER, fontSize: 13, marginTop: 2 },
  pills: { flexDirection: 'row', gap: 8, marginTop: 18 },
  pill: { flex: 1, backgroundColor: CARD, borderRadius: 20, paddingVertical: 9, alignItems: 'center' },
  pillGold: { backgroundColor: GOLD },
  pillText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  pillTextGold: { color: '#212121' },
  listCard: { backgroundColor: CARD, borderRadius: 14, marginTop: 14, paddingHorizontal: 14, paddingVertical: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  listIcon: { width: 48, alignItems: 'center', justifyContent: 'center' },
  listArt: { width: 44, height: 44 },
  listText: { flex: 1, marginLeft: 8 },
  listName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  listDesc: { color: MUTED, fontSize: 12, marginTop: 2 },
  checkDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#212121', fontSize: 15, fontWeight: '800' },
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  factLabel: { color: MUTED, fontSize: 14 },
  factValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  bottomJoin: { flexDirection: 'row', gap: 10, marginTop: 16, alignItems: 'center' },
  bottomPrice: { backgroundColor: CARD_DARK, borderWidth: 1, borderColor: GOLD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 11 },
  previewSub: { color: LAVENDER, fontSize: 12, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  previewCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderWidth: 1, borderColor: 'rgba(232,184,75,0.6)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginTop: 12, minHeight: 96 },
  previewLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  previewArt: { width: 76, height: 76 },
});
