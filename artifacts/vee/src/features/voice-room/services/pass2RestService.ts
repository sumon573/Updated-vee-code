/**
 * Pass2 REST service (another-pass Phase 1, staging build).
 *
 * Plain fetch() to the tier — NEVER the Firebase SDK. An SDK read would
 * reopen the socket and defeat the pass (DESIGN.md §0), so every call
 * here is fetch() with the Firebase ID token in the Authorization: Bearer
 * header (the authedWalletFetch pattern in walletService.ts — the uid
 * comes from the token, never from the request body).
 *
 * BASE URLs — staging constants are what drills use:
 *   PASS2_TIER_BASE (staging)  = test tier proc :3010 on the VPS
 *                                  (http://207.180.253.22:3010).
 *   PASS2_TIER_BASE_PRODUCTION = the production tier base, DOCUMENTED
 *                                  only — not activated by this build.
 *                                  Production tier proc is :3003 behind
 *                                  the Caddy route the server task
 *                                  publishes; when that route lands,
 *                                  point the production constant at it
 *                                  (one-line change, no call-site edits).
 *   Wallet /wallet/me: production lives on VeeWallet :3102; the staging
 *   tier is expected to proxy it during drills (same path). If the
 *   staging tier does not serve it, fetchWalletMe fails closed
 *   (keep-last) — it never falls back to an SDK wallet read.
 *
 * Discipline copied from watcherPollService.ts exactly:
 *   - 5s timeout on every call.
 *   - Keep-last: a failed poll never delivers an empty snapshot. Poll
 *     subscriptions deliver only on success; one-shot fetches return
 *     null on failure and the caller keeps its last good value.
 *   - 5 consecutive failures (or a 403) → onFallback. Fallback is
 *     per-mode and sticky for the session (§3.10): the screen flips its
 *     mode flag off, which resubscribes today's Firebase path.
 * Fatal vs auxiliary: home-list polls are fatal (their failure means
 * the home mode cannot serve, so it falls back). Profile, wallet,
 * invites, intimacy/handshake and online polls are AUXILIARY: they keep
 * last, never trigger fallback, and never deliver null — a stale name
 * or balance beats a mode collapse.
 *
 * ENDPOINT NAMES MARKED TBC: the tier endpoints in DESIGN.md §3.1 are
 * being built by the server-side staging task in parallel. Intimacy /
 * handshake have no named tier endpoint in §3.1 at all, so
 * fetchIntimacyPair / fetchPairHandshake use the provisional paths
 * below. Until the server serves them, those two polls fail closed
 * (keep-last, auxiliary) — they do not break the room mode. The drill
 * checklist must confirm each path against the staged tier before
 * claiming the mode; a 404 here is a server-task gap, not a client bug.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '@/src/config/firebase';
import type { RoomInfo } from './firebaseRoomService';
import type { RoomChatMsg } from './firebaseRoomChatService';
import {
  reportPass2TransportSuccess,
  reportPass2TransportFailure,
} from './pass2SessionMode';

/** Staging test tier (:3010) — what drills use. */
export const PASS2_TIER_BASE = 'http://207.180.253.22:3010';
/** Production mapping (documented only — NOT activated by this build). */
export const PASS2_TIER_BASE_PRODUCTION = 'https://vee-club.duckdns.org';

const FETCH_TIMEOUT_MS = 5000;
const MAX_CONSEC_FAILURES = 5;
const HOME_POLL_MS = 30_000;
const PROFILE_POLL_MS = 30_000;
const AUX_POLL_MS = 30_000;

export type Pass2Flags = {
  enabled: boolean;
  room: boolean;
  seated: boolean;
  private: boolean;
  dm: boolean;
  home: boolean;
  profile: boolean;
  banRest: boolean;
  /** Phase 2 only — always false in Phase 1 (calls stay on Firebase). */
  calls: boolean;
};

export const PASS2_FLAGS_OFF: Pass2Flags = {
  enabled: false,
  room: false,
  seated: false,
  private: false,
  dm: false,
  home: false,
  profile: false,
  banRest: false,
  calls: false,
};

