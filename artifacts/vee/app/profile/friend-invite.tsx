/**
 * Profile — Send Friend Invitation (2026-10-27, friendship correction).
 *
 * Route: app/profile/friend-invite.tsx — page title "Send Friend Invitation".
 * Mirror of the couple-invite list, minus the couple parts (no token sheet,
 * no charge, no expiry, no resume): rows = people who satisfy ALL of:
 *   (a) in the viewer's inbox — an existing DM thread exists (buildChatId
 *       of the sorted uids joined with '_' + userChats/{viewerUid}/{chatId}
 *       exists via get(); an isHidden/deleted entry counts as absent), AND
 *   (b) diamond-sending relation — intimacy value > 0 from
 *       subscribeMyIntimacies(viewerUid), AND
 *   (c) NOT already an explicit friend (userFriends/{viewerUid}).
 * Ranked by intimacy points DESC, TOP 20 ONLY. No demo/sample people;
 * every button acts for real.
 *
 * Row (couple-invite mirror): circular photo + name + pills + a
 * bright-blue pill send button (white Feather 'send' icon). Pills:
 *   - red/pink pill = couple-track level from the pair's intimacy value.
 *   - blue pill = the person's own TOTAL user level — ONLY when that
 *     level record exists, omitted otherwise.
 * Points text = red-pink heart icon + number.
 * Voice badge slot: ONLY from the server-maintained users/{uid}/
 * liveRoomId pointer (same deliberate-not-faked rule as couple-invite).
 *
 * Row states: send (default), "Pending" (a pending outgoing invite to
 * that person already exists), "Sent" (sent this session). If the viewer
 * already has MAX_FRIENDS friends, a notice shows and all sends disable.
 * Send errors surface as an Alert with the service's plain message.
 * All strings via t('...', { defaultValue: 'English text' }).
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { buildChatId } from '@/src/features/chat/services/firebaseDmService';
import {
  subscribeMyIntimacies,
  type IntimacyEntry,
} from '@/src/features/voice-room/services/intimacyService';
import { getLevelFromXP } from '@/src/services/levelService';
import { coupleLevelFor } from '@/src/features/intimacy/coupleLevels';
import {
  subscribeUserFriends,
  findPendingOutgoingFriendInvites,
  sendFriendInvitation,
  MAX_FRIENDS,
  type FriendEntry,
} from '@/src/features/intimacy/friendService';

const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  text: '#25292D',
  muted: '#788187',
  border: '#F0F1F2',
  blue: '#007AFF',
  pink: '#FF4D7E',
} as const;

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

/** Normalize coupleLevelFor return (number, or { id } / { level }) to a level number. */
function coupleLevelNumber(value: number): number {
  try {
    const r = coupleLevelFor(value) as unknown;
    if (typeof r === 'number' && Number.isFinite(r)) return r;
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      if (typeof o.id === 'number') return o.id;
      if (typeof o.level === 'number') return o.level;
    }
  } catch {
    // Fall through to a safe default.
  }
  return 1;
}

interface Candidate {
  uid: string;
  name: string;
  photoURL: string | null;
  intimacyValue: number;
  coupleLevel: number;
  /** Null when the user has no users/{uid}/level record — blue pill omitted then. */
  userTotalLevel: number | null;
  /** Server-maintained live-room pointer only; null/empty = no badge. */
  liveRoomId: string | null;
}

