/* Vee Music Bot v2 (2026-10-25): room-wide music via a headless-Edge
 * publisher page — replaces the WHIP design (livekit-server has NO native
 * WHIP endpoint and its CreateIngress returns an empty url without the
 * separate ingress service, which needs GStreamer/Docker — unavailable on
 * this Windows VPS).
 *
 * How it works: this bot owns the RTDB contract (roomMusic/*) and a tiny
 * localhost HTTP bridge (127.0.0.1:3004). A headless Edge page
 * (player.html, task VeeMusicPage) polls /state, joins each playing room
 * as 'vee-music', plays the track in an <audio> element, captures its
 * stream and publishes it as a Microphone-source track — so every room
 * member hears it in sync, and the app's existing music-volume logic
 * (identity 'vee-music' + Microphone source) works unchanged.
 *
 * RTDB contract (unchanged from v1, client untouched):
 *   roomMusic/{roomId} = { queue: {pushId: {title,url,mediaId,addedBy,
 *     addedByName,addedAt,durationSec?}}, state: 'playing'|'paused'|
 *     'stopped'|'idle'|'next', current: {queueId,title,url,mediaId,
 *     positionSec,startedAt,durationSec?}, playQueueId?: queueId }
 * Loop-proofing (lesson from the v1 PLAY-spam): a track already playing
 * is NEVER restarted by reconcile — resume happens only when the bot is
 * not already playing that queueId (fresh process, or after pause/stop).
 * Stop semantics (2026-10-25 fix): 'stopped' keeps `current` with
 * positionSec reset to 0 (state -> 'idle'), so Play restarts the same
 * song from the beginning; with no current, Play starts the queue head.
 * startTrack always writes state 'playing' first (Next-while-paused used
 * to self-pause on the next position tick).
 * Hygiene (2026-10-25): ensureCached aborts a stalled media download
 * after 25s (fails into START-FAIL -> advance), and a busy watchdog
 * releases a pass stuck longer than 60s (PASS-STUCK) so later taps can
 * run instead of piling onto `pending` forever.
 * Tap-to-play (2026-10-25): the client writes roomMusic/{roomId}/
 * playQueueId; reconcile consumes it FIRST (before every state branch):
 * the queued song is removed from the queue, the field cleared, and the
 * song started directly — consume-before-start, so a START-FAIL advances
 * to the next song. A stale/missing id just clears and normal handling
 * continues. Log file moved to bot-v2.log (bot.log is ACL-locked and
 * has been blind since Oct 24).
 */
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const admin = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const SA = JSON.parse(fs.readFileSync('C:\\vee-api\\sa.json', 'utf8'));
admin.initializeApp({ credential: admin.cert(SA), databaseURL: 'https://vee-chat-36720-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

const LOGF = 'C:\\vee-music-bot\\bot-v2.log';
function log(m) { const l = '[' + new Date().toISOString() + '] ' + m + '\n'; try { fs.appendFileSync(LOGF, l); } catch (e) {} }

// LiveKit key/secret (never logged) — same parse as the other VPS tools.
const ylines = fs.readFileSync('C:\\livekit\\livekit.yaml', 'utf8').split(/\r?\n/);
const ki = ylines.findIndex((l) => /^keys:/.test(l));
const kv = ylines.slice(ki + 1).find((l) => /\S/.test(l)).trim().split(/:\s+/);
const LK_KEY = kv[0], LK_SEC = kv.slice(1).join(':');
const b64u = (s) => Buffer.from(s).toString('base64url');
function joinToken(roomId) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: LK_KEY, sub: 'vee-music', name: 'Music', nbf: now - 10, exp: now + 86400, jti: 'mp' + now, video: { roomJoin: true, room: roomId } }));
  return h + '.' + p + '.' + crypto.createHmac('sha256', LK_SEC).update(h + '.' + p).digest('base64url');
}

