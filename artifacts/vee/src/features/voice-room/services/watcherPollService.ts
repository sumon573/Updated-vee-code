/**
 * Watcher poll service (100k-user watcher path, Phase 2 — prepared, inert
 * until the server cutover flag is on).
 *
 * For audience clients in PUBLIC rooms, this replaces the five Firebase
 * listeners (info / seats / audience / admins / chat) with plain HTTP polls
 * against the VPS poller (Caddy /ws-state/* -> poller proc). No held sockets
 * per watcher, no Cloudflare requests, no Firebase connection at all while
 * polling. Chat sends still go through Firebase (unchanged); LiveKit audio
 * subscription is unchanged.
 *
 * Shapes delivered to the callbacks are IDENTICAL to the Firebase subscribe
 * callbacks (same RoomInfo / RoomSeat / RoomAudienceMember / RoomChatMsg
 * values), so the screen's existing mapping + signature-guard code works
 * unchanged. Keep-last rules mirror the Firebase services: a failed poll
 * never delivers an empty snapshot (no mid-room wipe); repeated failures
 * trigger onFallback, and the screen re-enables today's Firebase path.
 * The cutover flag is fail-closed: unreadable -> poll off -> Firebase path.
 */
import type {
  RoomInfo,
  RoomSeat,
  RoomAudienceMember,
  SeatRequest,
} from './firebaseRoomService';
import type { RoomChatMsg } from './firebaseRoomChatService';
import type { EdgeChatMsg } from './edgeRoomChatService';

const POLL_BASE = 'https://vee-club.duckdns.org/ws-state';
const FETCH_TIMEOUT_MS = 5000;
const WATCH_MS = 30000;
const WATCH_BACKOFF_MS = 60000;
const CHAT_MS = 5000;
const CHAT_SLOW_MS = 10000;
const CHAT_MAX_MS = 30000;
const BEAT_MS = 60000;
const QUICK_RETRY_MS = 2000;
const MAX_QUICK_RETRIES = 5;
const MAX_CONSEC_FAILURES = 5;