export default function FriendInviteScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const viewerUid = user?.uid ?? null;

  const [entries, setEntries] = useState<IntimacyEntry[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRecipientUids, setPendingRecipientUids] = useState<Set<string>>(new Set());
  const [sentUids, setSentUids] = useState<Set<string>>(new Set());
  const [sendingUid, setSendingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!viewerUid) {
      setLoading(false);
      return;
    }
    const unsubI = subscribeMyIntimacies(viewerUid, setEntries);
    const unsubF = subscribeUserFriends(viewerUid, setFriends);
    return () => { unsubI(); unsubF(); };
  }, [viewerUid]);

  // Outgoing pending invites (for the "Pending" row state — all of them,
  // not just the newest, so no row offers a duplicate send).
  const refreshPending = useCallback(async () => {
    if (!viewerUid) return;
    const pendings = await findPendingOutgoingFriendInvites(viewerUid).catch(() => []);
    setPendingRecipientUids(new Set(pendings.map((p) => p.recipientUid)));
  }, [viewerUid]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  // Filter entries to (inbox AND intimacy > 0 AND not already a friend),
  // resolve profiles, rank DESC, top 20.
  useEffect(() => {
    if (!viewerUid) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const friendUids = new Set(friends.map((f) => f.uid));
      const positive = entries.filter((e) => e.value > 0 && !friendUids.has(e.otherUid));
      const resolved = await Promise.all(
        positive.map(async (e) => {
          const chatId = buildChatId(viewerUid, e.otherUid);
          const [chatSnap, userSnap] = await Promise.all([
            get(ref(database, `userChats/${viewerUid}/${chatId}`)),
            get(ref(database, `users/${e.otherUid}`)),
          ]);
          if (!chatSnap.exists()) return null;
          const chatVal = chatSnap.val() as { isHidden?: boolean };
          if (chatVal.isHidden === true) return null; // hidden/deleted counts as absent
          const uv = userSnap.exists()
            ? (userSnap.val() as {
                name?: string;
                displayName?: string;
                photoURL?: string;
                level?: { xp?: number };
                liveRoomId?: string;
              })
            : null;
          const levelRecord = uv?.level;
          const userTotalLevel =
            levelRecord && typeof levelRecord.xp === 'number'
              ? getLevelFromXP(levelRecord.xp).totalLevel
              : null;
          const liveRoomId =
            typeof uv?.liveRoomId === 'string' && uv.liveRoomId.trim() !== ''
              ? uv.liveRoomId
              : null;
          return {
            uid: e.otherUid,
            name: uv?.name?.trim() || uv?.displayName?.trim() || '',
            photoURL: typeof uv?.photoURL === 'string' ? uv.photoURL : null,
            intimacyValue: e.value,
            coupleLevel: coupleLevelNumber(e.value),
            userTotalLevel,
            liveRoomId,
          } as Candidate;
        }),
      );
      if (cancelled) return;
      const list = resolved
        .filter((c): c is Candidate => c !== null)
        .sort((a, b) => b.intimacyValue - a.intimacyValue)
        .slice(0, 20);
      setCandidates(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, friends, viewerUid]);

  const atMax = friends.length >= MAX_FRIENDS;

  async function handleSend(c: Candidate) {
    if (!viewerUid || sendingUid) return;
    setSendingUid(c.uid);
    try {
      await sendFriendInvitation(viewerUid, c.uid);
      setSentUids((prev) => new Set(prev).add(c.uid));
      void refreshPending();
    } catch (e) {
      Alert.alert(
        t('friendInvite.errorTitle', { defaultValue: 'Could not send' }),
        e instanceof Error ? e.message : t('friendInvite.errorBody', { defaultValue: 'Please try again.' }),
      );
    } finally {
      setSendingUid(null);
    }
  }

  function renderRow({ item }: { item: Candidate }) {
    const initial = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
    const isPending = pendingRecipientUids.has(item.uid);
    const isSent = sentUids.has(item.uid);
    const disabled = atMax || isPending || isSent || sendingUid === item.uid;
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: C.card,
          marginHorizontal: 15,
          marginTop: 12,
          borderRadius: 12,
          padding: 12,
        }}
      >
        {item.photoURL ? (
          <Image source={{ uri: item.photoURL }} style={{ width: 48, height: 48, borderRadius: 24 }} contentFit="cover" />
        ) : (
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 19, fontWeight: '700', color: C.blue }}>{initial}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.text, flexShrink: 1 }} numberOfLines={1}>
              {item.name || t('friendInvite.someone', { defaultValue: 'Someone' })}
            </Text>
            {/* Voice badge slot: ONLY from the server-maintained liveRoomId pointer. */}
            {item.liveRoomId ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E6F9ED', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                <Feather name="mic" size={11} color="#1E9E4A" />
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#1E9E4A', marginLeft: 2 }}>
                  {t('friendInvite.live', { defaultValue: 'Live' })}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            {/* Red/pink pill: couple-track level for this pair. */}
            <View style={{ backgroundColor: C.pink, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                {item.coupleLevel >= 10
                  ? t('friendInvite.levelMax', { defaultValue: 'Lv Max' })
                  : t('friendInvite.levelPill', { defaultValue: 'Lv. {{n}}', n: item.coupleLevel })}
              </Text>
            </View>
            {/* Blue pill: the person's own total user level — ONLY when a level record exists. */}
            {item.userTotalLevel !== null ? (
              <View style={{ backgroundColor: C.blue, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                  {item.userTotalLevel >= 49
                    ? t('friendInvite.levelMax', { defaultValue: 'Lv Max' })
                    : t('friendInvite.levelPill', { defaultValue: 'Lv. {{n}}', n: item.userTotalLevel })}
                </Text>
              </View>
            ) : null}
            {/* Points text: red-pink heart icon + number. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
              <Feather name="heart" size={14} color={C.pink} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: C.text, marginLeft: 3 }}>
                {String(item.intimacyValue)}
              </Text>
            </View>
          </View>
        </View>
        {isPending || isSent ? (
          <View
            style={{
              height: 36,
              minWidth: 76,
              borderRadius: 18,
              backgroundColor: '#E5E5EA',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
              marginLeft: 8,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#788187' }}>
              {isSent
                ? t('friendInvite.sent', { defaultValue: 'Sent' })
                : t('friendInvite.pending', { defaultValue: 'Pending' })}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => void handleSend(item)}
            disabled={disabled}
            style={{
              width: 44,
              height: 36,
              borderRadius: 18,
              backgroundColor: atMax ? '#E5E5EA' : C.blue,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 8,
              opacity: sendingUid === item.uid ? 0.6 : 1,
            }}
            hitSlop={4}
          >
            <Feather name="send" size={16} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('friendInvite.title', { defaultValue: 'Send Friend Invitation' })} />
      <Text style={{ fontSize: 15, fontWeight: '600', color: C.text, marginHorizontal: 15, marginTop: 16 }}>
        {t('friendInvite.enoughIntimacy', { defaultValue: 'Enough Intimacy points' })}
      </Text>
      {atMax && (
        <Text style={{ fontSize: 13, color: C.muted, marginHorizontal: 15, marginTop: 8 }}>
          {t('friendInvite.atMax', { defaultValue: 'You already have 5 friends — the maximum.' })}
        </Text>
      )}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.blue} />
        </View>
      ) : candidates.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 15, color: C.muted, textAlign: 'center' }}>
            {t('friendInvite.empty', { defaultValue: 'No one to invite yet' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(item) => item.uid}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </SafeAreaView>
  );
}
