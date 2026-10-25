/**
 * LuduGameModal — Ludu (Ludo) for Vee voice rooms (2026-10-25, boss order).
 *
 * Flow (imo-style entry, Vee styling, no imo artwork):
 *   1. Mode picker (host, no game yet): "LUDO" header, 2 Players / 4 Players
 *      cards side by side (selected card highlighted with a border), big
 *      Start button → creates the game in lobby state. NO Magic toggle:
 *      the boss has not defined what Magic does, so no dead control exists.
 *   2. Lobby (game status 'lobby'): "LUDO" header + tagline, player slots
 *      (2P = host + 1 empty "+", 4P = host + 3 empty "+"), Start GREYED
 *      OUT until every slot is filled. NO Match/chat invite (boss
 *      2026-10-25: he never asked for it): seated room members join by
 *      TAPPING an empty "+" slot (slots fill in join order, so a "+"
 *      tap always takes the next empty slot); the host's own "+" taps
 *      do nothing — he is already slot 1. Members self-join via
 *      players/$uid (live rules already allow it); host Start snapshots
 *      seats + inits the board. NO duplicate lobbies: creating while
 *      the host already has a live lobby reopens that lobby instead.
 *   3. Spectator row (boss 2026-10-25, imo in-play screenshot): ONE
 *      horizontal scrollable seats line under the board in lobby AND
 *      active views — slide left/right to see all seats; empty "+"
 *      taps join (lobby only); an active game is watch-only for
 *      non-players (games start full, so no mid-game join).
 *   4. Seat-gated join (boss 2026-10-25: "জয়েন করতে পারে যারা সিটে
 *      থাকবে") — a room visitor without a voice seat sees the lobby
 *      but cannot take a slot.
 *   5. Full-page picker + lobby (boss 2026-10-25, imo screenshots):
 *      panel Ludu opens the picker page DIRECTLY (no Games modal step);
 *      picker + lobby render as a FULL purple page over the room
 *      (LUDO logo + 2P/4P cards + big orange Start → mode lobby with
 *      slots + greyed Start + Match). Match = ONE room-chat invite per
 *      session (stated interpretation — no matchmaking pool exists).
 *      NO Magic row: its function is still undefined (asked, awaiting
 *      his answer) — no dead toggles. Board keeps the white sheet.
 *   3. Board (status 'active'): 15x15 board, real dice (pre-rolled value
 *      committed by transaction — the animation never invents a result),
 *      tap a highlighted token to move, captures, extra turns, win ends
 *      the game immediately. FREE game: no diamonds, no stakes.
 * System messages (existing room-chat system mechanism, senderId 'system'):
 *   "Room owner started Ludo" on lobby Start, "Ludo ended" on win/host end.
 *
 * Sync: RTDB rooms/{roomId}/games/{gameId} (see roomGameService). Turn
 * moves are transactions gated on turnUid + moveSeq, so a stale client
 * aborts instead of overwriting. Member board writes need the turn-gated
 * live-rules branch (see roomGameService header) — without it, only
 * owner/admin writes land and member turns fail with an honest alert.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Alert, Dimensions, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  createGame, endGame, subscribeGame, joinLuduGame, startLuduGame,
  rollLuduDice, moveLuduToken, passLuduTurn, findMyLiveLuduGame,
  type RoomGame,
} from '../../services/roomGameService';
import {
  TRACK_CELLS, HOME_CELLS, SAFE_TRACK, LUDU_COLORS,
  LUDU_COLOR_ORDER_2, LUDU_COLOR_ORDER_4,
  cellOf, movableTokens, applyMove,
  type LuduColor, type LuduState,
} from '../../services/ludoEngine';
import { sendRoomChatMsg } from '../../services/firebaseRoomChatService';
import { getErrorCause } from '@/src/utils/errorDisplay';

const BOARD_MAX = 360;

function systemMsg(text: string) {
  return { senderId: 'system', senderName: 'Ludo', senderColor: '#22C55E', text, ts: Date.now() };
}

const DICE_PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function DiceFace({ value, size }: { value: number | null; size: number }) {
  const pips = value ? DICE_PIPS[value] : [];
  const dot = Math.max(4, Math.floor(size / 7));
  return (
    <View style={{
      width: size, height: size, borderRadius: 10, backgroundColor: '#FFF',
      borderWidth: 1.5, borderColor: '#E5E5EA',
      flexDirection: 'row', flexWrap: 'wrap', padding: size * 0.14,
    }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={{
          width: '33.333%', height: '33.333%', alignItems: 'center', justifyContent: 'center',
        }}>
          {pips.includes(i) && (
            <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: '#111' }} />
          )}
        </View>
      ))}
    </View>
  );
}

export function LuduGameModal({ visible, roomId, hostUid, hostName, myUid, myName, myPhotoURL, mySeatIdx, isHost, gameId, onClose }: {
  visible: boolean;
  roomId: string;
  hostUid: string;
  hostName: string;
  myUid: string | null;
  myName: string;
  myPhotoURL?: string | null;
  /** voice-seat index of the viewer (-1 = not seated); join requires a seat (boss 2026-10-25) */
  mySeatIdx: number;
  isHost: boolean;
  /** existing game id, or null to show the host mode picker */
  gameId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [game, setGame] = useState<RoomGame | null>(null);
  const [internalId, setInternalId] = useState<string | null>(gameId);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<2 | 4>(2);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [matchSent, setMatchSent] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [displayDice, setDisplayDice] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const passSeqRef = useRef(-1);

  useEffect(() => {
    if (!visible) return;
    setInternalId(gameId);
    setGame(null);
    setLoaded(false);
    setRolling(false);
    setDisplayDice(null);
    setMatchSent(false);
    passSeqRef.current = -1;
    return () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
      rollTimer.current = null;
    };
  }, [visible, gameId]);

  useEffect(() => {
    if (!visible || !roomId || !internalId) return;
    return subscribeGame(roomId, internalId, (g) => { setGame(g); setLoaded(true); });
  }, [visible, roomId, internalId]);

  const ludu: LuduState | null = game?.ludu ?? null;
  const players = useMemo(() => {
    const list = Object.entries(game?.players ?? {}).map(([uid, p]) => ({ uid, ...p }));
    list.sort((a, b) => a.ts - b.ts);
    return list;
  }, [game]);
  const seatOrder = useMemo(() => {
    if (!game) return [];
    const others = players.filter((p) => p.uid !== game.hostUid).map((p) => p.uid);
    return [game.hostUid, ...others];
  }, [game, players]);
  const modeCount = game?.luduMode ?? mode;
  const isSeated = !!myUid && seatOrder.includes(myUid);
  const amTurn = !!ludu && !!myUid && ludu.turnUid === myUid;
  const myMovable = ludu && myUid && ludu.dice != null
    ? movableTokens(ludu, myUid, ludu.dice)
    : [];

  const playerName = (uid: string): string =>
    game?.players?.[uid]?.name ?? (uid === game?.hostUid ? game?.hostName ?? '' : '');

  const playerPhoto = (uid: string): string | null =>
    (game?.players?.[uid] as { photoURL?: string | null } | undefined)?.photoURL ?? null;

  // Auto-pass: rolled but no token can move → turn passes after a beat.
  useEffect(() => {
    if (!game || game.status !== 'active' || !ludu || !myUid) return;
    if (ludu.turnUid !== myUid || !ludu.diceRolled || ludu.dice == null) return;
    if (movableTokens(ludu, myUid, ludu.dice).length > 0) return;
    if (passSeqRef.current === ludu.moveSeq) return;
    passSeqRef.current = ludu.moveSeq;
    const timer = setTimeout(() => {
      passLuduTurn(roomId, game.id, myUid, ludu.moveSeq, `${myName} had no move`).then((ok) => {
        if (!ok) passSeqRef.current = -1; // allow a later state change to retry
      }).catch(() => { passSeqRef.current = -1; });
    }, 1500);
    return () => clearTimeout(timer);
  }, [game, ludu, myUid, myName, roomId]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      // 2026-10-25 (boss: no duplicate lobbies): if I already host a
      // live Ludu lobby in this room, reopen it instead of creating
      // another one (the LIVE NOW list showed 4 identical SHAKIB rows).
      if (myUid) {
        const existing = await findMyLiveLuduGame(roomId, myUid);
        if (existing) {
          setInternalId(existing);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }
      }
      const id = await createGame(roomId, hostUid, hostName, {
        type: 'ludu', title: t('voiceRoom.games.luduTitle'), mode, hostPhotoURL: myPhotoURL ?? null,
      });
      setInternalId(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setCreating(false);
    }
  };

  const join = async () => {
    if (!game || !myUid) return;
    try {
      await joinLuduGame(roomId, game.id, myUid, { uid: myUid, name: myName, photoURL: myPhotoURL ?? null, ts: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    }
  };

  const startLobby = async () => {
    if (!game || !isHost || starting) return;
    const seats = seatOrder.slice(0, modeCount);
    if (seats.length < modeCount) return; // button is greyed out until full
    setStarting(true);
    try {
      await startLuduGame(roomId, game.id, modeCount, seats);
      await sendRoomChatMsg(roomId, systemMsg(t('voiceRoom.games.luduStartedMsg'))).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setStarting(false);
    }
  };

  // 2026-10-25 (boss correction): an empty "+" slot IS the join
  // action — a seated room member taps it to take the next empty slot.
  // (The earlier "+" → Match chat invite was never asked for and is
  // removed with the Match button below.) The host is already slot 1,
  // so his own "+" taps stay inert — that is correct, not a bug.
  const handlePlusSlot = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void join();
  };

  // 2026-10-25 (boss, imo lobby Match): the host invites the room to
  // fill empty slots — ONE room-chat invite per modal session, then the
  // button hides (its job is done). This is the stated interpretation
  // of imo's Match for a voice room (no matchmaking pool exists); if
  // the boss meant something else he will correct it.
  const match = async () => {
    if (!game || !isHost || matchSent) return;
    setMatchSent(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await sendRoomChatMsg(roomId, systemMsg(t('voiceRoom.games.luduMatchInvite'))).catch(() => {});
  };

  const end = async () => {
    if (!game) return;
    await endGame(roomId, game.id).catch(() => {});
    await sendRoomChatMsg(roomId, systemMsg(t('voiceRoom.games.luduEndedMsg'))).catch(() => {});
    onClose();
  };

  const roll = async () => {
    if (!game || !ludu || !myUid || rolling || moving) return;
    if (ludu.turnUid !== myUid || ludu.diceRolled) return;
    // Pre-roll: the committed value is fixed BEFORE the animation runs,
    // so the animation can never invent or change the result.
    const dice = 1 + Math.floor(Math.random() * 6);
    setRolling(true);
    setDisplayDice(dice);
    const started = Date.now();
    rollTimer.current = setInterval(() => {
      if (Date.now() - started > 650) {
        if (rollTimer.current) clearInterval(rollTimer.current);
        rollTimer.current = null;
        rollLuduDice(roomId, game.id, myUid, ludu.moveSeq, dice, `${myName} rolled ${dice}`).then((ok) => {
          setRolling(false);
          if (!ok) {
            setDisplayDice(null);
            Alert.alert(t('voiceRoom.games.error'), t('voiceRoom.games.luduStale'));
          }
        }).catch((e) => {
          setRolling(false);
          setDisplayDice(null);
          Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
        });
      } else {
        setDisplayDice(1 + Math.floor(Math.random() * 6));
      }
    }, 90);
  };

  const moveToken = async (tokenIdx: number) => {
    if (!game || !ludu || !myUid || moving || rolling) return;
    if (ludu.turnUid !== myUid || !ludu.diceRolled || ludu.dice == null) return;
    const res = applyMove(ludu, myUid, tokenIdx, ludu.dice);
    if (!res) return;
    setMoving(true);
    try {
      const victimUid = res.captured[0]?.uid;
      const logEntry = victimUid
        ? `${myName} captured ${playerName(victimUid)}`
        : `${myName} moved ${ludu.dice}`;
      const ok = await moveLuduToken(roomId, game.id, myUid, ludu.moveSeq, ludu.dice, {
        positions: res.positions,
        extraTurn: res.extraTurn,
        finished: res.finished,
        winnerName: res.finished ? myName : null,
        logEntry,
      });
      if (!ok) {
        Alert.alert(t('voiceRoom.games.error'), t('voiceRoom.games.luduStale'));
        return;
      }
      if (res.finished) {
        await sendRoomChatMsg(roomId, systemMsg(t('voiceRoom.games.luduEndedMsg'))).catch(() => {});
        Alert.alert(t('voiceRoom.games.luduTitle'), t('voiceRoom.games.luduYouWon'));
      }
    } catch (e) {
      Alert.alert(t('voiceRoom.games.error'), getErrorCause(e));
    } finally {
      setMoving(false);
    }
  };

  // ── Board geometry ──────────────────────────────────────────────────────
  const boardSize = Math.min(Dimensions.get('window').width - 32, BOARD_MAX);
  const cell = boardSize / 15;
  const trackSet = useMemo(() => new Set(TRACK_CELLS.map(([r, c]) => r * 15 + c)), []);
  const safeSet = useMemo(() => new Set(SAFE_TRACK.map((i) => {
    const [r, c] = TRACK_CELLS[i];
    return r * 15 + c;
  })), []);
  const startColor = useMemo(() => {
    const m = new Map<number, LuduColor>();
    const starts: Array<[number, LuduColor]> = [[0, 'red'], [13, 'green'], [26, 'yellow'], [39, 'blue']];
    for (const [idx, color] of starts) {
      const [r, c] = TRACK_CELLS[idx];
      m.set(r * 15 + c, color);
    }
    return m;
  }, []);
  const homeColor = useMemo(() => {
    const m = new Map<number, LuduColor>();
    (Object.keys(HOME_CELLS) as LuduColor[]).forEach((color) => {
      HOME_CELLS[color].forEach(([r, c]) => m.set(r * 15 + c, color));
    });
    return m;
  }, []);
  const cellBg = (r: number, c: number): string => {
    if (r < 6 && c < 6) return LUDU_COLORS.red + '30';
    if (r < 6 && c > 8) return LUDU_COLORS.green + '30';
    if (r > 8 && c < 6) return LUDU_COLORS.blue + '30';
    if (r > 8 && c > 8) return LUDU_COLORS.yellow + '30';
    if (homeColor.has(r * 15 + c)) return LUDU_COLORS[homeColor.get(r * 15 + c)!] + '55';
    if (startColor.has(r * 15 + c)) return LUDU_COLORS[startColor.get(r * 15 + c)!] + 'AA';
    if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return '#F2F2F7';
    return '#FFFFFF';
  };

  const renderBoard = () => {
    if (!ludu) return null;
    // Group tokens by board cell for stack offsets + count badges.
    const byCell = new Map<string, Array<{ uid: string; tokenIdx: number; color: LuduColor }>>();
    for (const uid of ludu.seats) {
      const color = ludu.colors[ludu.seats.indexOf(uid)];
      for (let i = 0; i < 4; i++) {
        const [r, c] = cellOf(ludu, uid, i);
        const key = `${r},${c}`;
        const list = byCell.get(key) ?? [];
        list.push({ uid, tokenIdx: i, color });
        byCell.set(key, list);
      }
    }
    const diceToShow = rolling ? displayDice : ludu.dice;
    return (
      <View>
        {/* Player chips */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {ludu.seats.map((uid) => {
            const color = ludu.colors[ludu.seats.indexOf(uid)];
            const done = (ludu.positions[uid] ?? []).filter((p) => p === 57).length;
            const isTurn = ludu.turnUid === uid;
            return (
              <View key={uid} style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: isTurn ? LUDU_COLORS[color] + '22' : '#F2F2F7',
                borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
                borderWidth: isTurn ? 1.5 : 0, borderColor: LUDU_COLORS[color],
              }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LUDU_COLORS[color] }} />
                <Text style={{ fontSize: 12, fontWeight: isTurn ? '800' : '600', color: '#000' }} numberOfLines={1}>
                  {playerName(uid) || uid.slice(0, 6)}{uid === myUid ? ` (${t('voiceRoom.games.you')})` : ''}
                </Text>
                <Text style={{ fontSize: 11, color: '#8E8E93' }}>🏠 {done}/4</Text>
              </View>
            );
          })}
        </View>

        {/* Board */}
        <View style={{ width: boardSize, height: boardSize, alignSelf: 'center', backgroundColor: '#FFF', borderWidth: 2, borderColor: '#111', borderRadius: 6, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: boardSize, height: boardSize }}>
            {Array.from({ length: 225 }).map((_, i) => {
              const r = Math.floor(i / 15);
              const c = i % 15;
              const key = r * 15 + c;
              return (
                <View key={i} style={{
                  width: cell, height: cell, backgroundColor: cellBg(r, c),
                  borderWidth: trackSet.has(key) ? 0.5 : 0, borderColor: '#E5E5EA',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {safeSet.has(key) && !startColor.has(key) && (
                    <Text style={{ fontSize: cell * 0.5, color: '#8E8E93' }}>★</Text>
                  )}
                </View>
              );
            })}
          </View>
          {/* Base yards (white inner squares) */}
          {([
            [0.5, 0.5], [0.5, 9.5], [9.5, 0.5], [9.5, 9.5],
          ] as const).map(([top, left], i) => (
            <View key={i} style={{
              position: 'absolute', left: left * cell, top: top * cell,
              width: cell * 5, height: cell * 5, backgroundColor: '#FFF',
              borderRadius: 8, borderWidth: 1, borderColor: '#E5E5EA',
            }} />
          ))}
          {/* Center */}
          <View style={{
            position: 'absolute', left: cell * 6, top: cell * 6,
            width: cell * 3, height: cell * 3, backgroundColor: '#FFF',
            borderWidth: 1, borderColor: '#E5E5EA',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: cell * 0.9, color: '#8E8E93' }}>★</Text>
          </View>
          {/* Tokens */}
          {Array.from(byCell.entries()).map(([key, toks]) => toks.map((tok, stackIdx) => {
            const [r, c] = key.split(',').map(Number);
            const movable = amTurn && !!ludu.diceRolled && !!myUid && tok.uid === myUid
              && myMovable.includes(tok.tokenIdx);
            const size = cell * 0.82;
            return (
              <Pressable
                key={`${tok.uid}-${tok.tokenIdx}`}
                disabled={!movable || moving}
                onPress={() => moveToken(tok.tokenIdx)}
                style={{
                  position: 'absolute',
                  left: c * cell + cell * 0.09 + stackIdx * 2.5,
                  top: r * cell + cell * 0.09 + stackIdx * 2.5,
                  width: size, height: size, borderRadius: size / 2,
                  backgroundColor: LUDU_COLORS[tok.color],
                  borderWidth: movable ? 3 : 2,
                  borderColor: movable ? '#FFD43B' : '#FFF',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#000', shadowOpacity: movable ? 0.3 : 0.1, shadowRadius: 3,
                }}
              >
                {toks.length > 1 && stackIdx === toks.length - 1 && (
                  <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '900' }}>×{toks.length}</Text>
                )}
              </Pressable>
            );
          }))}
        </View>

        {/* Dice + turn */}
        <View style={{ alignItems: 'center', marginTop: 14 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#000', marginBottom: 8 }}>
            {amTurn
              ? t('voiceRoom.games.luduYourTurn')
              : ludu.turnUid
                ? t('voiceRoom.games.luduTurn', { name: playerName(ludu.turnUid) })
                : t('voiceRoom.games.luduWaitingPlayers')}
          </Text>
          <DiceFace value={diceToShow} size={56} />
          {amTurn && !ludu.diceRolled && (
            <Pressable
              onPress={roll}
              disabled={rolling}
              style={{
                marginTop: 12, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 44,
                backgroundColor: rolling ? '#F2F2F7' : '#E3F2FD',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: rolling ? '#8E8E93' : '#007AFF' }}>
                {rolling ? t('voiceRoom.games.luduRolling') : t('voiceRoom.games.luduRoll')}
              </Text>
            </Pressable>
          )}
          {amTurn && ludu.diceRolled && (
            <Text style={{ marginTop: 10, fontSize: 13, color: '#8E8E93' }}>
              {myMovable.length > 0
                ? t('voiceRoom.games.luduSelectToken')
                : t('voiceRoom.games.luduNoMove')}
            </Text>
          )}
          {/* RTDB drops empty arrays on write, so a freshly started game
              reads back with NO log key — `ludu.log` is undefined on the
              first board render and `ludu.log.length` crashed the app
              (boss 2026-10-25: Start → "Cannot read property 'length' of
              undefined"). Default to [] here; the service already guards
              its own log reads the same way. */}
          {(ludu.log ?? []).length > 0 && (
            <View style={{ marginTop: 12, alignSelf: 'stretch', backgroundColor: '#F2F2F7', borderRadius: 12, padding: 10 }}>
              {(ludu.log ?? []).slice(-4).map((entry, i) => (
                <Text key={i} style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>• {entry}</Text>
              ))}
            </View>
          )}
          {isHost && (
            <Pressable onPress={end} style={{ marginTop: 12, paddingVertical: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#FF3B30' }}>{t('voiceRoom.games.endGame')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const lobbyFull = seatOrder.length >= modeCount;

  // 2026-10-25 (boss: imo in-play screenshot): ONE horizontal scrollable
  // seats line — slide left/right to see all seats, tap an empty "+" to
  // join. Shared by the lobby (joinable) and the active board
  // (watch-only: games start full, so no mid-game join).
  const renderSeatsRow = (joinable: boolean) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 14, paddingHorizontal: 4 }}
      style={{ marginBottom: 8 }}
    >
      {Array.from({ length: modeCount }).map((_, i) => {
        const uid = seatOrder[i];
        const filled = !!uid;
        const color = LUDU_COLORS[(modeCount === 2 ? LUDU_COLOR_ORDER_2 : LUDU_COLOR_ORDER_4)[i]];
        const photo = filled ? playerPhoto(uid) : null;
        return (
          <View key={i} style={{ alignItems: 'center', width: 64 }}>
            {filled ? (
              photo ? (
                <Image
                  source={{ uri: photo }}
                  style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#FFF' }}
                  resizeMode="cover"
                />
              ) : (
                <View style={{
                  width: 52, height: 52, borderRadius: 26, backgroundColor: color,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#FFF',
                }}>
                  <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '900' }}>
                    {(playerName(uid) || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )
            ) : (
              (() => {
                // 2026-10-25 (boss: "জয়েন করতে পারে যারা সিটে থাকবে"):
                // joining a lobby slot requires a VOICE seat — a room
                // visitor without a seat sees the slots but cannot take
                // one (same as the host's own inert "+").
                const canJoin = joinable && !!myUid && mySeatIdx >= 0 && !isSeated && !lobbyFull && game?.status === 'lobby';
                const slotStyle = {
                  width: 52, height: 52, borderRadius: 26,
                  borderWidth: 2, borderColor: '#C7C7CC', borderStyle: 'dashed' as const,
                  alignItems: 'center' as const, justifyContent: 'center' as const,
                };
                return canJoin ? (
                  <Pressable onPress={handlePlusSlot} hitSlop={8} style={slotStyle}>
                    <Text style={{ color: '#C7C7CC', fontSize: 24, fontWeight: '300' }}>+</Text>
                  </Pressable>
                ) : (
                  <View style={slotStyle}>
                    <Text style={{ color: '#C7C7CC', fontSize: 24, fontWeight: '300' }}>+</Text>
                  </View>
                );
              })()
            )}
            <Text style={{ fontSize: 11, color: isFullPage ? 'rgba(255,255,255,0.85)' : '#555', marginTop: 6, textAlign: 'center' }} numberOfLines={1}>
              {filled ? playerName(uid) : t('voiceRoom.games.luduWaitingPlayers')}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );

  // 2026-10-25 (boss, imo screenshots): picker + lobby render as a FULL
  // purple page over the room (not a bottom sheet); the board keeps
  // the white sheet (its 15x15 layout needs it).
  const isFullPage = !game || game.status === 'lobby';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={isFullPage ? {
        position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#6D28D9',
        paddingBottom: 28,
      } : {
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%', paddingBottom: 28,
      }}>
        {!isFullPage && (
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginTop: 10 }} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: isFullPage ? 16 : 12, paddingBottom: 4 }}>
          {isFullPage ? (
            <View style={{ flex: 1 }} />
          ) : (
            <Text style={{ fontSize: 20, fontWeight: '900', color: '#000', letterSpacing: 2, flex: 1 }}>
              {t('voiceRoom.games.luduTitle')}
            </Text>
          )}
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color={isFullPage ? '#FFFFFF' : '#8E8E93'} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {/* ── MODE PICKER (host creating) — imo-style panel (boss 2026-10-25):
              big colorful LUDO logo + 2P/4P cards + big Start. NO Magic
              row: its function was never defined (asked, awaiting his
              answer) — no dead toggles. NO Match button: he rejected
              the Match chat message. */}
          {!game && !internalId && isHost && (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 46, fontWeight: '900', color: '#EF4444' }}>L</Text>
                <Text style={{ fontSize: 46, fontWeight: '900', color: '#F59E0B' }}>U</Text>
                <Text style={{ fontSize: 46, fontWeight: '900', color: '#22C55E' }}>D</Text>
                <Text style={{ fontSize: 46, fontWeight: '900', color: '#93C5FD' }}>O</Text>
              </View>
              <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 20, textAlign: 'center' }}>
                {t('voiceRoom.games.luduTagline')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {([
                  { m: 2 as const, label: t('voiceRoom.games.ludu2Players'), sub: t('voiceRoom.games.ludu2PlayersSub') },
                  { m: 4 as const, label: t('voiceRoom.games.ludu4Players'), sub: t('voiceRoom.games.ludu4PlayersSub') },
                ]).map((opt) => {
                  const selected = mode === opt.m;
                  return (
                    <Pressable
                      key={opt.m}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode(opt.m); }}
                      style={{
                        flex: 1, borderRadius: 16, paddingVertical: 22, paddingHorizontal: 12,
                        alignItems: 'center',
                        backgroundColor: selected ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.25)',
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? '#FFFFFF' : 'rgba(255,255,255,0.30)',
                      }}
                    >
                      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 8 }}>
                        {(opt.m === 2 ? LUDU_COLOR_ORDER_2 : LUDU_COLOR_ORDER_4).map((color, i) => (
                          <View key={i} style={{
                            width: 30, height: 30, borderRadius: 15,
                            backgroundColor: LUDU_COLORS[color],
                            borderWidth: 2, borderColor: '#FFF',
                            marginLeft: i > 0 ? -8 : 0,
                          }} />
                        ))}
                      </View>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFFFFF' }}>{opt.label}</Text>
                      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{opt.sub}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={create}
                disabled={creating}
                style={{
                  marginTop: 24, borderRadius: 999, paddingVertical: 16, alignItems: 'center',
                  backgroundColor: creating ? 'rgba(255,255,255,0.35)' : '#F97316',
                }}
              >
                <Text style={{ fontSize: 17, fontWeight: '800', color: creating ? 'rgba(255,255,255,0.7)' : '#FFF' }}>
                  {t('voiceRoom.games.luduStart')}
                </Text>
              </Pressable>
            </View>
          )}

          {!game && !internalId && !isHost && (
            <Text style={{ textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 14, padding: 24 }}>
              {t('voiceRoom.games.waitingHost')}
            </Text>
          )}

          {/* ── LOBBY (waiting for players) ── */}
          {game && game.status === 'lobby' && (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 32, fontWeight: '900', color: '#EF4444' }}>L</Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: '#F59E0B' }}>U</Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: '#22C55E' }}>D</Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: '#93C5FD' }}>O</Text>
              </View>
              <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 16, textAlign: 'center' }}>
                {t('voiceRoom.games.luduTagline')}
              </Text>
              {renderSeatsRow(true)}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                {isHost && (
                  <Pressable
                    onPress={startLobby}
                    disabled={!lobbyFull || starting}
                    style={{
                      flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center',
                      backgroundColor: lobbyFull && !starting ? '#22C55E' : 'rgba(255,255,255,0.35)',
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '800', color: lobbyFull && !starting ? '#FFF' : 'rgba(255,255,255,0.8)' }}>
                      {t('voiceRoom.games.luduStart')}
                    </Text>
                  </Pressable>
                )}
                {isHost && !lobbyFull && !matchSent && (
                  <Pressable
                    onPress={match}
                    style={{ flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#F97316' }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFF' }}>Match</Text>
                  </Pressable>
                )}
                {!isHost && myUid && mySeatIdx >= 0 && !isSeated && !lobbyFull && (
                  <Pressable
                    onPress={join}
                    style={{ flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#22C55E' }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFF' }}>{t('voiceRoom.games.luduJoin')}</Text>
                  </Pressable>
                )}
                {!isHost && myUid && !isSeated && lobbyFull && (
                  <Text style={{ flex: 1, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.8)', paddingVertical: 13 }}>
                    {t('voiceRoom.games.luduLobbyFull')}
                  </Text>
                )}
                {!isHost && isSeated && (
                  <Text style={{ flex: 1, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.8)', paddingVertical: 13 }}>
                    {t('voiceRoom.games.luduWaitingStart')}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* ── BOARD ── */}
          {game && game.status === 'active' && (
            ludu ? (
              <View>
                {renderBoard()}
                {renderSeatsRow(false)}
              </View>
            ) : (
              <Text style={{ textAlign: 'center', color: '#8E8E93', fontSize: 14, padding: 24 }}>
                {t('voiceRoom.games.luduWaitingPlayers')}
              </Text>
            )
          )}

          {/* ── ENDED ── */}
          {game && game.status === 'ended' && (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <Text style={{ fontSize: 40, marginBottom: 8 }}>🏆</Text>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#000', textAlign: 'center' }}>
                {game.winnerName
                  ? t('voiceRoom.games.luduWinner', { name: game.winnerName })
                  : t('voiceRoom.games.ended')}
              </Text>
              <Pressable
                onPress={onClose}
                style={{ marginTop: 20, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 40, backgroundColor: '#F2F2F7' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#000' }}>{t('voiceRoom.games.luduClose')}</Text>
              </Pressable>
            </View>
          )}

          {internalId && !loaded && (
            <Text style={{ textAlign: 'center', color: '#8E8E93', fontSize: 14, padding: 24 }}>
              {t('voiceRoom.games.luduWaitingPlayers')}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
