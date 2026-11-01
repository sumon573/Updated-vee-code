/**
 * Recent Visitors — route: /profile/visitors (pushed from the profile bell).
 *
 * Shows the owner's profile visitors in TWO sections by LATEST visit:
 * Today / Last 7 days. Each visitor appears ONCE, under their latest-visit
 * section, latest first. Rows for unseen visitors are LIGHT-GREEN; seen rows
 * are white. Viewing this list marks all visitors listed at first render as
 * seen (snapshot keys only, marked when LEAVING the page) — so on re-entry
 * the previously-green rows are white and only visitors who arrived after
 * that view show green. The mark MUST NOT fire on data arrival: rows render
 * after the first map delivery (profiles load progressively), so marking on
 * arrival turned every new row white before it was ever seen.
 * Row tap opens the visitor's profile via the existing /user-profile route.
 *
 * Pattern mirrors app/profile/followers.tsx (TitleBar, expo-image DPs with
 * initials fallback, /user-profile row tap, 3s offline-safety timeout).
 * 2026-10-30 (boss: instant load): profiles come from subscribeUser —
 * cached-first (repeat visitors render with zero network wait) + live
 * refresh; rows render progressively as profiles arrive, and the empty
 * text shows only when the loaded map truly lists nobody. Mark-seen
 * reuses the first map delivery as its snapshot (no extra round trip).
 * No v-id is displayed on rows (boss order). No pagination: the 7-day
 * window keeps the list small, and loading the full list is what makes
 * "currently-listed" exact for the mark-seen rule. No help icon
 * (never specified by the boss).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Platform, SectionList } from 'react-native';
import { Image } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { VeeUser, subscribeUser } from '@/src/services/userService';
import { useAuth } from '@/src/context/AuthContext';
import * as Haptics from 'expo-haptics';
import { getOfficialBadgeIconUrl } from '@/src/services/verifiedService';
import {
  subscribeVisitors, markVisitorsSeen,
  splitVisitorSections, type VisitorMap,
} from '@/src/services/visitorService';

// IMO BIUI light tokens (matches app/profile/index.tsx + followers.tsx)
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
  unseenRow: '#E6F7EB',
} as const;

// IMO title bar: 56dp, back left, 17sp semibold title centered, NO gear on inner screens
function TitleBar({ title, count }: { title: string; count?: number }) {
  const topPad = Platform.OS === 'web' ? 67 : 0;
  return (
    <View style={{ backgroundColor: C.card, paddingTop: topPad }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40, alignItems: 'center' }}>
          {count !== undefined && (
            <Text style={{ fontSize: 14, color: C.muted }}>{count}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const VisitorRow = memo(function VisitorRow({ user, unseen, last, badgeIconUrl, onPress }: {
  user: VeeUser; unseen: boolean; last: boolean; badgeIconUrl: string | null; onPress: (u: VeeUser) => void;
}) {
  const initials = user.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  return (
    <View style={{ backgroundColor: unseen ? C.unseenRow : C.card }}>
      <Pressable
        onPress={() => onPress(user)}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 13, paddingHorizontal: 15 }}
      >
        {user.photoURL ? (
          <Image
            source={{ uri: user.photoURL }}
            style={{ width: 48, height: 48, borderRadius: 24, marginRight: 12 }}
            cachePolicy="memory-disk"
            recyclingKey={user.uid}
          />
        ) : (
          <View style={{
            width: 48, height: 48, borderRadius: 24, marginRight: 12,
            backgroundColor: C.blueLight,
            alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.blue, fontSize: 16, fontWeight: '800' }}>{initials}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* 2026-10-12 (Sumon): display-name fallback — use ||, never ?? */}
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
              {user.name || 'User'}
            </Text>
            {user.officialBadge ? (
              <Image
                source={badgeIconUrl ? { uri: badgeIconUrl } : require('@/assets/images/vee-badge.png')}
                style={{ width: 18, height: 18, marginLeft: 6 }}
                resizeMode="contain"
              />
            ) : null}
          </View>
          {/* 2026-10-30 (boss): v-id is NOT displayed on visitor rows. */}
        </View>
        <Feather name="chevron-right" size={18} color={C.mutedLight} />
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 75 }} />}
    </View>
  );
});

