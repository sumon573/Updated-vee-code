/**
 * Profile — Send Couple Invitation (Builder C, 2026-10-26).
 *
 * Route: app/profile/couple-invite.tsx — page title "Send Couple Invitation".
 *
 * Rows = people who satisfy ALL of:
 *   (a) in the viewer's inbox — an existing DM thread exists (buildChatId of
 *       the sorted uids joined with '_' + userChats/{viewerUid}/{chatId}
 *       exists via get(); an isHidden/deleted entry counts as absent), AND
 *   (b) diamond-sending relation — intimacy value > 0 from
 *       subscribeMyIntimacies(viewerUid).
 * Ranked by intimacy points DESC, TOP 20 ONLY. No demo/sample people; every
 * button acts for real.
 *
 * Row (mirrors the boss screenshot): circular photo + name + pills + a
 * bright-blue pill send button (white Feather 'send' icon). Pills:
 *   - red/pink pill = couple-track level from the pair's intimacy value
 *     (coupleLevelFor from Builder B's coupleLevels — import written per
 *     spec; that file may not exist yet, coordinator reconciles the export).
 *   - blue pill = the person's own TOTAL user level (levelService
 *     getLevelFromXP on users/{uid}/level) ONLY when that level record
 *     exists — omitted otherwise (coordinator's blue-pill decision).
 * Points text = red-pink heart icon + number (e.g. "81460").
 *
 * VOICE BADGE — DELIBERATELY NOT FAKED (see report): there is no cheap
 * reliable live-room source (investigation §6: no roomDirectory, no
 * currentRoom on users, userRooms is not live presence, users.online is
 * app-online only). The badge slot renders ONLY from a server-maintained
 * pointer, users/{uid}/liveRoomId, when present and non-empty — otherwise
 * no badge. That pointer alone cannot prove the user is live right now
 * (it can go stale); a real badge needs roomDirectory or a heartbeat-checked
 * live-room pointer.
 *
 * Row send button tap → opens the token sheet for that person (not a direct
 * send). If the sender already has a pending outgoing invite, rows show a
 * disabled "Pending" state instead of send buttons — EXCEPT the pending
 * invite's own recipient when its charge is claimed-but-not-done, whose row
 * shows an enabled "Resume" button: Send then resumes the debit for THAT
 * invite instead of creating a new one (inviteService resume logic).
 *
 * Empty list: plain "No one to invite yet".
 * All strings via t('...', { defaultValue: 'English text' }) — no locale
 * files edited.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
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
  findPendingOutgoingInvite,
  getCharge,
  type CoupleInvite,
} from '@/src/features/intimacy/inviteService';
import TokenPickerSheet, { type TokenRecipient } from '@/src/features/intimacy/TokenPickerSheet';

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

/** Normalize Builder B's coupleLevelFor return (number, or { id } / { level }) to a level number. */
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
    // Builder B's module not present yet — fall through to a safe default.
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

