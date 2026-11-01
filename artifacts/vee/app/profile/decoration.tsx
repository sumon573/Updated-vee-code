/**
 * Profile — Decoration Screen (2026-10-15, Sumon).
 *
 * LUXURY unified collection: Frames | Nameplates | Ripples | Entry FX
 * - Shows ONLY owned items (no badges — badges live in Honor section)
 * - Tap to equip, "✓ USING" indicator on active item
 * - Nobel rewards auto-grant on rank-up (healMissingNobleItems)
 * - Store button at bottom for discovering/buying new items
 *
 * Light mode only. All data is real — no demo content.
 *
 * 2026-10-19: restyled to IMO Me-tab design language (#F4F5F5 bg, white
 * cards, 56dp title bar). Item rows are white cards with gold accents.
 * 2026-10-31 (boss): Nobel tab removed from Decoration (Nobel page now opens
 * from the profile nameplate); noble rank plates auto-use, no remove option.
 */
import { useEffect, useState } from 'react';
import { checkNobleMaintenance, NOBLE_RANKS, nobleThemeFor } from '@/src/services/nobleService';
import { View, Text, ScrollView, Pressable, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, VeeUser } from '@/src/services/userService';
import {
  subscribeFrames,
  subscribeNameplates,
  subscribeRipples,
  subscribeEntryEffects,
  formatObtainedDate,
  formatValidity,
  type GrantedFrame,
  type GrantedNameplate,
  type GrantedRipple,
  type GrantedEntryEffect } from '@/src/services/badgeService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import * as Haptics from 'expo-haptics';
import AnimatedFrame from '@/src/components/AnimatedFrame';

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
  gold: '#D4AF37',
  goldDark: '#B8860B',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  errorBg: '#FDECEA',
  errorText: '#B3261E',
  success: '#4CAF50',
  successBg: '#E8F5E9' } as const;