const rooms = {}; // roomId -> { cur, posOff, startedAt, playing, cmdId, cmd }
const CACHE = 'C:\\vee-music-bot\\cache';
async function ensureCached(mediaId, url) {
  try { fs.mkdirSync(CACHE, { recursive: true }); } catch (e) {}
  const f = CACHE + '\\' + mediaId;
  try { const st = fs.statSync(f); if (st.size > 0) return f; } catch (e) {}
  // A stalled Telegram/media download used to hang this await forever,
  // wedging the whole reconcile pass (busy never cleared, every later
  // tap only set `pending` and never ran). 25s, then fail into the
  // existing START-FAIL -> advance path instead of stalling the pass.
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 25000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('media fetch ' + res.status);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    return f;
  } finally { clearTimeout(timer); }
}
let cmdSeq = 0;
function posOf(s) { return s ? s.posOff + (s.startedAt ? (Date.now() - s.startedAt) / 1000 : 0) : 0; }
// Queue order is addedAt, with the RTDB push key as tie-break (two adds in
// the same millisecond must still come out in the order they were pushed).
function sortQueue(q) { return q.sort((a, b) => (a.addedAt - b.addedAt) || (a.queueId < b.queueId ? -1 : a.queueId > b.queueId ? 1 : 0)); }
function setCmd(roomId, s, action, track, positionSec) {
  const cmd = { id: ++cmdSeq, action, url: track ? ('/audio/' + encodeURIComponent(track.mediaId)) : null, positionSec: positionSec || 0, token: joinToken(roomId) };
  s.cmd = cmd; s.cmdId = cmd.id; rooms[roomId] = s; return cmd;
}