export type WatcherFlag = { poll: boolean; live: boolean };
export type WatcherProfile = {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  nobleRankIndex?: number;
};
export type WatcherCallbacks = {
  onInfo: (info: RoomInfo | null) => void;
  onSeats: (seats: Array<RoomSeat | null>) => void;
  onAudience: (audience: RoomAudienceMember[]) => void;
  onAdmins: (adminUids: Set<string>) => void;
  onSeatRequests: (requests: SeatRequest[]) => void;
  onMember: (isMember: boolean) => void;
  onChat: (msgs: RoomChatMsg[]) => void;
  onFallback: () => void;
};
export type WatcherPollApi = {
  unsubscribe: () => void;
  injectEdgeMsg: (msg: EdgeChatMsg) => void;
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
    try { json = await res.json(); } catch (e) { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Cutover flag. Any failure -> { poll: false, live: false } (fail-closed). */
export async function fetchWatcherFlag(roomId: string): Promise<WatcherFlag> {
  const closed: WatcherFlag = { poll: false, live: false };
  try {
    const r = await fetchJson(
      `${POLL_BASE}/room/${encodeURIComponent(roomId)}/watcher-flag`,
    );
    if (!r.ok || !r.json) return closed;
    return {
      poll: r.json.poll === true,
      live: r.json.live === true,
    };
  } catch (e) {
    return closed;
  }
}

/**
 * Duplicate-seat guard — EXACT copy of the rule in
 * firebaseRoomService.subscribeSeats (2026-10-23 boss law: one ID never in
 * two seats): keep the seat with the freshest seatTs; ties keep the lower
 * index. Applied here so poll-delivered seats are as clean as Firebase's.
 */
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

export function subscribeWatcherPoll(
  roomId: string,
  opts: {
    myUid: string;
    profile: WatcherProfile;
    getToken: () => Promise<string | null>;
  },
  cbs: WatcherCallbacks,
): WatcherPollApi {
  let closed = false;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let chatTimer: ReturnType<typeof setTimeout> | null = null;
  let beatTimer: ReturnType<typeof setTimeout> | null = null;
  let watchFails = 0;
  let chatFails = 0;
  let watchQuick = 0;
  let chatQuick = 0;
  let chatInterval = CHAT_MS;
  let beatSession: string | null = null;
  let lastChatId: string | null = null;
  const chatById = new Map<string, RoomChatMsg>();

  const stop = () => {
    closed = true;
    if (watchTimer !== null) clearTimeout(watchTimer);
    if (chatTimer !== null) clearTimeout(chatTimer);
    if (beatTimer !== null) clearTimeout(beatTimer);
    watchTimer = null;
    chatTimer = null;
    beatTimer = null;
  };
  const fallback = () => {
    if (closed) return;
    stop();
    cbs.onFallback();
  };
  const deliverChat = () => {
    const list = [...chatById.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((m) => ({ ...m, isMe: m.senderId === opts.myUid }));
    cbs.onChat(list);
  };

  const pollWatch = async () => {
    if (closed) return;
    const started = Date.now();
    const r = await fetchJson(
      `${POLL_BASE}/room/${encodeURIComponent(roomId)}/watch?uid=${encodeURIComponent(opts.myUid)}`,
    );
    if (closed) return;
    if (!r.ok) {
      if (r.status === 403) { fallback(); return; }
      watchFails++;
      if (watchFails >= MAX_CONSEC_FAILURES) { fallback(); return; }
      watchTimer = setTimeout(pollWatch, WATCH_BACKOFF_MS);
      return;
    }
    const j = r.json;
    if (!j || j.loaded !== true) {
      // Poller is working but the room's Firebase snapshot hasn't landed
      // yet: retry fast, never deliver a half snapshot, never fall back
      // on loading alone (the poller's listeners fire in <2s typically).
      watchQuick++;
      watchTimer = setTimeout(pollWatch, watchQuick <= MAX_QUICK_RETRIES ? QUICK_RETRY_MS : WATCH_MS);
      return;
    }
    watchFails = 0;
    watchQuick = 0;
    if (j.info === null || j.info === undefined) {
      // Loaded and the room truly has no info -> room-closed path, same as
      // subscribeRoomInfo delivering null.
      cbs.onInfo(null);
    } else {
      cbs.onInfo(j.info as RoomInfo);
      cbs.onSeats(guardSeats(Array.isArray(j.seats) ? j.seats : []));
      const aud = Array.isArray(j.audience) ? [...j.audience] : [];
      aud.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
      cbs.onAudience(aud);
      cbs.onAdmins(new Set<string>(Array.isArray(j.adminUids) ? j.adminUids : []));
      cbs.onSeatRequests(Array.isArray(j.pendingRequests) ? j.pendingRequests : []);
      cbs.onMember(j.amIMember === true);
    }
    void started;
    watchTimer = setTimeout(pollWatch, WATCH_MS);
  };

  const pollChat = async () => {
    if (closed) return;
    const started = Date.now();
    const since = lastChatId ? `?since=${encodeURIComponent(lastChatId)}` : '';
    const r = await fetchJson(
      `${POLL_BASE}/room/${encodeURIComponent(roomId)}/chat${since}`,
    );
    if (closed) return;
    if (!r.ok) {
      if (r.status === 403) { fallback(); return; }
      chatFails++;
      if (chatFails >= MAX_CONSEC_FAILURES) { fallback(); return; }
      chatInterval = Math.min(chatInterval * 2, CHAT_MAX_MS);
      chatTimer = setTimeout(pollChat, chatInterval);
      return;
    }
    const j = r.json;
    if (!j || j.loaded !== true) {
      chatQuick++;
      chatTimer = setTimeout(pollChat, chatQuick <= MAX_QUICK_RETRIES ? QUICK_RETRY_MS : chatInterval);
      return;
    }
    chatFails = 0;
    chatQuick = 0;
    if (j.resync === true) {
      chatById.clear();
      for (const m of Array.isArray(j.msgs) ? j.msgs : []) chatById.set(m.id, m);
    } else {
      for (const m of Array.isArray(j.msgs) ? j.msgs : []) chatById.set(m.id, m);
    }
    if (typeof j.latestId === 'string' && j.latestId) lastChatId = j.latestId;
    deliverChat();
    const elapsed = Date.now() - started;
    chatInterval = elapsed > 2000 ? CHAT_SLOW_MS : CHAT_MS;
    chatTimer = setTimeout(pollChat, chatInterval);
  };

  const pollBeat = async () => {
    if (closed) return;
    const post = async (extra: Record<string, unknown>) => fetchJson(
      `${POLL_BASE}/room/${encodeURIComponent(roomId)}/beat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: opts.profile, ...extra }),
      },
    );
    let r = await post(beatSession ? { session: beatSession } : {});
    if (!closed && !r.ok && r.status === 401) {
      const token = await opts.getToken().catch(() => null);
      if (token && !closed) r = await post({ firebaseToken: token });
    }
    if (!closed && r.ok && r.json && typeof r.json.session === 'string') {
      beatSession = r.json.session;
    }
    // Beat failures never fall back and never surface: presence just goes
    // stale until the next beat. The count drops, the room keeps working.
    if (!closed) beatTimer = setTimeout(pollBeat, BEAT_MS);
  };

  pollWatch();
  pollChat();
  pollBeat();

  return {
    unsubscribe: stop,
    injectEdgeMsg: (msg: EdgeChatMsg) => {
      if (closed) return;
      chatById.set(msg.id, { ...(msg as unknown as RoomChatMsg), isMe: msg.senderId === opts.myUid });
      deliverChat();
    },
  };
}