export default function CoupleInviteScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const viewerUid = user?.uid ?? null;

  const [entries, setEntries] = useState<IntimacyEntry[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingInvite, setPendingInvite] = useState<CoupleInvite | null>(null);
  const [pendingChargeDone, setPendingChargeDone] = useState<boolean>(true);
  const [sheetRecipient, setSheetRecipient] = useState<TokenRecipient | null>(null);
  const [senderName, setSenderName] = useState('');
  const [senderPhotoURL, setSenderPhotoURL] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    if (!viewerUid) return;
    const pending = await findPendingOutgoingInvite(viewerUid).catch(() => null);
    setPendingInvite(pending);
    if (pending) {
      const charge = await getCharge(pending.receiptId).catch(() => null);
      // No charge record yet (invite created, claim not landed): treat as resumable.
      setPendingChargeDone(charge ? charge.status === 'done' : false);
    } else {
      setPendingChargeDone(true);
    }
  }, [viewerUid]);

  useEffect(() => {
    if (!viewerUid) {
      setLoading(false);
      return;
    }
    const unsub = subscribeMyIntimacies(viewerUid, setEntries);
    void refreshPending();
    // Sender display name/photo for the token sheet.
    void (async () => {
      try {
        const snap = await get(ref(database, `users/${viewerUid}`));
        if (snap.exists()) {
          const v = snap.val() as { name?: string; displayName?: string; photoURL?: string };
          setSenderName(v.name?.trim() || v.displayName?.trim() || '');
          setSenderPhotoURL(typeof v.photoURL === 'string' ? v.photoURL : null);
        }
      } catch {
        // fall through — sheet falls back to initials
      }
    })();
    return unsub;
  }, [viewerUid, refreshPending]);

  // Filter entries to (inbox AND intimacy > 0), resolve profiles, rank DESC, top 20.
  useEffect(() => {
    if (!viewerUid) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const positive = entries.filter((e) => e.value > 0);
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
  }, [entries, viewerUid]);

  function rowAction(c: Candidate) {
    if (!pendingInvite) return { kind: 'send' } as const;
    if (pendingInvite.recipientUid === c.uid && !pendingChargeDone) {
      return { kind: 'resume' } as const; // interrupted charge — Send resumes this invite
    }
    return { kind: 'pending' } as const;
  }

  function renderRow({ item }: { item: Candidate }) {
    const action = rowAction(item);
    const initial = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
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
              {item.name || t('couple.someone', { defaultValue: 'Someone' })}
            </Text>
            {/* Voice badge slot: ONLY from the server-maintained liveRoomId pointer. */}
            {item.liveRoomId ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E6F9ED', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                <Feather name="mic" size={11} color="#1E9E4A" />
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#1E9E4A', marginLeft: 2 }}>
                  {t('couple.live', { defaultValue: 'Live' })}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            {/* Red/pink pill: couple-track level for this pair. */}
            <View style={{ backgroundColor: C.pink, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                {item.coupleLevel >= 10
                  ? t('couple.levelMax', { defaultValue: 'Lv Max' })
                  : t('couple.levelPill', { defaultValue: 'Lv. {{n}}', n: item.coupleLevel })}
              </Text>
            </View>
            {/* Blue pill: the person's own total user level — ONLY when a level record exists. */}
            {item.userTotalLevel !== null ? (
              <View style={{ backgroundColor: C.blue, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                  {item.userTotalLevel >= 49
                    ? t('couple.levelMax', { defaultValue: 'Lv Max' })
                    : t('couple.levelPill', { defaultValue: 'Lv. {{n}}', n: item.userTotalLevel })}
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
        {action.kind === 'pending' ? (
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
              {t('couple.pending', { defaultValue: 'Pending' })}
            </Text>
          </View>
        ) : action.kind === 'resume' ? (
          <Pressable
            onPress={() => setSheetRecipient({ uid: item.uid, name: item.name, photoURL: item.photoURL })}
            style={{
              height: 36,
              minWidth: 76,
              borderRadius: 18,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: C.pink,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
              marginLeft: 8,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: C.pink }}>
              {t('couple.resume', { defaultValue: 'Resume' })}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setSheetRecipient({ uid: item.uid, name: item.name, photoURL: item.photoURL })}
            style={{
              width: 44,
              height: 36,
              borderRadius: 18,
              backgroundColor: C.blue,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 8,
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
      <TitleBar title={t('couple.title', { defaultValue: 'Send Couple Invitation' })} />
      <Text style={{ fontSize: 15, fontWeight: '600', color: C.text, marginHorizontal: 15, marginTop: 16 }}>
        {t('couple.enoughIntimacy', { defaultValue: 'Enough Intimacy points' })}
      </Text>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.blue} />
        </View>
      ) : candidates.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 15, color: C.muted, textAlign: 'center' }}>
            {t('couple.empty', { defaultValue: 'No one to invite yet' })}
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
      {sheetRecipient && viewerUid ? (
        <TokenPickerSheet
          visible={!!sheetRecipient}
          onClose={() => setSheetRecipient(null)}
          senderUid={viewerUid}
          senderName={senderName}
          senderPhotoURL={senderPhotoURL}
          recipient={sheetRecipient}
          onCoupleSent={() => {
            void refreshPending();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
