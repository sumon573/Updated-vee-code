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
import type { Chat } from '../types';
import { subscribeUserChats } from '../services/firebaseDmService';
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

// ── Fix #24 follow-up (2026-10-29): shared userChats subscription ─────
// Background-resume freeze root cause: on Firebase reconnect, EVERY active
// onValue listener re-fires in one burst. The home shell, the chat tab and
// the stories hook each held their OWN userChats/{uid} listener, so one
// reconnect produced separate Chat[] allocations and separate chat-list
// re-renders (each defeating row memoization) — enough to saturate the JS
// thread, on which RN touch events dispatch, so taps looked dead until the
// storm drained. This hub keeps exactly ONE underlying subscribeUserChats
// per uid and fans the SAME array reference out to all consumers,
// coalesced to a single delivery per animation frame: a reconnect burst
// becomes ONE re-render, not ~10+.
// Delivery timing: the frame deferral (<=1 frame, ~16ms) is imperceptible
// and cached UI stays visible meanwhile; a late joiner gets the last
// snapshot within a frame, matching onValue's immediate-fire contract.
// Intermediate snapshots inside one frame are never observed by any
// consumer (only the latest renders), so delivering only the latest is
// semantics-preserving — including subscribeUserChats' repair follow-up
// callback, whose repaired snapshot simply supersedes the first.
function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

type UserChatsListener = (chats: Chat[]) => void;
type UserChatsHub = {
  listeners: Set<UserChatsListener>;
  last: Chat[] | null;
  flushQueued: boolean;
  unsub: () => void;
};
const userChatsHubs = new Map<string, UserChatsHub>();

function flushUserChatsHub(hub: UserChatsHub): void {
  hub.flushQueued = false;
  const snap = hub.last;
  if (snap === null) return;
  // Same reference to every consumer: no per-consumer re-allocation.
  for (const l of Array.from(hub.listeners)) l(snap);
}

function queueUserChatsHubFlush(hub: UserChatsHub): void {
  if (hub.flushQueued) return;
  hub.flushQueued = true;
  nextFrame(() => flushUserChatsHub(hub));
}

export function subscribeSharedUserChats(uid: string, cb: UserChatsListener): () => void {
  const existing = userChatsHubs.get(uid);
  if (existing) {
    existing.listeners.add(cb);
    if (existing.last !== null) queueUserChatsHubFlush(existing);
    return () => {
      existing.listeners.delete(cb);
      if (existing.listeners.size === 0) {
        existing.unsub();
        userChatsHubs.delete(uid);
      }
    };
  }
  const hub: UserChatsHub = { listeners: new Set(), last: null, flushQueued: false, unsub: () => {} };
  userChatsHubs.set(uid, hub);
  hub.unsub = subscribeUserChats(uid, (chats) => {
    hub.last = chats;
    queueUserChatsHubFlush(hub);
  });
  hub.listeners.add(cb);
  return () => {
    hub.listeners.delete(cb);
    if (hub.listeners.size === 0) {
      hub.unsub();
      userChatsHubs.delete(uid);
    }
  };
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

  // Fix #24 follow-up (2026-10-29): frame-coalesced story updates. The
  // storySeen + allStories listeners each call setStories; on reconnect
  // both fire in one burst (myStories below feeds different UI and stays
  // direct). Queueing their updaters into a single setStories per
  // animation frame keeps a reconnect burst to ONE story re-render.
  // markGroupSeen stays direct (a user tap wants immediate feedback); a
  // queued allStories replace reads seenRef at APPLY time, so it can never
  // clobber a tap's seen flag.
  const storiesQueueRef = useRef<Array<(prev: UserStories[]) => UserStories[]>>([]);
  const storiesFlushRef = useRef({ queued: false, loadingDone: false });
  const flushStoriesQueue = useCallback(() => {
    const updaters = storiesQueueRef.current;
    storiesQueueRef.current = [];
    const loadingDone = storiesFlushRef.current.loadingDone;
    storiesFlushRef.current = { queued: false, loadingDone: false };
    if (updaters.length > 0) {
      setStories((prev) => updaters.reduce((s, u) => u(s), prev));
    }
    if (loadingDone) setLoading(false);
  }, []);
  const scheduleStoriesUpdate = useCallback((updater: (prev: UserStories[]) => UserStories[], opts?: { loadingDone?: boolean }) => {
    storiesQueueRef.current.push(updater);
    if (opts?.loadingDone) storiesFlushRef.current.loadingDone = true;
    if (storiesFlushRef.current.queued) return;
    storiesFlushRef.current.queued = true;
    nextFrame(flushStoriesQueue);
  }, [flushStoriesQueue]);

  // Subscribe to Firebase-persisted seen state
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeStorySeen(user.uid, (seenUids) => {
      seenRef.current = seenUids;
      // Update allSeen for already-loaded stories (frame-coalesced, Fix #24).
      scheduleStoriesUpdate((prev) => prev.map((g) => ({
        ...g,
        allSeen: seenUids.has(g.userId),
      })));
    });
    return unsub;
  }, [user?.uid]);

  // Fix #24 follow-up (2026-10-29): this raw onValue STAYS, deliberately.
  // It reads the raw userChats children — including HIDDEN chats, which
  // subscribeUserChats filters out (sanitizeChat + !isHidden) — so the
  // shared Chat[] cannot reproduce its participant set (switching sources
  // would drop hidden-chat participants from the contacts set and hide
  // their stories from the story row). It writes only a ref and never
  // re-renders, so it contributes nothing to the reconnect storm; the
  // render-causing Chat[] listeners are the ones deduped through
  // subscribeSharedUserChats above.
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
      // seenRef is read at APPLY time (inside the updater), so a seen flag
      // set between the callback and the frame flush is never lost.
      // loadingDone rides the same flush, so the initial load stays ONE
      // render (stories + loading flag together, Fix #24).
      scheduleStoriesUpdate((_prev) => groups.map((g) => ({
        ...g,
        allSeen: seenRef.current.has(g.userId),
      })), { loadingDone: true });
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