// ─── IMO title bar: 56dp, back ‹ left, centered 17sp semibold, no gear ───
function TitleBar({ title }: { title: string }) {
  return (
    <View style={{ height: 56, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
        <Feather name="chevron-left" size={24} color={C.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

type TabKey = 'frames' | 'nameplates' | 'ripples' | 'entryfx';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'frames', label: 'Frames', icon: '🖼️' },
  { key: 'nameplates', label: 'Nameplates', icon: '📛' },
  { key: 'ripples', label: 'Ripples', icon: '🌊' },
  { key: 'entryfx', label: 'Entry FX', icon: '✨' },
];

import MistNameplate from '@/src/components/MistNameplate';
import { getActiveCatalog, resolveGrantedArt } from '@/src/services/nobleRewardsCatalog';
import { NobleStarPill } from '@/src/components/NobleStarPill';

/** Lighten a hex color - second stop of the pill gradient (same helper as profile's PremiumPill). */
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

function ItemIcon({ icon: storedIcon, frameId, frameName, itemId }: { icon: string; frameId?: string; frameName?: string; itemId?: string }) {
  // 2026-10-16: Hooks must be at top level — before any early returns
  const [imgError, setImgError] = useState(false);
  // 2026-10-24 (Sumon): NEVER a demo picture — if the grant's stored icon is
  // a stale fallback emoji but the (server-driven) catalog has the item's
  // real design, show the design. See resolveGrantedArt.
  const icon = resolveGrantedArt(itemId, storedIcon);
  const isOfficial = (frameId || '').toLowerCase().includes('official') ||
    (frameName || '').toLowerCase().includes('official');
  if (isOfficial) {
    return (
      <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#E3F2FD' }} />
        <View style={{ position: 'absolute' }}>
          <AnimatedFrame size={36} frameId={frameId} />
        </View>
      </View>
    );
  }
  /* 2026-10-15 (Sumon): Mist animation for Viscount+ nameplates */
  if (itemId && /^https?:\/\//i.test(icon)) {
    const mistEntry = getActiveCatalog().find((r) => `noble-plate-${r.rankKey}` === itemId);
    const mistColor = mistEntry?.nameplate.mistColor;
    if (mistColor) {
      return <MistNameplate imageUrl={icon} mistColor={mistColor} width={100} height={34} />;
    }
  }

  /* 2026-10-30 (boss): noble-plate thumbnails show the short pill, not the
     squeezed banner image - the plate art is 5:1, the tile is square. The
     pill hugs icon + text (row title is flex:1, so long ranks like ROYAL
     DUKE stay fully visible instead of clipping out of a fixed 44px slot). */
  if (itemId && itemId.startsWith('noble-plate-')) {
    const rankIndex = NOBLE_RANKS.findIndex((r) => r.key === itemId.slice('noble-plate-'.length));
    if (rankIndex >= 0) {
      const rank = NOBLE_RANKS[rankIndex];
      const entryIcon = nobleThemeFor(rankIndex)?.entryIcon;
      return (
        <LinearGradient
          colors={[rank.color, lightenHex(rank.color, 60)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ height: 20, borderRadius: 10, paddingHorizontal: rank.key === 'viscount' ? 5 : rank.key === 'knight' ? 7 : 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
        >
          {entryIcon ? <Text style={{ fontSize: 12, marginRight: 3 }}>{entryIcon}</Text> : null}
          <Text style={{ fontSize: rank.key === 'viscount' ? 9 : 11, fontWeight: '700', color: '#FFFFFF' }} numberOfLines={1}>{rank.name.toUpperCase()}</Text>
        </LinearGradient>
      );
    }
  }
  if (/^https?:\/\//i.test(icon) && !/\.mp4$/i.test(icon)) {
    const isFrame = itemId?.includes('frame-');
    // 2026-10-24 (Sumon, NO-DEMO law): noble art is animated WebP — only
    // expo-image decodes it (RN Image failed → demo emoji showed). Rendered
    // via expo-image now; if a load still fails, show a clean empty tile —
    // NEVER a demo emoji.
    // 2026-10-15 (Sumon): Frames show as SQUARE (not circle) — full design visible
    return (
      <View style={{
        width: isFrame ? 52 : 44, height: isFrame ? 52 : 44,
        borderRadius: isFrame ? 8 : 22,
        backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {!imgError ? (
          <Image
            source={{ uri: icon }}
            style={{ width: isFrame ? 52 : 44, height: isFrame ? 52 : 44, position: 'absolute' }}
            contentFit="contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={{ width: isFrame ? 52 : 44, height: isFrame ? 52 : 44, backgroundColor: C.tile }} />
        )}
      </View>
    );
  }
  return <Text style={{ fontSize: 40 }}>{icon}</Text>;
}

function LuxuryEmptyState({ tab }: { tab: TabKey }) {
  const config = {
    frames: { icon: '🖼️', title: 'Your Collection Awaits', subtitle: 'Exclusive Frames', desc: 'Prestigious frames are granted officially or earned as event rewards.' },
    nameplates: { icon: '📛', title: 'No Nameplates Yet', subtitle: 'Nameplates', desc: 'Earn nameplates through Nobel ranks and special events.' },
    ripples: { icon: '🌊', title: 'No Ripples Yet', subtitle: 'Sound Ripples', desc: 'Unlock speaking ripples from Nobel ranks and events.' },
    entryfx: { icon: '✨', title: 'No Entry Effects Yet', subtitle: 'Entry Effects', desc: 'Make a grand entrance — unlock effects from Nobel and events.' },
  }[tab];

  return (
    <View style={{ flex: 1, alignItems: 'center', paddingTop: 64, paddingHorizontal: 40 }}>
      <View style={{ width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
        <View style={{
          position: 'absolute', width: 140, height: 140, borderRadius: 28,
          backgroundColor: C.gold + '18',
          shadowColor: C.gold, shadowOpacity: 0.35, shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 }, elevation: 10 }} />
        <View style={{
          width: 104, height: 104, borderRadius: 20,
          backgroundColor: '#FFFDF5',
          borderWidth: 5, borderColor: C.gold,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.goldDark, shadowOpacity: 0.3, shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
          <View style={{
            width: 84, height: 84, borderRadius: 14,
            borderWidth: 2, borderColor: C.goldBorder,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#FFFEF9' }}>
            <Text style={{ fontSize: 36 }}>{config.icon}</Text>
          </View>
        </View>
        <Text style={{ position: 'absolute', top: 8, right: 18, fontSize: 16 }}>✨</Text>
        <Text style={{ position: 'absolute', bottom: 12, left: 14, fontSize: 12 }}>✨</Text>
      </View>
      <Text style={{ fontSize: 20, fontWeight: '800', color: '#1A1A1A', textAlign: 'center', letterSpacing: 0.5 }}>
        {config.title}
      </Text>
      <View style={{
        marginTop: 12, paddingHorizontal: 20, paddingVertical: 8,
        borderRadius: 20, backgroundColor: C.gold + '14',
        borderWidth: 1, borderColor: C.gold + '40' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: C.goldDark, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          ✦ {config.subtitle} ✦
        </Text>
      </View>
      <Text style={{ fontSize: 14, color: '#6B6B6B', textAlign: 'center', marginTop: 16, lineHeight: 22, paddingHorizontal: 32 }}>
        {config.desc} Your luxury collection begins here.
      </Text>
    </View>
  );
}

export default function DecorationScreen() {
  const { user } = useAuth();
  const { uid: paramUid } = useLocalSearchParams<{ uid?: string }>();
  const targetUid = paramUid ?? user?.uid;
  const isMe = !paramUid || paramUid === user?.uid;

  // 2026-10-16 (Sumon): Enforce 30-day Nobel maintenance on Decoration load.
  useEffect(() => {
    if (!isMe || !user?.uid) return;
    void (async () => {
      try { await checkNobleMaintenance(user.uid); } catch {}
    })();
  }, [isMe, user?.uid]);
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [frames, setFrames] = useState<GrantedFrame[]>([]);
  const [nameplates, setNameplates] = useState<GrantedNameplate[]>([]);
  const [ripples, setRipples] = useState<GrantedRipple[]>([]);
  const [entryEffects, setEntryEffects] = useState<GrantedEntryEffect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('frames'); // 2026-10-31 (boss): Nobel tab removed; Frames is first

  useEffect(() => {
    if (!targetUid) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    let done = { profile: false, frames: false, plates: false, ripples: false, effects: false };
    const maybeDone = () => {
      if (done.profile && done.frames && done.plates && done.ripples && done.effects) setLoading(false);
    };
    const mark = (k: keyof typeof done) => { done[k] = true; maybeDone(); };

    const unsubProfile = subscribeUser(targetUid, (u) => { setProfile(u); mark('profile'); });
    const subs: (() => void)[] = [];
    try {
      subs.push(subscribeFrames(targetUid, (f) => { setFrames(f); mark('frames'); }));
      subs.push(subscribeNameplates(targetUid, (p) => { setNameplates(p); mark('plates'); }));
      subs.push(subscribeRipples(targetUid, (r) => { setRipples(r); mark('ripples'); }));
      subs.push(subscribeEntryEffects(targetUid, (e) => { setEntryEffects(e); mark('effects'); }));
    } catch (e) {
      setError(`Could not load collection: ${getErrorCause(e)}`);
      (['frames', 'plates', 'ripples', 'effects'] as const).forEach(mark);
    }
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(timeout);
      unsubProfile();
      subs.forEach((u) => u());
    };
  }, [targetUid]);

  const handleEquip = async (field: 'activeFrame' | 'activeNameplate' | 'activeRipple' | 'activeEntryEffect', id: string) => {
    if (!isMe || !user?.uid) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateUser(user.uid, { [field]: id } as any);
    } catch (e) {
      setError(`Could not equip: ${getErrorCause(e)}`);
    }
  };

  const handleRemove = async (field: 'activeFrame' | 'activeNameplate' | 'activeRipple' | 'activeEntryEffect') => {
    if (!isMe || !user?.uid) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateUser(user.uid, { [field]: null as unknown as undefined } as any);
    } catch (e) {
      setError(`Could not remove: ${getErrorCause(e)}`);
    }
  };

  // 2026-10-31 (boss): noble plates auto-use — the current rank's plate is
  // ALWAYS in use on the profile; no remove option for it. Other items unchanged.
  const nobleRankKey = (() => {
    const ri = (profile as any)?.noble?.rankIndex;
    return typeof ri === 'number' && NOBLE_RANKS[ri] ? NOBLE_RANKS[ri].key : null;
  })();

  const renderItemRow = (
    item: { id: string; name: string; icon: string; obtainedAt: number; validity: 'permanent' | number; source: string },
    isActive: boolean,
    field: 'activeFrame' | 'activeNameplate' | 'activeRipple' | 'activeEntryEffect',
    sourceLabel: string,
  ) => {
    // 2026-10-31 (boss): current rank's noble plate counts as active even if
    // the pointer is stale (heal syncs it); its Remove button is hidden below.
    const isRankPlate = field === 'activeNameplate' && nobleRankKey && item.id === 'noble-plate-' + nobleRankKey;
    const showActive = isActive || isRankPlate;
    return (
    <View
      key={item.id}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 10,
        marginHorizontal: 15,
        borderWidth: showActive ? 2 : 0.5,
        borderColor: showActive ? C.gold : C.border,
        shadowColor: showActive ? C.gold : 'transparent',
        shadowOpacity: showActive ? 0.25 : 0,
        shadowRadius: showActive ? 12 : 0,
        shadowOffset: { width: 0, height: 4 },
        elevation: showActive ? 4 : 0 }}
    >
      <ItemIcon icon={item.icon} frameId={field === 'activeFrame' ? item.id : undefined} frameName={item.name} itemId={item.id} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, flexShrink: 1 }} numberOfLines={1}>{item.name}</Text>
          {item.source === 'noble' && (
            <View style={{ marginLeft: 8, backgroundColor: C.gold, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>NOBEL</Text>
            </View>
          )}
          <NobleStarPill grantId={item.id} />
        </View>
        <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          Obtained {formatObtainedDate(item.obtainedAt)} · {sourceLabel}
        </Text>
        {isMe && (
          <Text style={{ fontSize: 11, color: C.goldDark, marginTop: 2, fontWeight: '700' }}>
            {formatValidity(item.validity)}
          </Text>
        )}
      </View>
      {isMe ? (
        showActive ? (
          <View style={{ alignItems: 'center' }}>
            <View style={{ backgroundColor: C.successBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: C.success }}>✓ USING</Text>
            </View>
            {!isRankPlate && (
            <Pressable
              style={{ backgroundColor: C.errorBg, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
              onPress={() => handleRemove(field)}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.errorText }}>Remove</Text>
            </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
            onPress={() => handleEquip(field, item.id)}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Use</Text>
          </Pressable>
        )
      ) : showActive ? (
        <View style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Active</Text>
        </View>
      ) : null}
    </View>
    );
  };

  const renderTabContent = () => {

    const data = {
      frames: { items: frames, field: 'activeFrame' as const, active: profile?.activeFrame, label: 'Official' },
      nameplates: { items: nameplates, field: 'activeNameplate' as const, active: profile?.activeNameplate, label: 'Official' },
      ripples: { items: ripples, field: 'activeRipple' as const, active: (profile as any)?.activeRipple, label: 'Nobel' },
      entryfx: { items: entryEffects, field: 'activeEntryEffect' as const, active: (profile as any)?.activeEntryEffect, label: 'Nobel' },
    }[tab];

    if (data.items.length === 0) {
      return <LuxuryEmptyState tab={tab} />;
    }

    // Perf (2026-10-22 audit): virtualized list — the old ScrollView
    // mounted every owned item row at once.
    return (
      <FlatList
        data={data.items}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }: { item: any }) =>
          renderItemRow(item, data.active === item.id, data.field, item.source === 'noble' ? 'Nobel' : item.source === 'event' ? 'Event reward' : data.label)
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
        windowSize={9}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
      />
    );
  };

  const visibleTabs = TABS; // 2026-10-31 (boss): Nobel tab removed from Decoration

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title="Decoration" />

      {/* Luxury category tabs — scrollable */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' }}
        style={{ marginBottom: 8, flexGrow: 0 }}
      >
        {visibleTabs.map((t) => {
          const isActive = tab === t.key;
          const count = t.key === 'frames' ? frames.length
            : t.key === 'nameplates' ? nameplates.length
            : t.key === 'ripples' ? ripples.length
            : t.key === 'entryfx' ? entryEffects.length : 0;
          return (
            <Pressable
              key={t.key}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t.key); }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, marginRight: 8,
                height: 48, borderRadius: 24,
                backgroundColor: isActive ? C.gold : C.card,
                borderWidth: isActive ? 0 : 0.5,
                borderColor: C.border,
                shadowColor: isActive ? C.gold : 'transparent',
                shadowOpacity: isActive ? 0.3 : 0,
                shadowRadius: isActive ? 8 : 0,
                shadowOffset: { width: 0, height: 4 },
                elevation: isActive ? 3 : 0 }}
            >
              {t.key === 'frames' ? (
                <View style={{
                  width: 28, height: 28, borderRadius: 14, marginRight: 7,
                  backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1.5, borderColor: '#007AFF',
                }}>
                  <View style={{
                    width: 16, height: 16, borderRadius: 3,
                    borderWidth: 2, borderColor: '#007AFF',
                    backgroundColor: '#FFFFFF',
                  }}>
                    <View style={{
                      position: 'absolute', top: 2, left: 2, right: 2, bottom: 2,
                      backgroundColor: '#E3F2FD', borderRadius: 1,
                    }} />
                  </View>
                </View>
              ) : (
                <Text style={{ fontSize: 14, marginRight: 6 }}>{t.icon}</Text>
              )}
              <Text style={{ fontSize: 14, fontWeight: isActive ? '800' : '600', color: isActive ? '#fff' : C.text }}>
                {t.label}
              </Text>
              {count > 0 && (
                <View style={{
                  marginLeft: 6, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
                  backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : C.goldBg }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: isActive ? '#fff' : C.goldDark }}>
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {error && (
        <View style={{ backgroundColor: C.errorBg, paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 16, borderRadius: 10, marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: C.errorText }}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="large" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {renderTabContent()}
        </View>
      )}

      {/* Store button — bottom (2026-10-16, Sumon): polished white button,
          blue circle bag icon + "Store" — per his reference screenshot. */}
      {isMe && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: C.card, borderTopWidth: 0.5, borderTopColor: C.border }}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/store' as any); }}
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 13,
              paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 0.5, borderColor: C.border,
              shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14,
              shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
          >
            <View style={{
              width: 38, height: 38, borderRadius: 19, backgroundColor: C.blue,
              alignItems: 'center', justifyContent: 'center', marginRight: 10,
              shadowColor: C.blue, shadowOpacity: 0.35, shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
            }}>
              <Feather name="shopping-bag" size={19} color="#fff" />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#111111' }}>
              Store
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