export default function VisitorsScreen() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [records, setRecords] = useState<VisitorMap>({});
  const [profiles, setProfiles] = useState<Record<string, VeeUser>>({});
  // Uids listed in the map whose users/{uid} doc does not exist (live null
  // from subscribeUser) — rendered as placeholder rows so a real visit is
  // never invisible just because the profile doc is missing.
  const [missing, setMissing] = useState<Record<string, true>>({});
  const [badgeIconUrl, setBadgeIconUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // First-view snapshot of unseen listed uids. Captured on the first map
  // delivery but marked ONLY when leaving the page (effect cleanup) — never
  // on arrival, or new rows render white before the owner can see them.
  const snapshotUnseenRef = useRef<string[] | null>(null);
  const profileSubsRef = useRef(new Map<string, () => void>());

  // Live visitor map — keys only at first, cheap even for long lists.
  // 2026-10-30 (boss: new-visit visibility): the first delivery is ONLY
  // the view-time snapshot (same rule — visitors arriving after this view
  // stay unseen until the next view). The mark itself fires in the cleanup
  // when LEAVING the page: marking on arrival used to flip rows white
  // before their profiles had even rendered, so a new visitor was never
  // distinguishable. Rows stay green for the whole view.
  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const unsub = subscribeVisitors(uid, (map) => {
      setRecords(map);
      setLoading(false);
      if (snapshotUnseenRef.current === null) {
        const { today, last7 } = splitVisitorSections(map);
        snapshotUnseenRef.current = [...today, ...last7].filter((v) => map[v]?.seen === false);
      }
    });

    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx.
    const timeout = setTimeout(() => setLoading(false), 3000);

    return () => {
      clearTimeout(timeout);
      unsub();
      const snapshot = snapshotUnseenRef.current;
      snapshotUnseenRef.current = null;
      if (snapshot && snapshot.length > 0) void markVisitorsSeen(uid, snapshot);
    };
  }, [uid]);

  // Server-driven official badge icon (once; rows fall back to the bundle asset).
  useEffect(() => {
    let cancelled = false;
    getOfficialBadgeIconUrl().then((url) => { if (!cancelled) setBadgeIconUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sections by latest visit (7-day window only; older records never listed).
  const { today, last7 } = splitVisitorSections(records);
  const listedUids = [...today, ...last7];

  // Profiles — cached-first + live (boss: instant load). subscribeUser
  // delivers the on-device cached profile IMMEDIATELY (repeat visitors
  // render with zero network wait), then the live listener refreshes
  // it. Subs persist across records changes (only new uids subscribe);
  // pruned when a uid leaves the list, unsubscribed on unmount.
  useEffect(() => {
    const wanted = listedUids.filter((u) => !profileSubsRef.current.has(u));
    for (const u of wanted) {
      const unsub = subscribeUser(u, (user) => {
        setProfiles((prev) => {
          const next = { ...prev };
          if (user) next[u] = user;
          else delete next[u];
          return next;
        });
        // Live null = users/{uid} doc does not exist: remember it so the
        // visit still renders as a placeholder row instead of vanishing.
        // A later user delivery clears it (doc created after the visit).
        setMissing((prev) => {
          if (user) {
            if (!prev[u]) return prev;
            const next = { ...prev };
            delete next[u];
            return next;
          }
          return prev[u] ? prev : { ...prev, [u]: true };
        });
      });
      profileSubsRef.current.set(u, unsub);
    }
    for (const [u, unsub] of [...profileSubsRef.current.entries()]) {
      if (!listedUids.includes(u)) { unsub(); profileSubsRef.current.delete(u); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);
  useEffect(() => () => {
    profileSubsRef.current.forEach((unsub) => unsub());
    profileSubsRef.current.clear();
  }, []);

  const handleUserPress = (u: VeeUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/user-profile?uid=${encodeURIComponent(u.uid)}&name=${encodeURIComponent(u.name)}` as never,
    );
  };

  // 2026-10-30 (boss: new-visit visibility): a listed uid with no profile
  // doc renders as a placeholder row ('?' avatar, 'User' name) instead of
  // disappearing — a real visit must always be visible. Taps still open
  // /user-profile like every other row.
  const fallbackUser = (u: string): VeeUser => ({
    uid: u, vId: '', name: '', email: '', photoURL: '', bio: '',
    createdAt: 0, lastSeen: 0, online: false,
  });
  const sections = [
    { title: 'Today', data: today.map((u) => profiles[u] ?? (missing[u] ? fallbackUser(u) : null)).filter(Boolean) as VeeUser[] },
    { title: 'Last 7 days', data: last7.map((u) => profiles[u] ?? (missing[u] ? fallbackUser(u) : null)).filter(Boolean) as VeeUser[] },
  ].filter((s) => s.data.length > 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title="Recent Visitors" count={loading ? undefined : listedUids.length} />

      {/* 2026-10-30 (boss: instant load): the empty text shows ONLY when
          the map is loaded and truly lists nobody — never while listed
          profiles are still arriving (that flashed a false empty state). */}
      {loading || (listedUids.length > 0 && sections.length === 0) ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="small" />
        </View>
      ) : listedUids.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: C.muted, fontSize: 15, textAlign: 'center' }}>No recent visitors yet</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.uid}
          renderSectionHeader={({ section }) => (
            <View style={{ backgroundColor: C.bg, paddingHorizontal: 15, paddingTop: 12, paddingBottom: 4 }}>
              <Text style={{ color: C.muted, fontSize: 13, fontWeight: '700' }}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item, index, section }) => (
            <VisitorRow
              user={item}
              unseen={records[item.uid]?.seen === false}
              last={index === section.data.length - 1}
              badgeIconUrl={badgeIconUrl}
              onPress={handleUserPress}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}
