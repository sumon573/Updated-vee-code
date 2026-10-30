/**
 * Pass2 poll service (another-pass Phase 1, staging build).
 *
 * Polls the STAGING poller for the room-screen residual that the watcher
 * path leaves on Firebase (DESIGN.md §3.2):
 *   - /watch extension fields (same 30s fetch, zero new requests):
 *     announcement, blocks, decor (storeBackground, activeMicDecor),
 *     grabTop, liveFlags (pkActive, musicPlaying, gameActive).
 *   - NEW /events?since= (5s, room screen only): emoji reactions, entry
 *     events, gift events — append-only streams with a push-key cursor
 *     and resync flag, the identical pattern to /chat in
 *     watcherPollService.ts.
 *   - NEW /live (5s, CONDITIONAL): PK + music + games state, polled ONLY
 *     while the latest /watch liveFlags say one is active. Otherwise not
 *     polled at all — a permanent 5s poll for every room session would
 *     defeat the load story.
 *   - Beat (60s, optional): same /beat as the watcher path, plus the
 *     optional seatIdx (§3.3) so the poller can refresh a seated
 *     poll-mode user's seat heartbeat server-side. The screen enables
 *     the beat ONLY when the watcher poll is not already beating
 *     (seated/private pass2 sessions); audience pass2 sessions reuse
 *     the watcher beat and must not double-beat.
 *
 * Callback shapes are the SAME as the Firebase subscribes
 * (RoomEmojiReaction / RoomEntryEvent / RoomGiftEvent / RoomAnnouncement
 * / RoomMusic / RoomPk / RoomGame[] / blocks Map), so the screen maps
 * them with its existing handlers. Keep-last + fallback discipline is
 * copied exactly from watcherPollService.ts: a failed poll never
 * delivers an empty snapshot; 5 consecutive failures (or a 403) on
 * /watch or /events → onFallback (sticky for the session — the screen
 * flips its pass2 room flag off and resubscribes Firebase). /live
 * failures are NON-fatal (keep-last live state; the watch-flag cycle
 * restarts live polling) because a frozen PK banner must not collapse
 * the whole room mode.
 *
 * BASE URL — staging constant, what drills use:
 *   PASS2_POLLER_BASE (staging) = staging poller proc :3011 on the VPS
 *                                  (http://207.180.253.22:3011).
 *   Production mapping (documented only): the live poller :3009 behind
 *   Caddy /ws-state/* (the watcher path's base). When the staged poller
 *   build is promoted, point the production constant at the watcher
 *   base — one-line change, no call-site edits.
 */
import type {
  RoomInfo,
  RoomSeat,
  RoomAudienceMember,
  SeatRequest,
  RoomEmojiReaction,
  RoomEntryEvent,
  RoomGiftEvent,
  RoomBlockRecord,
} from './firebaseRoomService';
import type { RoomChatMsg } from './firebaseRoomChatService';
import type { RoomMusic } from './roomMusicService';
import type { RoomPk } from './roomPkService';
import type { RoomGame } from './roomGameService';
import type { RoomAnnouncement } from './roomAnnouncementService';

/** Staging poller (:3011) — what drills use. */
export const PASS2_POLLER_BASE = 'http://207.180.253.22:3011';
/** Production mapping (documented only — NOT activated by this build). */
export const PASS2_POLLER_BASE_PRODUCTION = 'https://vee-club.duckdns.org/ws-state';

const FETCH_TIMEOUT_MS = 5000;
const WATCH_MS = 30_000;
const WATCH_BACKOFF_MS = 60_000;
const EVENTS_MS = 5000;
const EVENTS_BACKOFF_MAX_MS = 30_000;
const LIVE_MS = 5000;
const BEAT_MS = 60_000;
const QUICK_RETRY_MS = 2000;
const MAX_QUICK_RETRIES = 5;
const MAX_CONSEC_FAILURES = 5;
const MAX_LIVE_FAILURES = 5;
const CHAT_MS = 5000;
const CHAT_SLOW_MS = 10000;
const CHAT_MAX_MS = 30000;

