/**
 * Profile — Decoration Screen (2026-10-15, Sumon).
 *
 * LUXURY unified collection: Nobel | Frames | Nameplates | Ripples | Entry FX
 * - Shows ONLY owned items (no badges — badges live in Honor section)
 * - Tap to equip, "✓ USING" indicator on active item
 * - Nobel rewards auto-grant on rank-up (healMissingNobleItems)
 * - Store button at bottom for discovering/buying new items
 *
 * Light mode only. All data is real — no demo content.
 */
import { useEffect, useState } from 'react';
import { checkNobleMaintenance } from '@/src/services/nobleService';
import { View, Text, ScrollView, Pressable, Image } from 'react-native';
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
import NobelScreen from '@/src/features/nobel/NobelScreen';
import AnimatedFrame from '@/src/components/AnimatedFrame';

const C = {
  bg: '#FFFFFF',
  card: '#F2F2F7',
  text: '#000000',
  muted: '#8E8E93',
  border: '#E5E5EA',
  blue: '#007AFF',
  blueLight: '#E3F2FF',
  gold: '#D4AF37',
  goldDark: '#B8860B',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  errorBg: '#FDECEA',
  errorText: '#B3261E',
  success: '#4CAF50',
  successBg: '#E8F5E9' } as const;

type TabKey = 'frames' | 'nameplates' | 'ripples' | 'entryfx' | 'nobel';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'nobel', label: 'Noble', icon: '♛' }, // 2026-10-16: custom orange button (special-cased below)
  { key: 'frames', label: 'Frames', icon: '🖼️' },
  { key: 'nameplates', label: 'Nameplates', icon: '📛' },
  { key: 'ripples', label: 'Ripples', icon: '🌊' },
  { key: 'entryfx', label: 'Entry FX', icon: '✨' },
];

import MistNameplate from '@/src/components/MistNameplate';
import { NOBLE_REWARDS_CATALOG } from '@/src/services/nobleRewardsCatalog';

