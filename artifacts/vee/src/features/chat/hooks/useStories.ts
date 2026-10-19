/**
 * useStories — ধাপ ৫ + Story Seen State (Firebase-persisted)
 * Firebase real-time stories subscription + publish.
 * app/chat/index.tsx এ ব্যবহার করা হয়।
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { ref, onValue, get } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { UserStories, Story, StoryPrivacy } from '../types';
import {
  subscribeAllStories,
  subscribeMyStories,
  publishStory,
  recordStoryView,
  reactToStory,
  addStoryComment,
  deleteStory,
  cleanExpiredStories,
  markStorySeen,
  subscribeStorySeen,
  PublishPayload,
} from '../services/firebaseStoryService';

export interface UseStoriesResult {
  stories: UserStories[];          // all users' stories (for StoryBar)
  myStories: Story[];              // current user's own stories
  loading: boolean;
  publish: (payload: PublishPayload) => Promise<void>;
  recordView: (authorUid: string, storyId: string, privacy?: StoryPrivacy) => void;
  react: (authorUid: string, storyId: string, emoji: string) => Promise<void>;
  comment: (authorUid: string, storyId: string, text: string) => Promise<void>;
  remove: (storyId: string) => Promise<void>;
  markGroupSeen: (userId: string) => void;
  getContactUids: () => Set<string>;
}

export function useStories(): UseStoriesResult {
  const { user } = useAuth();
  const [stories, setStories] = useState<UserStories[]>([]);
  const [myStories, setMyStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  // Firebase-persisted seen UIDs
  const seenRef = useRef<Set<string>>(new Set());
  // Contact UIDs for privacy filtering
  const contactUidsRef = useRef<Set<string>>(new Set());

  // Subscribe to Firebase-persisted seen state
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeStorySeen(user.uid, (seenUids) => {
      seenRef.current = seenUids;
      // Update allSeen for already-loaded stories
      setStories((prev) => prev.map((g) => ({
        ...g,
        allSeen: seenUids.has(g.userId),
      })));
    });
    return unsub;
  }, [user?.uid]);

  // Subscribe to contact UIDs (for privacy='contacts' filtering in StoryBar)
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onValue(ref(database, `userChats/${user.uid}`), (snap) => {
      const uids = new Set<string>();
      if (snap.exists()) {
        snap.forEach((child) => {
          const v = child.val() as { participantId?: string };
          if (v.participantId) uids.add(v.participantId);
        });
      }
      contactUidsRef.current = uids;
    });
    return unsub;
  }, [user?.uid]);

  // Subscribe to all stories — privacy-filtered using a getter so the contact
  // list is always read fresh on every Firebase update (no stale-closure bug).
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;
    const unsub = subscribeAllStories((groups) => {
      setStories(groups.map((g) => ({
        ...g,
        allSeen: seenRef.current.has(g.userId),
      })));
      setLoading(false);
    }, {
      viewerUid: uid,
      // Getter — called on every stories update, always returns the live set
      getContactUids: () => contactUidsRef.current,
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Subscribe to own stories + clean expired on mount
  useEffect(() => {
    if (!user?.uid) return;
    cleanExpiredStories(user.uid).catch(() => {/* background: safe to swallow — expiry cleanup retries on next mount */});
    const unsub = subscribeMyStories(user.uid, setMyStories);
    return unsub;
  }, [user?.uid]);

  const publish = useCallback(async (payload: PublishPayload) => {
    if (!user?.uid) throw new Error('Not authenticated');
    // Issue 8: Prefer RTDB photoURL over Firebase Auth photoURL.
    // Auth photoURL is only set for Google sign-in; profile photo edits inside
    // Vee go to RTDB (users/{uid}/photoURL) and do NOT update Auth photoURL.
    // 2026-10-19 polish: ONE users/{uid} read for both fields — the old code
    // did two sequential reads (photoURL, then name).
    let avatarUrl: string | undefined = user.photoURL || undefined;
    let displayName = user.displayName || 'You';
    try {
      const profileSnap = await get(ref(database, `users/${user.uid}`));
      if (profileSnap.exists()) {
        const p = profileSnap.val() as any;
        if (p.photoURL) avatarUrl = p.photoURL as string;
        // Real name from RTDB (2026-10-11): Auth displayName may be unset/stale.
        // || not ?? — empty-string names must fall back.
        displayName = p.name || displayName;
      }
    } catch { /* non-critical — fallback to Auth values */ }
    await publishStory(user.uid, displayName, avatarUrl, payload);
  }, [user]);

  const recordView = useCallback((authorUid: string, storyId: string, privacy?: StoryPrivacy) => {
    recordStoryView(authorUid, storyId, user?.uid, privacy);
  }, [user?.uid]);

  const react = useCallback(async (authorUid: string, storyId: string, emoji: string) => {
    if (!user?.uid) return;
    await reactToStory(authorUid, storyId, user.uid, emoji);
  }, [user?.uid]);

  const comment = useCallback(async (authorUid: string, storyId: string, text: string) => {
    if (!user?.uid) throw new Error('Not authenticated');
    // 2026-10-13: Fetch DB profile name (Auth displayName may be empty for Google users)
    let dbName = '';
    let dbAvatar: string | undefined;
    try {
      const snap = await get(ref(database, `users/${user.uid}`));
      if (snap.exists()) {
        const p = snap.val() as any;
        dbName = p.name || p.displayName || '';
        dbAvatar = p.photoURL || p.avatar || p.dp || undefined;
      }
    } catch { /* fallback to Auth */ }
    await addStoryComment(authorUid, storyId, {
      userId: user.uid,
      // P1 fix (2026-10-12): || not ?? — empty-string displayName must fall back.
      userName: dbName || user.displayName || 'You',
      text,
      userAvatar: dbAvatar || user.photoURL || undefined,
    });
  }, [user]);

  const remove = useCallback(async (storyId: string) => {
    if (!user?.uid) return;
    await deleteStory(user.uid, storyId);
  }, [user?.uid]);

  /** Mark a story group as seen — saves to Firebase so it persists across app restarts */
  const markGroupSeen = useCallback((userId: string) => {
    if (!user?.uid) return;
    seenRef.current.add(userId);
    setStories((prev) => prev.map((g) =>
      g.userId === userId ? { ...g, allSeen: true } : g,
    ));
    // Persist to Firebase (fire-and-forget)
    markStorySeen(user.uid, userId).catch(() => {/* background: safe to swallow — seen markers are best-effort */});
  }, [user?.uid]);

  return { stories, myStories, loading, publish, recordView, react, comment, remove, markGroupSeen, getContactUids: () => contactUidsRef.current };
}