export type Pass2LiveFlags = {
  pkActive: boolean;
  musicPlaying: boolean;
  gameActive: boolean;
};

export type Pass2Decor = {
  storeBackground?: string | null;
  activeMicDecor?: string | null;
};

export type Pass2LiveState = {
  pk: RoomPk | null;
  music: RoomMusic | null;
  games: RoomGame[];
};

export type Pass2Profile = {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  nobleRankIndex?: number;
};

export type Pass2PollCallbacks = {
  /** /watch extension fields (always delivered on a loaded watch). */
  onAnnouncement: (ann: RoomAnnouncement | null) => void;
  onBlocks: (blocks: Map<string, RoomBlockRecord>) => void;
  onDecor: (decor: Pass2Decor) => void;
  onGrabTop: (value: unknown) => void;
  onLiveFlags: (flags: Pass2LiveFlags) => void;
  /** /events stream (one call per NEW event, deduped by push-key id). */
  onReaction: (reaction: RoomEmojiReaction) => void;
  onEntry: (entry: RoomEntryEvent) => void;
  onGift: (event: RoomGiftEvent) => void;
  /** /live state while active; null when activity ends (clears stale PK/music/games). */
  onLive: (live: Pass2LiveState | null) => void;
  /** Optional base /watch payload (seated/private future use; audience reuses watcherPollService). */
  onInfo?: (info: RoomInfo | null) => void;
  onSeats?: (seats: Array<RoomSeat | null>) => void;
  onAudience?: (audience: RoomAudienceMember[]) => void;
  onAdmins?: (adminUids: Set<string>) => void;
  onSeatRequests?: (requests: SeatRequest[]) => void;
  onMember?: (isMember: boolean) => void;
  /** /watch memberCount (owner/admin header count). */
  onMemberCount?: (count: number) => void;
  /** /chat stream (seated/private only — audience reuses watcherPollService).
      Full accumulated window, same shape as subscribeRoomChat. Passed only
      when the watcher poll is NOT delivering chat (no double delivery). */
  onChat?: (msgs: RoomChatMsg[]) => void;
  onFallback: () => void;
};

export type Pass2PollApi = {
  unsubscribe: () => void;
  /** Immediate beat (foreground return, §3.8) — no-op when beating is off. */
  beatNow: () => void;
};

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Duplicate-seat guard — same rule as watcherPollService (boss law 2026-10-23). */
function guardSeats(seats: Array<RoomSeat | null>): Array<RoomSeat | null> {
  const out = [...seats];
  while (out.length < 10) out.push(null);
  const bestIdxByUser = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    const s = out[i] as { userId?: string; seatTs?: number } | null;
    if (!s || !s.userId) continue;
    const prev = bestIdxByUser.get(s.userId);
    if (prev === undefined) { bestIdxByUser.set(s.userId, i); continue; }
    const prevTs = (out[prev] as { seatTs?: number } | null)?.seatTs ?? 0;
    if ((s.seatTs ?? 0) > prevTs) {
      out[prev] = null;
      bestIdxByUser.set(s.userId, i);
    } else {
      out[i] = null;
    }
  }
  return out.slice(0, 10);
}

function normalizeBlocks(raw: unknown): Map<string, RoomBlockRecord> {
  const map = new Map<string, RoomBlockRecord>();
  if (Array.isArray(raw)) {
    for (const b of raw) {
      if (b && typeof b.userId === 'string') map.set(b.userId, b as RoomBlockRecord);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, b] of Object.entries(raw as Record<string, unknown>)) {
      if (b && typeof b === 'object') map.set(k, b as RoomBlockRecord);
    }
  }
  return map;
}

function normalizeLiveFlags(raw: unknown): Pass2LiveFlags {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    pkActive: f.pkActive === true,
    musicPlaying: f.musicPlaying === true,
    gameActive: f.gameActive === true,
  };
}