async function startTrack(roomId, s, track) {
  // Top guard: never start while this room is already playing (any caller).
  if (s.playing) return;
  try { await ensureCached(track.mediaId, track.url); } catch (e) { log('START-FAIL ' + roomId + ' ' + e.message); await advance(roomId, s); return; }
  const pos = Math.floor(track.positionSec || 0);
  s.cur = track; s.posOff = pos; s.startedAt = Date.now(); s.playing = true;
  // State FIRST, then current: a start must never leave RTDB saying
  // 'paused' while a track is playing — the next reconcile (or the 15s
  // position tick) would pause it again. This is what made Next-while-
  // paused self-pause. The busy flag drops the intermediate value events,
  // so this ordering causes no flicker.
  await db.ref('roomMusic/' + roomId + '/state').set('playing');
  const curObj = { queueId: track.queueId, title: track.title, url: track.url, mediaId: track.mediaId, positionSec: pos, startedAt: Date.now() };
  if (track.durationSec) curObj.durationSec = Math.floor(track.durationSec);
  await db.ref('roomMusic/' + roomId + '/current').set(curObj);
  setCmd(roomId, s, 'play', track, pos);
  log('PLAY ' + roomId + ' ' + track.title);
}
async function stopRoom(roomId, s) {
  if (!s) return;
  s.playing = false; s.cur = null; s.startedAt = 0;
  setCmd(roomId, s, 'stop', null, 0);
}
async function advance(roomId, s) {
  s.playing = false; s.cur = null; s.startedAt = 0;
  const snap = await db.ref('roomMusic/' + roomId).get();
  const v = snap.val() || {};
  if (v.state === 'paused') return;
  const q = v.queue ? sortQueue(Object.keys(v.queue).map((k) => Object.assign({ queueId: k }, v.queue[k]))) : [];
  if (v.state === 'playing' && q.length) {
    const next = q[0];
    await db.ref('roomMusic/' + roomId + '/queue/' + next.queueId).remove();
    await startTrack(roomId, s, next);
  } else {
    await db.ref('roomMusic/' + roomId + '/current').remove();
    await db.ref('roomMusic/' + roomId + '/state').set('idle');
    delete rooms[roomId];
  }
}
async function reconcile(roomId, v) {
  const s = rooms[roomId] || (rooms[roomId] = {});
  const state = v ? v.state : 'idle';
  const cur = v ? v.current : null;
  const q = v && v.queue ? sortQueue(Object.keys(v.queue).map((k) => Object.assign({ queueId: k }, v.queue[k]))) : [];
  // Tap-to-play FIRST (2026-10-25): a client tap writes playQueueId.
  // Consume before anything else so the tapped song plays directly even
  // while another song plays or pauses: remove it from the queue, clear
  // the field, reset local playback state (startTrack's top guard would
  // otherwise refuse while a song plays), then start it. A stale or
  // missing id just clears and normal handling continues below.
  if (v && v.playQueueId) {
    const tappedId = v.playQueueId;
    const hit = q.find((t) => t.queueId === tappedId);
    await db.ref('roomMusic/' + roomId + '/playQueueId').remove();
    if (hit) {
      await db.ref('roomMusic/' + roomId + '/queue/' + tappedId).remove();
      s.playing = false; s.cur = null; s.startedAt = 0;
      await startTrack(roomId, s, hit);
    }
    if (!hit) return; // stale tap consumed; fresh state arrives next pass
    return;
  }
  if (state === 'paused') {
    if (s.playing) { s.posOff = Math.floor(posOf(s)); s.playing = false; s.startedAt = 0; setCmd(roomId, s, 'pause', null, s.posOff); if (s.cur) await db.ref('roomMusic/' + roomId + '/current/positionSec').set(s.posOff); }
    return;
  }
  // Stop keeps the song (position reset to 0) so Play restarts it from
  // the beginning. The old code removed `current` here, which made the
  // stopped song unrecoverable and left the queue orphaned with no Play
  // control — the play-after-stop dead-end.
  if (state === 'stopped') { await stopRoom(roomId, s); if (cur) await db.ref('roomMusic/' + roomId + '/current/positionSec').set(0); await db.ref('roomMusic/' + roomId + '/state').set('idle'); delete rooms[roomId]; return; }
  if (state === 'next') {
    s.playing = false; s.cur = null; s.startedAt = 0;
    await db.ref('roomMusic/' + roomId + '/current').remove();
    const snap2 = await db.ref('roomMusic/' + roomId).get();
    const v2 = snap2.val() || {};
    const q2 = v2.queue ? sortQueue(Object.keys(v2.queue).map((k) => Object.assign({ queueId: k }, v2.queue[k]))) : [];
    if (q2.length) { const nx = q2[0]; await db.ref('roomMusic/' + roomId + '/queue/' + nx.queueId).remove(); await startTrack(roomId, s, nx); }
    else { await db.ref('roomMusic/' + roomId + '/state').set('idle'); delete rooms[roomId]; }
    return;
  }
  if (state === 'playing') {
    // Already playing this exact track -> do nothing (loop-proof).
    if (s.playing && s.cur && cur && s.cur.queueId === cur.queueId) return;
    if (s.playing) return; // playing something else; its end advances us
    if (cur) { await startTrack(roomId, s, Object.assign({}, cur, { positionSec: Math.floor(cur.positionSec || 0) })); return; }
    if (q.length) { const next = q[0]; await db.ref('roomMusic/' + roomId + '/queue/' + next.queueId).remove(); await startTrack(roomId, s, next); return; }
    await db.ref('roomMusic/' + roomId + '/state').set('idle'); delete rooms[roomId]; return;
  }
  if (s.playing) { await stopRoom(roomId, s); delete rooms[roomId]; }
}
let busy = false;
let pending = false;
let passStartedAt = 0;
async function runPass(all) {
  for (const roomId of Object.keys(all)) { try { await reconcile(roomId, all[roomId]); } catch (e) { log('RECONCILE-FAIL ' + roomId + ' ' + e.message); } }
}
db.ref('roomMusic').on('value', function (snap) {
  // A write that lands mid-pass used to be dropped silently — a Play
  // written during a Stop reconcile never ran, with no retry. Now it
  // only defers: the pass re-reads until no event arrived mid-pass.
  if (busy) { pending = true; return; }
  busy = true; passStartedAt = Date.now();
  const all = snap.val() || {};
  (async function () {
    await runPass(all);
    busy = false;
    while (pending) {
      pending = false;
      const snap2 = await db.ref('roomMusic').get().catch(() => null);
      if (!snap2) break;
      busy = true; passStartedAt = Date.now();
      await runPass(snap2.val() || {});
      busy = false;
    }
  })();
});
// Busy watchdog: if a pass ever runs longer than 60s, log it and
// release the flag so the next RTDB event starts a fresh pass (the
// 15s position tick fires one while anything is playing; otherwise
// the user's next tap does). The pending re-read logic itself is
// untouched — this only unsticks a pass that can never finish.
setInterval(function () {
  if (busy && passStartedAt && Date.now() - passStartedAt > 60000) {
    log('PASS-STUCK ' + Math.floor((Date.now() - passStartedAt) / 1000) + 's');
    busy = false;
  }
}, 15000);
setInterval(function () {
  for (const roomId of Object.keys(rooms)) {
    const s = rooms[roomId];
    if (s.playing && s.cur) {
      const p = Math.floor(posOf(s));
      db.ref('roomMusic/' + roomId + '/current/positionSec').set(p).catch(function () {});
      // Keep the page command's position live too (same cmd id, so a
      // running page ignores it): a page that restarts mid-song must
      // seek to the LIVE position, not the start-time one.
      if (s.cmd) s.cmd.positionSec = p;
    }
  }
}, 15000);