function ItemIcon({ icon, frameId, frameName, itemId }: { icon: string; frameId?: string; frameName?: string; itemId?: string }) {
  // 2026-10-16: Hooks must be at top level — before any early returns
  const [imgError, setImgError] = useState(false);
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
    const mistEntry = NOBLE_REWARDS_CATALOG.find((r) => `noble-plate-${r.rankKey}` === itemId);
    const mistColor = mistEntry?.nameplate.mistColor;
    if (mistColor) {
      return <MistNameplate imageUrl={icon} mistColor={mistColor} width={100} height={34} />;
    }
  }
  if (/^https?:\/\//i.test(icon) && !/\.mp4$/i.test(icon)) {
    /* 2026-10-15: Fallback to catalog emoji if image fails */
    const fallbackEntry = NOBLE_REWARDS_CATALOG.find((r) =>
      `noble-plate-${r.rankKey}` === itemId ||
      `noble-badge-${r.rankKey}` === itemId ||
      `noble-frame-${r.rankKey}` === itemId
    );
    const fallbackIcon = fallbackEntry ? (
      itemId?.includes('plate-') ? fallbackEntry.nameplate.fallbackIcon :
      itemId?.includes('badge-') ? fallbackEntry.badge?.fallbackIcon :
      fallbackEntry.frame?.fallbackIcon
    ) : '🎖️';
    const isFrame = itemId?.includes('frame-');
    // 2026-10-16 (Sumon): Only show fallback emoji if image FAILS to load.
    // Frames have transparent centers — emoji would show through!
    // 2026-10-15 (Sumon): Frames show as SQUARE (not circle) — full design visible
    return (
      <View style={{
        width: isFrame ? 52 : 44, height: isFrame ? 52 : 44,
        borderRadius: isFrame ? 8 : 22,
        backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {!imgError ? (
          <Image
            source={{ uri: icon }}
            style={{ width: isFrame ? 52 : 44, height: isFrame ? 52 : 44, position: 'absolute' }}
            resizeMode="contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <Text style={{ fontSize: 24 }}>{fallbackIcon}</Text>
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
    nobel: { icon: '👑', title: '', subtitle: '', desc: '' },
  }[tab];

  if (tab === 'nobel') return null;

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
  const [tab, setTab] = useState<TabKey>('nobel'); // 2026-10-16 (Sumon): Nobel is first tab → default

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

  const renderItemRow = (
    item: { id: string; name: string; icon: string; obtainedAt: number; validity: 'permanent' | number; source: string },
    isActive: boolean,
    field: 'activeFrame' | 'activeNameplate' | 'activeRipple' | 'activeEntryEffect',
    sourceLabel: string,
  ) => (
    <View
      key={item.id}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.goldBg, borderRadius: 16, padding: 16, marginBottom: 12,
        borderWidth: isActive ? 2 : 1,
        borderColor: isActive ? C.gold : C.goldBorder,
        shadowColor: isActive ? C.gold : 'transparent',
        shadowOpacity: isActive ? 0.25 : 0,
        shadowRadius: isActive ? 12 : 0,
        shadowOffset: { width: 0, height: 4 },
        elevation: isActive ? 4 : 0 }}
    >
      <ItemIcon icon={item.icon} frameId={field === 'activeFrame' ? item.id : undefined} frameName={item.name} itemId={item.id} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{item.name}</Text>
          {item.source === 'noble' && (
            <View style={{ marginLeft: 8, backgroundColor: C.gold, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>NOBEL</Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          Obtained {formatObtainedDate(item.obtainedAt)} · {sourceLabel}
        </Text>
        {isMe && (
          <Text style={{ fontSize: 11, color: '#8A6D00', marginTop: 2, fontWeight: '700' }}>
            {formatValidity(item.validity)}
          </Text>
        )}
      </View>
      {isMe ? (
        isActive ? (
          <View style={{ alignItems: 'center' }}>
            <View style={{ backgroundColor: C.successBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: C.success }}>✓ USING</Text>
            </View>
            <Pressable
              style={{ backgroundColor: C.errorBg, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
              onPress={() => handleRemove(field)}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.errorText }}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
            onPress={() => handleEquip(field, item.id)}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Use</Text>
          </Pressable>
        )
      ) : isActive ? (
        <View style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Active</Text>
        </View>
      ) : null}
    </View>
  );

  const renderTabContent = () => {
    if (tab === 'nobel') {
      return (
        <View style={{ flex: 1 }}>
          <NobelScreen embedded />
        </View>
      );
    }

    const data = {
      frames: { items: frames, field: 'activeFrame' as const, active: profile?.activeFrame, label: 'Official' },
      nameplates: { items: nameplates, field: 'activeNameplate' as const, active: profile?.activeNameplate, label: 'Official' },
      ripples: { items: ripples, field: 'activeRipple' as const, active: (profile as any)?.activeRipple, label: 'Nobel' },
      entryfx: { items: entryEffects, field: 'activeEntryEffect' as const, active: (profile as any)?.activeEntryEffect, label: 'Nobel' },
    }[tab];

    if (data.items.length === 0) {
      return <LuxuryEmptyState tab={tab} />;
    }

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
      >
        {data.items.map((item: any) =>
          renderItemRow(item, data.active === item.id, data.field, item.source === 'noble' ? 'Nobel' : item.source === 'event' ? 'Event reward' : data.label)
        )}
      </ScrollView>
    );
  };

  const visibleTabs = isMe ? TABS : TABS.filter((t) => t.key !== 'nobel');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, marginLeft: 4 }}>
          Decoration
        </Text>
      </View>

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
          // 2026-10-16 (Sumon): Nobel tab — his reference design, polished:
          // orange circle with white crown+diamond glyph + "Noble" on white.
          if (t.key === 'nobel') {
            return (
              <Pressable
                key={t.key}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setTab(t.key); }}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingHorizontal: 14, marginRight: 8,
                  height: 48, borderRadius: 24,
                  backgroundColor: '#FFFFFF',
                  borderWidth: isActive ? 2 : 1,
                  borderColor: isActive ? C.gold : C.border,
                  shadowColor: isActive ? C.gold : '#000',
                  shadowOpacity: isActive ? 0.35 : 0.06,
                  shadowRadius: isActive ? 10 : 6,
                  shadowOffset: { width: 0, height: isActive ? 4 : 2 },
                  elevation: isActive ? 4 : 2 }}
              >
                <View style={{
                  width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF9800',
                  alignItems: 'center', justifyContent: 'center', marginRight: 8,
                  shadowColor: '#FF9800', shadowOpacity: 0.4, shadowRadius: 6,
                  shadowOffset: { width: 0, height: 2 },
                }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900', lineHeight: 15 }}>♛</Text>
                  <View style={{
                    width: 7, height: 7, backgroundColor: '#fff',
                    transform: [{ rotate: '45deg' }], marginTop: 1,
                  }} />
                </View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#111111' }}>
                  Noble
                </Text>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={t.key}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t.key); }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, marginRight: 8,
                height: 48, borderRadius: 24,
                backgroundColor: isActive ? C.gold : C.card,
                borderWidth: isActive ? 0 : 1,
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
      {isMe && tab !== 'nobel' && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: 'rgba(255,255,255,0.95)', borderTopWidth: 1, borderTopColor: C.border }}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/store' as any); }}
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 13,
              paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1, borderColor: '#EDEDED',
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