export function subscribePass2RoomPoll(
  roomId: string,
  opts: {
    myUid: string;
    profile: Pass2Profile;
    getToken: () => Promise<string | null>;
    /** Enable the 60s beat (seated/private only — watcher already beats for audience). */
    beat?: boolean;
    /** Current seat index for the beat's seatIdx (§3.3); -1/undefined = audience. */
    getSeatIdx?: () => number;
  },
  cbs: Pass2PollCallbacks,
): Pass2PollApi {
  let closed = false;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let chatTimer: ReturnType<typeof setTimeout> | null = null;
  let eventsTimer: ReturnType<typeof setTimeout> | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  let beatTimer: ReturnType<typeof setTimeout> | null = null;
  let watchFails = 0;
  let watchQuick = 0;
  let eventsFails = 0;
  let eventsInterval = EVENTS_MS;
  let liveFails = 0;
  let liveActive = false;
  let beatSession: string | null = null;
  let lastEventId: string | null = null;
  const seenEventIds = new Set<string>();
  let chatFails = 0;
  let chatQuick = 0;
  let chatInterval = CHAT_MS;
  let lastChatId: string | null = null;
  const chatById = new Map<string, RoomChatMsg>();

  const stop = () => {
    closed = true;
    if (watchTimer !== null) clearTimeout(watchTimer);
    if (chatTimer !== null) clearTimeout(chatTimer);
    if (eventsTimer !== null) clearTimeout(eventsTimer);
    if (liveTimer !== null) clearTimeout(liveTimer);
    if (beatTimer !== null) clearTimeout(beatTimer);
    watchTimer = null;
    chatTimer = null;
    eventsTimer = null;
    liveTimer = null;
    beatTimer = null;
  };
  const fallback = () => {
    if (closed) return;
    stop();
    cbs.onFallback();
  };

  // Private-room gate (DESIGN §3.4): the staging poller gates EVERY read
  // endpoint on a Bearer ID token (token uid only — no ?uid= fallback).
  // Without this header a private room's /watch//events//live//chat all
  // 403 → fallback, so private pass2 would be dead on arrival. Public
  // rooms ignore the header (gate skipped), so sending it always is safe.
  // getToken() resolves the cached token (no network unless expired).
  const authedFetchJson = async (
    url: string,
  ): Promise<{ ok: boolean; status: number; json: any }> => {
    const token = await opts.getToken().catch(() => null);
    return fetchJson(
      url,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
  };

  const deliverWatchExtras = (j: Record<string, unknown>) => {
    const ann = (j.announcement ?? null) as RoomAnnouncement | null;
    cbs.onAnnouncement(ann && typeof ann === 'object' ? ann : null);
    cbs.onBlocks(normalizeBlocks(j.blocks));
    const decor = (j.decor && typeof j.decor === 'object' ? j.decor : {}) as Record<string, unknown>;
    cbs.onDecor({
      storeBackground: typeof decor.storeBackground === 'string' ? decor.storeBackground : null,
      activeMicDecor: typeof decor.activeMicDecor === 'string' ? decor.activeMicDecor : null,
    });
    cbs.onGrabTop(j.grabTop ?? null);
    const flags = normalizeLiveFlags(j.liveFlags);
    cbs.onLiveFlags(flags);
    updateLivePolling(flags);
  };

  const pollLive = async () => {
    if (closed || !liveActive) return;
    const r = await authedFetchJson(
      `${PASS2_POLLER_BASE}/room/${encodeURIComponent(roomId)}/live?uid=${encodeURIComponent(opts.myUid)}`,
    );
    if (closed || !liveActive) return;
    if (!r.ok) {
      if (r.status === 403) { fallback(); return; }
      liveFails++;
      if (liveFails >= MAX_LIVE_FAILURES) {
        // Non-fatal: stop live polling, keep last live state on screen.
        // The next /watch with liveFlags active restarts it.
        liveActive = false;
        liveTimer = null;
        return;
      }
      liveTimer = setTimeout(pollLive, LIVE_MS);
      return;
    }
    const j = r.json as Record<string, unknown> | null;
    if (!j || j.loaded !== true) {
      liveTimer = setTimeout(pollLive, LIVE_MS);
      return;
    }
    liveFails = 0;
    cbs.onLive({
      pk: (j.pk ?? null) as RoomPk | null,
      music: (j.music ?? null) as RoomMusic | null,
      games: Array.isArray(j.games) ? (j.games as RoomGame[]) : [],
    });
    if (!closed && liveActive) liveTimer = setTimeout(pollLive, LIVE_MS);
  };

  const updateLivePolling = (flags: Pass2LiveFlags) => {
    const anyActive = flags.pkActive || flags.musicPlaying || flags.gameActive;
    if (anyActive && !liveActive) {
      liveActive = true;
      liveFails = 0;
      void pollLive();
    } else if (!anyActive && liveActive) {
      liveActive = false;
      if (liveTimer !== null) clearTimeout(liveTimer);
      liveTimer = null;
      cbs.onLive(null);
    }
  };

  const pollWatch = async () => {
    if (closed) return;
    const r = await authedFetchJson(
      `${PASS2_POLLER_BASE}/room/${encodeURIComponent(roomId)}/watch?uid=${encodeURIComponent(opts.myUid)}`,
    );
    if (closed) return;
    if (!r.ok) {
      if (r.status === 403) { fallback(); return; }
      watchFails++;
      if (watchFails >= MAX_CONSEC_FAILURES) { fallback(); return; }
      watchTimer = setTimeout(pollWatch, WATCH_BACKOFF_MS);
      return;
    }
    const j = r.json as Record<string, unknown> | null;
    if (!j || j.loaded !== true) {
      watchQuick++;
      watchTimer = setTimeout(pollWatch, watchQuick <= MAX_QUICK_RETRIES ? QUICK_RETRY_MS : WATCH_MS);
      return;
    }
    watchFails = 0;
    watchQuick = 0;
    deliverWatchExtras(j);
    // Optional base payload (seated/private consumers; audience ignores).
    if (j.info === null || j.info === undefined) {
      cbs.onInfo?.(null);
    } else {
      cbs.onInfo?.(j.info as RoomInfo);
      cbs.onSeats?.(guardSeats(Array.isArray(j.seats) ? j.seats : []));
      const aud = Array.isArray(j.audience) ? [...j.audience] : [];
      aud.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
      cbs.onAudience?.(aud as RoomAudienceMember[]);
      cbs.onAdmins?.(new Set<string>(Array.isArray(j.adminUids) ? j.adminUids : []));
      cbs.onSeatRequests?.(Array.isArray(j.pendingRequests) ? j.pendingRequests : []);
      cbs.onMember?.(j.amIMember === true);
      if (typeof j.memberCount === 'number') cbs.onMemberCount?.(j.memberCount);
    }
    watchTimer = setTimeout(pollWatch, WATCH_MS);
  };

  const pollEvents = async () => {
    if (closed) return;
    const since = lastEventId ? `?since=${encodeURIComponent(lastEventId)}` : '';
    const r = await authedFetchJson(
      `${PASS2_POLLER_BASE}/room/${encodeURIComponent(roomId)}/events${since}`,
    );
    if (closed) return;
    if (!r.ok) {
      if (r.status === 403) { fallback(); return; }
      eventsFails++;
      if (eventsFails >= MAX_CONSEC_FAILURES) { fallback(); return; }
      eventsInterval = Math.min(eventsInterval * 2, EVENTS_BACKOFF_MAX_MS);
      eventsTimer = setTimeout(pollEvents, eventsInterval);
      return;
    }
    const j = r.json as Record<string, unknown> | null;
    if (!j || j.loaded !== true) {
      eventsTimer = setTimeout(pollEvents, eventsInterval);
      return;
    }
    eventsFails = 0;
    eventsInterval = EVENTS_MS;
    const rawEvents = Array.isArray(j.events) ? j.events : (Array.isArray(j.msgs) ? j.msgs : []);
    if (j.resync === true) seenEventIds.clear();
    for (const e of rawEvents as Array<Record<string, unknown>>) {
      if (!e || typeof e.id !== 'string') continue;
      if (seenEventIds.has(e.id)) continue;
      seenEventIds.add(e.id);
      if (e.kind === 'reaction') cbs.onReaction(e as unknown as RoomEmojiReaction);
      else if (e.kind === 'entry') cbs.onEntry(e as unknown as RoomEntryEvent);
      else if (e.kind === 'gift') cbs.onGift(e as unknown as RoomGiftEvent);
    }
    if (typeof j.latestId === 'string' && j.latestId) lastEventId = j.latestId;
    eventsTimer = setTimeout(pollEvents, eventsInterval);
  };

  const deliverChat = () => {
    if (!cbs.onChat) return;
    const list = [...chatById.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((m) => ({ ...m, isMe: m.senderId === opts.myUid }));
    cbs.onChat(list);
  };

  // /chat poll — the EXACT watcherPollService discipline, authed for the
  // private gate: 5s cadence, 10s when a poll takes >2000ms, doubling to
  // 30s on consecutive failures, 2s quick-retry x5 while not loaded (never
  // fall back on loading alone), 403 or 5 consecutive failures → fallback.
  // Only runs when the screen passed onChat (seated/private pass2); the
  // watcher audience path never starts this loop.
  const pollChat = async () => {
    if (closed || !cbs.onChat) return;
    const started = Date.now();
    const since = lastChatId ? `?since=${encodeURIComponent(lastChatId)}` : '';
    const r = await authedFetchJson(
      `${PASS2_POLLER_BASE}/room/${encodeURIComponent(roomId)}/chat${since}`,
    );
    if (closed || !cbs.onChat) return;
    if (!r.ok) {
      if (r.status === 403) { fallback(); return; }
      chatFails++;
      if (chatFails >= MAX_CONSEC_FAILURES) { fallback(); return; }
      chatInterval = Math.min(chatInterval * 2, CHAT_MAX_MS);
      chatTimer = setTimeout(pollChat, chatInterval);
      return;
    }
    const j = r.json as Record<string, unknown> | null;
    if (!j || j.loaded !== true) {
      chatQuick++;
      chatTimer = setTimeout(pollChat, chatQuick <= MAX_QUICK_RETRIES ? QUICK_RETRY_MS : chatInterval);
      return;
    }
    chatFails = 0;
    chatQuick = 0;
    if (j.resync === true) chatById.clear();
    for (const m of (Array.isArray(j.msgs) ? j.msgs : []) as Array<Record<string, unknown>>) {
      if (!m || typeof m.id !== 'string' || chatById.has(m.id)) continue;
      chatById.set(m.id, { ...(m as unknown as RoomChatMsg), isMe: (m as { senderId?: string }).senderId === opts.myUid });
    }
    if (typeof j.latestId === 'string' && j.latestId) lastChatId = j.latestId;
    deliverChat();
    const elapsed = Date.now() - started;
    chatInterval = elapsed > 2000 ? CHAT_SLOW_MS : CHAT_MS;
    chatTimer = setTimeout(pollChat, chatInterval);
  };

  const pollBeat = async () => {
    if (closed || opts.beat !== true) return;
    const post = async (extra: Record<string, unknown>) => fetchJson(
      `${PASS2_POLLER_BASE}/room/${encodeURIComponent(roomId)}/beat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: opts.profile, ...extra }),
      },
    );
    const seatIdx = opts.getSeatIdx?.() ?? -1;
    const extra: Record<string, unknown> = beatSession ? { session: beatSession } : {};
    if (seatIdx >= 0) extra.seatIdx = seatIdx;
    let r = await post(extra);
    if (!closed && !r.ok && r.status === 401) {
      const token = await opts.getToken().catch(() => null);
      if (token && !closed) r = await post({ firebaseToken: token, ...extra });
    }
    if (!closed && r.ok && r.json && typeof r.json.session === 'string') {
      beatSession = r.json.session;
    }
    // Beat failures never fall back and never surface (watcher rule).
    if (!closed && opts.beat === true) beatTimer = setTimeout(pollBeat, BEAT_MS);
  };

  pollWatch();
  pollEvents();
  if (cbs.onChat) void pollChat();
  if (opts.beat === true) void pollBeat();

  return {
    unsubscribe: stop,
    beatNow: () => {
      if (closed || opts.beat !== true) return;
      if (beatTimer !== null) clearTimeout(beatTimer);
      beatTimer = null;
      void pollBeat();
    },
  };
}