export type Pass2Profile = {
  uid: string;
  name?: string;
  photoURL?: string | null;
  activeFrame?: string;
  banned?: boolean;
  banReason?: string | null;
  [key: string]: unknown;
};

export type Pass2WalletMe = {
  balance: number;
  weeklyEarned: number;
  giftCounts?: Record<string, number>;
  transactions?: Array<Record<string, unknown>>;
};

type FetchResult = { ok: boolean; status: number; json: any };

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (res.ok) reportPass2TransportSuccess();
    else reportPass2TransportFailure();
    return { ok: res.ok, status: res.status, json };
  } catch {
    reportPass2TransportFailure();
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function authedFetchJson(
  path: string,
  opts?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<FetchResult> {
  const doFetch = async (forceRefresh: boolean): Promise<FetchResult> => {
    const user = auth.currentUser;
    if (!user) return { ok: false, status: 401, json: null };
    const token = await user.getIdToken(forceRefresh).catch(() => null);
    if (!token) return { ok: false, status: 401, json: null };
    return fetchJson(`${PASS2_TIER_BASE}${path}`, {
      method: opts?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  };
  let r = await doFetch(false);
  if (r.status === 401 || r.status === 403) {
    try {
      const retry = await doFetch(true);
      if (retry.status !== 401) r = retry;
    } catch { /* keep original */ }
  }
  return r;
}

// ─── Flags (§5 Phase 1): plain fetch, NEVER the Firebase SDK ────────────────
// Defaults false; flag-unreadable = false (same fail-closed pattern as the
// watcher flag). Never writes any flag anywhere (production RTDB included).
let flagsCache: { at: number; flags: Pass2Flags } | null = null;

export async function fetchPass2Flags(): Promise<Pass2Flags> {
  if (flagsCache && Date.now() - flagsCache.at < 60_000) return flagsCache.flags;
  try {
    // 2026-10-31 (Part 2b): the tier gates /pass2/flags behind auth
    // (unauthenticated GET 401s, verified via VPS loopback), so flags
    // must be fetched authed — otherwise no pass2 mode can ever turn on.
    const r = await authedFetchJson('/pass2/flags');
    if (!r.ok || !r.json || typeof r.json !== 'object') return PASS2_FLAGS_OFF;
    const j = r.json as Record<string, unknown>;
    const flags: Pass2Flags = {
      enabled: j.enabled === true,
      room: j.room === true,
      seated: j.seated === true,
      private: j.private === true,
      dm: j.dm === true,
      home: j.home === true,
      profile: j.profile === true,
      banRest: j.banRest === true,
      calls: false, // Phase 1: calls stay on Firebase, whatever the server says.
    };
    if (!flags.enabled) return PASS2_FLAGS_OFF;
    flagsCache = { at: Date.now(), flags };
    return flags;
  } catch {
    return PASS2_FLAGS_OFF;
  }
}

// ─── Tier reads (one-shot; null = failure, caller keeps last) ───────────────

export async function fetchPass2PrivateRooms(): Promise<RoomInfo[] | null> {
  const r = await authedFetchJson('/rooms/private');
  if (!r.ok || !Array.isArray(r.json?.rooms)) return null;
  return r.json.rooms as RoomInfo[];
}

export async function fetchPass2MineRooms(): Promise<RoomInfo[] | null> {
  const r = await authedFetchJson('/rooms/mine');
  if (!r.ok || !Array.isArray(r.json?.rooms)) return null;
  return r.json.rooms as RoomInfo[];
}

/** One batch per visible list — never one listener per row (§3.6). */
export async function fetchPass2Profiles(uids: string[]): Promise<Record<string, Pass2Profile> | null> {
  const list = [...new Set(uids.filter(Boolean))];
  if (!list.length) return {};
  const out: Record<string, Pass2Profile> = {};
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const r = await authedFetchJson(`/users/profiles?uids=${encodeURIComponent(chunk.join(','))}`);
    if (!r.ok) return null;
    const rows = Array.isArray(r.json?.profiles) ? r.json.profiles : (Array.isArray(r.json) ? r.json : []);
    for (const p of rows) {
      if (p && typeof p.uid === 'string') out[p.uid] = p as Pass2Profile;
    }
  }
  return out;
}

/** Authed self profile — includes banned/banReason (§3.8 ban check). */
export async function fetchPass2Me(): Promise<Pass2Profile | null> {
  const r = await authedFetchJson('/users/me');
  if (!r.ok || !r.json || typeof r.json !== 'object') return null;
  return r.json as Pass2Profile;
}

/** Ban check on app start / room entry / DM open (§3.8). Null = unknown (keep last). */
export async function checkBanViaRest(): Promise<{ banned: boolean; banReason: string | null } | null> {
  const me = await fetchPass2Me();
  if (!me) return null;
  return {
    banned: me.banned === true,
    banReason: typeof me.banReason === 'string' ? me.banReason : null,
  };
}

export async function fetchPass2Online(uids: string[]): Promise<Record<string, { online: boolean; lastSeen?: number }> | null> {
  const list = [...new Set(uids.filter(Boolean))];
  if (!list.length) return {};
  const r = await authedFetchJson(`/users/online?uids=${encodeURIComponent(list.join(','))}`);
  if (!r.ok || !r.json || typeof r.json !== 'object') return null;
  return r.json as Record<string, { online: boolean; lastSeen?: number }>;
}

/** Wallet read (Postgres truth). Staging tier proxies /wallet/me; production is VeeWallet :3102. */
export async function fetchPass2WalletMe(): Promise<Pass2WalletMe | null> {
  const r = await authedFetchJson('/wallet/me');
  if (!r.ok || !r.json || typeof r.json !== 'object') return null;
  const j = r.json as Record<string, unknown>;
  if (typeof j.balance !== 'number') return null;
  return {
    balance: j.balance,
    weeklyEarned: typeof j.weeklyEarned === 'number' ? j.weeklyEarned : 0,
    giftCounts: (j.giftCounts as Record<string, number> | undefined) ?? undefined,
    transactions: (j.transactions as Array<Record<string, unknown>> | undefined) ?? undefined,
  };
}

/** PROVISIONAL paths (see header TBC note): no §3.1 endpoint names these yet. */
export async function fetchPass2IntimacyPair(a: string, b: string): Promise<{ value: number } | null> {
  const r = await authedFetchJson(`/users/intimacy?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  if (!r.ok || !r.json || typeof r.json !== 'object') return null;
  return { value: typeof r.json.value === 'number' ? r.json.value : 0 };
}

export async function fetchPass2PairHandshake(key: string): Promise<{ designKey: string | null } | null> {
  const r = await authedFetchJson(`/users/handshake?key=${encodeURIComponent(key)}`);
  if (!r.ok || !r.json || typeof r.json !== 'object') return null;
  return { designKey: typeof r.json.designKey === 'string' ? r.json.designKey : null };
}

export async function fetchPass2SeatInvites(): Promise<Array<Record<string, any>> | null> {
  const r = await authedFetchJson('/invites/seats');
  if (!r.ok || !Array.isArray(r.json?.invites)) return null;
  return r.json.invites as Array<Record<string, any>>;
}

// ─── Tier writes ─────────────────────────────────────────────────────────────

/** Room chat send (§3.9). 403 + blocked body → Error('blocked') (screen semantics). */
export async function sendPass2RoomChat(
  roomId: string,
  msg: Omit<RoomChatMsg, 'id' | 'isMe'>,
  msgId?: string,
): Promise<void> {
  const r = await authedFetchJson(`/room/${encodeURIComponent(roomId)}/chat`, {
    method: 'POST',
    body: msgId ? { ...msg, id: msgId } : msg,
  });
  if (r.ok) return;
  if (r.status === 403 && r.json?.blocked === true) throw new Error('blocked');
  throw new Error(`pass2 chat send failed (${r.status})`);
}

/**
 * Generic room-action write (§3.9): seat/request/invite/block/kick/admin/
 * info/pin/announce/reaction ops. VoiceRoomScreen routes its seat-action
 * call sites through it in pass2 mode (gap 5); gift-event + reaction
 * were the Phase 1 routes. Throws on any non-2xx (callers Alert).
 */
export async function sendPass2RoomAction(
  roomId: string,
  op: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const r = await authedFetchJson(`/room/${encodeURIComponent(roomId)}/action`, {
    method: 'POST',
    body: { op, ...(payload ?? {}) },
  });
  if (!r.ok) throw new Error(`pass2 room action failed (${r.status})`);
  return (r.json as Record<string, unknown> | null) ?? null;
}

/**
 * Seat take with the Firebase takeSeat {success} shape (§3.9 gap 5).
 * The tier 409s on occupied/locked/already-seated and 403s on blocked —
 * all map to {success:false}, exactly like takeSeat's transaction abort,
 * so call sites keep their existing Alert flow. Network/5xx also map to
 * false (same as a failed transaction); seat state re-syncs via /watch.
 * NOTE: the tier 409s even when the seat is the CALLER's own ghost (the
 * Firebase transaction re-claims it) — a restore of an own-ghost seat
 * therefore reports false and self-heals via /watch (tier gap, reported).
 */
export async function takePass2Seat(roomId: string, seatIndex: number): Promise<{ success: boolean }> {
  const r = await authedFetchJson(`/room/${encodeURIComponent(roomId)}/action`, {
    method: 'POST',
    body: { op: 'seat_take', seatIndex },
  });
  return { success: r.ok };
}

/** Seat self-mute (§3.9): seat_mute/seat_unmute. Throws on failure (caller Alerts). */
/**
 * Seat-request approve with status (gap 5): the queue modal maps 409 →
 * seatNoLongerEmpty, 403 → seatLocked. Non-throwing by design (the
 * modal's error mapping needs the status, not an exception).
 */
export async function approvePass2SeatRequest(
  roomId: string,
  requestId: string,
  seatIndex: number,
): Promise<{ ok: boolean; status: number }> {
  const r = await authedFetchJson(`/room/${encodeURIComponent(roomId)}/action`, {
    method: 'POST',
    body: { op: 'seat_request_approve', requestId, seatIndex },
  });
  return { ok: r.ok, status: r.status };
}

/** Seat self-mute (§3.9): seat_mute/seat_unmute. Throws on failure (caller Alerts). */
export async function sendPass2SeatMute(roomId: string, seatIndex: number, muted: boolean): Promise<void> {
  await sendPass2RoomAction(roomId, muted ? 'seat_mute' : 'seat_unmute', { seatIndex });
}

/**
 * Seat host-mute (Part 2b): tier op seat_host_mute, DISTINCT from
 * seat_mute — writes hostMuted ONLY, so the target's own mic button
 * can never clear it (host-mute-sticks law). Priv-only server-side.
 * Throws on failure (caller reverts its optimistic seat state).
 */
export async function sendPass2SeatHostMute(
  roomId: string,
  seatIndex: number,
  hostMuted: boolean,
  targetUid?: string,
): Promise<void> {
  await sendPass2RoomAction(roomId, 'seat_host_mute', {
    seatIndex,
    ...(targetUid ? { targetUid } : {}),
    hostMuted,
  });
}

// Pending seat-mute (REST mirror of firebaseRoomService's pending mechanism:
// one global pending; a newer request supersedes an older one's retries).
let pendingSeatMute: { roomId: string; seatIdx: number; value: boolean } | null = null;

/**
 * Reliable seat-mute write over REST (§3.9 gap 5) — the EXACT
 * writeSeatMuteReliable discipline (delays [0,1000,3000,8000], pending
 * check before each attempt, return on success, retry on failure), with
 * the tier seat_mute/seat_unmute op in place of setSeatMute. Used by the
 * room screen's mic toggle AND MinimizedRoomBar in pass2 mode.
 */
export async function writePass2SeatMuteReliable(
  roomId: string,
  seatIdx: number,
  value: boolean,
): Promise<void> {
  pendingSeatMute = { roomId, seatIdx, value };
  const delays = [0, 1000, 3000, 8000];
  for (let i = 0; i < delays.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delays[i]));
    const p = pendingSeatMute;
    if (!p || p.roomId !== roomId || p.seatIdx !== seatIdx || p.value !== value) return;
    try {
      await sendPass2SeatMute(roomId, seatIdx, value);
      return;
    } catch {
      // retry on backoff; pending stays for snapshot reconciliation
    }
  }
}

// ─── Poll subscriptions (keep-last + 5-failure fallback discipline) ─────────

function makeStopper(): { closed: boolean; timers: Array<ReturnType<typeof setTimeout>>; stop: () => void } {
  const state = {
    closed: false,
    timers: [] as Array<ReturnType<typeof setTimeout>>,
    stop: () => {},
  };
  state.stop = () => {
    state.closed = true;
    for (const t of state.timers) clearTimeout(t);
    state.timers = [];
  };
  return state;
}

/** Home lists: private + mine, 30s, keep-last each, fallback after 5 dead rounds. */
export function subscribePass2HomeLists(
  onLists: (lists: { privateRooms: RoomInfo[]; mineRooms: RoomInfo[] }) => void,
  onFallback: () => void,
): () => void {
  const s = makeStopper();
  let lastPrivate: RoomInfo[] | null = null;
  let lastMine: RoomInfo[] | null = null;
  let deadRounds = 0;
  const poll = async () => {
    if (s.closed) return;
    const [priv, mine] = await Promise.all([fetchPass2PrivateRooms(), fetchPass2MineRooms()]);
    if (s.closed) return;
    let anyOk = false;
    if (priv !== null) { lastPrivate = priv; anyOk = true; }
    if (mine !== null) { lastMine = mine; anyOk = true; }
    if (!anyOk) {
      deadRounds++;
      if (deadRounds >= MAX_CONSEC_FAILURES) { s.stop(); onFallback(); return; }
    } else {
      deadRounds = 0;
      onLists({
        privateRooms: lastPrivate ?? [],
        mineRooms: lastMine ?? [],
      });
    }
    if (!s.closed) s.timers.push(setTimeout(poll, HOME_POLL_MS));
  };
  void poll();
  return s.stop;
}

/** Own profile via /users/me, 30s, cache-first, auxiliary (never falls back). */
export function subscribePass2MyProfile(
  uid: string,
  cb: (profile: Pass2Profile | null) => void,
): () => void {
  const s = makeStopper();
  const cacheKey = `vee_pass2_me_${uid}`;
  void AsyncStorage.getItem(cacheKey).then((raw) => {
    if (s.closed || !raw) return;
    try {
      const cached = JSON.parse(raw) as Pass2Profile;
      if (cached && cached.uid === uid) cb(cached);
    } catch { /* corrupt cache — poll will follow */ }
  }).catch(() => {});
  const poll = async () => {
    if (s.closed) return;
    const me = await fetchPass2Me();
    if (s.closed) return;
    if (me !== null) {
      void AsyncStorage.setItem(cacheKey, JSON.stringify(me)).catch(() => {});
      cb(me);
    }
    if (!s.closed) s.timers.push(setTimeout(poll, PROFILE_POLL_MS));
  };
  void poll();
  return s.stop;
}

/** Seat invites, 30s, auxiliary (server prunes expired; no client prune). */
export function subscribePass2SeatInvites(
  cb: (invites: Array<Record<string, any>>) => void,
): () => void {
  const s = makeStopper();
  let last: Array<Record<string, any>> | null = null;
  const poll = async () => {
    if (s.closed) return;
    const invites = await fetchPass2SeatInvites();
    if (s.closed) return;
    if (invites !== null) { last = invites; cb(invites); }
    else if (last !== null) { /* keep-last: deliver nothing, keep showing last */ }
    if (!s.closed) s.timers.push(setTimeout(poll, AUX_POLL_MS));
  };
  void poll();
  return s.stop;
}

/** Intimacy + handshake pairs, 30s, auxiliary (keep-last per pair). */
export function subscribePass2Pairs(
  pairs: Array<{ key: string; a: string; b: string }>,
  cb: (data: Record<string, { value: number; designKey: string | null }>) => void,
): () => void {
  const s = makeStopper();
  const last: Record<string, { value: number; designKey: string | null }> = {};
  const poll = async () => {
    if (s.closed) return;
    let changed = false;
    for (const p of pairs) {
      if (s.closed) return;
      const [rec, hs] = await Promise.all([
        fetchPass2IntimacyPair(p.a, p.b),
        fetchPass2PairHandshake(p.key),
      ]);
      if (rec !== null || hs !== null) {
        const prev = last[p.key];
        const next = {
          value: rec !== null ? rec.value : (prev?.value ?? 0),
          designKey: hs !== null ? hs.designKey : (prev?.designKey ?? null),
        };
        if (!prev || prev.value !== next.value || prev.designKey !== next.designKey) changed = true;
        last[p.key] = next;
      }
    }
    if (changed && !s.closed) cb({ ...last });
    if (!s.closed) s.timers.push(setTimeout(poll, AUX_POLL_MS));
  };
  void poll();
  return s.stop;
}

// ─── DM (Part 2b, 100k closure) ─────────────────────────────────────────────
// Tier :3010 DM endpoints (verified in the tier source — no others are
// invented here). Same discipline as the rest of this file: authedFetchJson
// (Firebase ID token Bearer, 5s timeout), keep-last on polls (deliver only
// on success), 5 consecutive dead rounds (or a 403) on a fatal poll stops
// it and calls onFallback (the screen flips its dm flag off, sticky, and
// resubscribes today's Firebase path).
//
// DELIBERATELY NOT WIRED (tier gaps, reported by the caller task):
//   - no mark-read endpoint (markAllSeen stays on the SDK, queued while
//     offline, applies on mode exit);
//   - no chat-list pin endpoint (tier pin pins a MESSAGE, not a chat);
//   - no clear-chat endpoint; no single-message delete endpoint (tier
//     delete is chat-level); no typing endpoint (typing is DROPPED in
//     poll mode by design); no FCM-on-DM-send (messages arrive via the
//     5s poll).

export type Pass2DmMessage = {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  ts: number;
  type: string;
  reactions?: Record<string, string>;
  [key: string]: unknown;
};

export type Pass2InboxChat = {
  chatId: string;
  peerUid?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount?: number;
  muted?: boolean;
  hidden?: boolean;
  peerProfile?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Pass2DmWindow = {
  messages: Pass2DmMessage[];
  cursor: string | null;
  resync: boolean;
};

const DM_INBOX_POLL_MS = 30_000;
const DM_MESSAGES_POLL_MS = 5000;

/** One-shot inbox read. Null = failure, caller keeps last. */
export async function fetchPass2Inbox(): Promise<Pass2InboxChat[] | null> {
  const r = await authedFetchJson('/chats/inbox');
  if (!r.ok || !Array.isArray(r.json?.chats)) return null;
  return r.json.chats as Pass2InboxChat[];
}

/** Inbox list, 30s, keep-last, fallback after 5 dead rounds. */
export function subscribePass2Inbox(
  cb: (chats: Pass2InboxChat[]) => void,
  onFallback: () => void,
): () => void {
  const s = makeStopper();
  let deadRounds = 0;
  const poll = async () => {
    if (s.closed) return;
    const chats = await fetchPass2Inbox();
    if (s.closed) return;
    if (chats === null) {
      deadRounds++;
      if (deadRounds >= MAX_CONSEC_FAILURES) { s.stop(); onFallback(); return; }
    } else {
      deadRounds = 0;
      cb(chats);
    }
    if (!s.closed) s.timers.push(setTimeout(poll, DM_INBOX_POLL_MS));
  };
  void poll();
  return s.stop;
}

/** One-shot DM window. Null = failure, caller keeps last. */
export async function fetchPass2DmMessages(
  chatId: string,
  since?: string | null,
): Promise<Pass2DmWindow | null> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const r = await authedFetchJson(`/dm/${encodeURIComponent(chatId)}/messages${q}`);
  if (!r.ok || !Array.isArray(r.json?.messages)) return null;
  const j = r.json as Record<string, unknown>;
  return {
    messages: j.messages as Pass2DmMessage[],
    cursor: typeof j.cursor === 'string' ? j.cursor : null,
    resync: j.resync === true,
  };
}

/**
 * DM thread window, 5s, keep-last + fallback discipline. Mirrors the room
 * /chat discipline in pass2PollService: cursor = latest id, resync:true
 * clears the accumulated map, dedupe by id, and the callback always gets
 * the FULL accumulated window sorted by id (push keys are chronological,
 * so id order is time order). A failed poll delivers nothing.
 */
export function subscribePass2DmMessages(
  chatId: string,
  cb: (messages: Pass2DmMessage[]) => void,
  onFallback: () => void,
): () => void {
  const s = makeStopper();
  let deadRounds = 0;
  let latestId: string | null = null;
  const byId = new Map<string, Pass2DmMessage>();
  const deliver = () => {
    cb([...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  };
  const poll = async () => {
    if (s.closed) return;
    const win = await fetchPass2DmMessages(chatId, latestId);
    if (s.closed) return;
    if (win === null) {
      deadRounds++;
      if (deadRounds >= MAX_CONSEC_FAILURES) { s.stop(); onFallback(); return; }
      if (!s.closed) s.timers.push(setTimeout(poll, DM_MESSAGES_POLL_MS));
      return;
    }
    deadRounds = 0;
    if (win.resync) byId.clear();
    for (const m of win.messages) {
      if (m && typeof m.id === 'string' && !byId.has(m.id)) byId.set(m.id, m);
    }
    if (win.cursor) latestId = win.cursor;
    else if (win.messages.length > 0) {
      const last = win.messages[win.messages.length - 1];
      if (last && typeof last.id === 'string') latestId = last.id;
    }
    deliver();
    if (!s.closed) s.timers.push(setTimeout(poll, DM_MESSAGES_POLL_MS));
  };
  void poll();
  return s.stop;
}

/** DM text send (TEXT ONLY — no replyTo, media, voice, or custom id). Throws on non-2xx. */
export async function sendPass2DmMessage(
  chatId: string,
  text: string,
): Promise<Pass2DmMessage> {
  const r = await authedFetchJson(`/dm/${encodeURIComponent(chatId)}/message`, {
    method: 'POST',
    body: { text },
  });
  if (!r.ok || !r.json || typeof r.json.message !== 'object') {
    throw new Error(`pass2 dm send failed (${r.status})`);
  }
  return r.json.message as Pass2DmMessage;
}

/**
 * DM ops: react | pin | mute | hide | delete. Throws on non-2xx.
 * NOTE: pin pins a MESSAGE (chats/:id/pinned/:messageId) — it is NOT
 * chat-list pinning. delete is CHAT-level (removes the caller's userChat
 * entry) — it is NOT single-message delete.
 */
export async function sendPass2DmOp(
  chatId: string,
  op: 'react' | 'pin' | 'mute' | 'hide' | 'delete',
  body?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const r = await authedFetchJson(`/dm/${encodeURIComponent(chatId)}/${op}`, {
    method: 'POST',
    body: body ?? {},
  });
  if (!r.ok) throw new Error(`pass2 dm ${op} failed (${r.status})`);
  return (r.json as Record<string, unknown> | null) ?? null;
}

/** Create-or-get a DM chat. Returns the chatId (sorted uids joined with '_'). Throws on failure. */
export async function createPass2Dm(peerUid: string): Promise<string> {
  const r = await authedFetchJson('/dm/create', {
    method: 'POST',
    body: { peerUid },
  });
  if (!r.ok || typeof r.json?.chatId !== 'string') {
    throw new Error(`pass2 dm create failed (${r.status})`);
  }
  return r.json.chatId as string;
}
