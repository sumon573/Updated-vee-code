/**
 * ProfileMenuHost — Me-tab host for the ChatGPT premium profile menu draft.
 *
 * 2026-11-02 (boss order): the Me icon opens the GPT menu
 * (VeePremiumProfileMenu). Scope is the Me tab ONLY: the /profile route and
 * other users' profiles keep the old ProfileScreen untouched, so
 * Edit/Visitors/Rooms/Intimacy entries survive there.
 *
 * All values are real: Firebase user + extra fields, follow counts, noble
 * state, wallet balance, gift-received count (same last-50-tx window the
 * old profile page uses). Nothing invented, nothing sampled.
 * My Event has no dedicated Vee page — Vee events live inside Task Center
 * (TaskCenterModal swaps its list for event pages) — so My Event opens
 * the same Task Center sheet. Disclosed to boss at ship time.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ref, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import { subscribeFollowCounts } from '@/src/services/followService';
import { subscribeNoble, NOBLE_RANKS, type NobleState } from '@/src/services/nobleService';
import { subscribeWalletBalance, subscribeTransactionHistory } from '@/src/features/wallet/walletService';
import { TaskCenterModal } from '../voice-room/components/TaskCenterModal';
import VeePremiumProfileMenu from './VeePremiumProfileMenu';

/** Mirrors app/profile/index calcAge (boss rule: age always from birthday). */
function calcAge(birthday: string | undefined | null): number | null {
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

export default function ProfileMenuHost({ onBack }: { onBack?: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [extra, setExtra] = useState<{ country?: string; gender?: string; birthday?: string }>({});
  const [followers, setFollowers] = useState(0);
  const [noble, setNoble] = useState<NobleState | null>(null);
  const [balance, setBalance] = useState(0);
  const [giftCount, setGiftCount] = useState(0);
  const [taskVisible, setTaskVisible] = useState(false);

  useEffect(() => {
    if (!uid) return;
    return subscribeUser(uid, (u) => setProfile(u));
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const unsub = onValue(ref(database, `users/${uid}`), (snap) => {
      const v = snap.val() as any;
      if (!v || typeof v !== 'object') { setExtra({}); return; }
      const pick = (k: string) => (typeof v[k] === 'string' ? v[k] : undefined);
      setExtra({ country: pick('country'), gender: pick('gender'), birthday: pick('birthday') });
    });
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeFollowCounts(uid, (c) => setFollowers(c.followers));
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeNoble(uid, (s) => setNoble(s));
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeWalletBalance(uid, (b) => setBalance(b));
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeTransactionHistory(uid, (txs) => {
      let n = 0;
      for (const tx of txs) if (tx.type === 'gift_received' && tx.giftId) n += 1;
      setGiftCount(n);
    });
  }, [uid]);

  if (!uid || !profile) {
    return <View style={{ flex: 1, backgroundColor: '#F7F3FD' }} />;
  }

  const age = calcAge(extra.birthday);
  const g = (extra.gender || '').toLowerCase();
  const gender = g === 'female' ? 'female' : g === 'male' ? 'male' : null;
  const rankName = noble && NOBLE_RANKS[noble.rankIndex] ? NOBLE_RANKS[noble.rankIndex].name : '';

  const back = () => {
    if (onBack) { onBack(); return; }
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={{ flex: 1 }}>
      <VeePremiumProfileMenu
        displayName={profile.name || 'User'}
        photoUrl={profile.photoURL || null}
        followersLabel={String(followers)}
        ageLabel={age != null ? String(age) : null}
        gender={gender}
        countryLabel={extra.country ?? null}
        diamondBalanceLabel={balance.toLocaleString('en-US')}
        achievementLabel={undefined}
        nobleRankLabel={rankName}
        giftCountLabel={String(giftCount)}
        onBack={back}
        onSettings={() => router.push('/profile/settings')}
        onProfilePhoto={() => router.push('/profile/dp-viewer')}
        onFollowers={() => router.push('/profile/followers')}
        onTaskCenter={() => setTaskVisible(true)}
        onDiamonds={() => router.push('/profile/wallet')}
        onAchievement={() => router.push('/profile/honor')}
        onSvip={() => router.push('/svip')}
        onNoble={() => router.push('/profile/nobel')}
        onDecoration={() => router.push('/profile/decoration')}
        onGiftWall={() => router.push('/profile/gifts')}
        onRank={() => router.push('/leaderboard')}
        onMyEvent={() => setTaskVisible(true)}
      />
      <TaskCenterModal visible={taskVisible} onClose={() => setTaskVisible(false)} />
    </View>
  );
}