// ---- localhost bridge for the Edge publisher page ----
const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && u.pathname === '/state') {
    const out = {};
    for (const roomId of Object.keys(rooms)) { if (rooms[roomId].cmd) out[roomId] = rooms[roomId].cmd; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }
  if (req.method === 'GET' && u.pathname === '/') {
    try { const html = fs.readFileSync('C:\\vee-music-bot\\player.html', 'utf8'); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); } catch (e) { res.writeHead(500); res.end('no page'); } return;
  }
  if (req.method === 'GET' && u.pathname === '/livekit-client.umd.min.js') {
    try { const js = fs.readFileSync('C:\\vee-music-bot\\livekit-client.umd.min.js'); res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(js); } catch (e) { res.writeHead(500); res.end('no sdk'); } return;
  }
  if (req.method === 'GET' && u.pathname.startsWith('/audio/')) {
    const f = CACHE + '\\' + decodeURIComponent(u.pathname.slice(7));
    let st = null; try { st = fs.statSync(f); } catch (e) {}
    if (!st || !st.isFile()) { res.writeHead(404); res.end('nf'); return; }
    const m = req.headers.range ? /bytes=(\d+)-(\d*)/.exec(req.headers.range) : null;
    const a = m ? parseInt(m[1], 10) : 0, b = (m && m[2]) ? parseInt(m[2], 10) : st.size - 1;
    if (m) res.writeHead(206, { 'Content-Range': 'bytes ' + a + '-' + b + '/' + st.size, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Content-Type': 'audio/mpeg' });
    else res.writeHead(200, { 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mpeg' });
    fs.createReadStream(f, m ? { start: a, end: b } : {}).pipe(res);
    return;
  }
  if (req.method === 'POST' && u.pathname === '/event') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', function () {
      try {
        const ev = JSON.parse(body || '{}');
        const s = rooms[ev.room];
        if (ev.type === 'ended' && s && s.playing) { log('ENDED ' + ev.room); advance(ev.room, s).catch((e) => log('ADVANCE-FAIL ' + e.message)); }
        else if (ev.type === 'error' && s && s.playing) { log('PAGE-ERROR ' + ev.room + ' ' + (ev.message || '')); advance(ev.room, s).catch(() => {}); }
        else if (ev.type === 'paused' && s) { s.posOff = Math.floor(ev.positionSec || 0); s.playing = false; s.startedAt = 0; }
        else if (ev.type === 'pagelog') { try { fs.appendFileSync('C:\\vee-music-bot\\page.log', '[' + new Date().toISOString() + '] ' + ev.room + ' ' + (ev.message || '') + '\n'); } catch (e) {} }
        else if (ev.type === 'playing') { log('PAGE-PLAYING ' + ev.room); }
      } catch (e) {}
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  res.writeHead(404); res.end('nf');
});
server.listen(3004, '127.0.0.1', function () { log('Vee Music Bot v2 started (bridge :3004)'); });
