#!/usr/bin/env node
/**
 * One-command demo.
 *
 * Seeds two accounts, opens a room, seats a scripted opponent, and prints the
 * room id to paste into the lobby. The opponent keeps its socket open so the
 * room survives the 30s reconnect grace, and answers its own priority passes,
 * combat declarations and choice prompts so the match never stalls on it.
 *
 * No product logic is involved: this only drives the public HTTP and socket
 * surface that the browser already uses.
 *
 *   npm run demo
 *
 * Requires a running server (`npm start`, or `npm run dev`).
 */
import { io } from 'socket.io-client';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.DEMO_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const PROTOCOL_VERSION = 1;
const PASSWORD = 'demo-password-123456';
const HOST = 'demo-host';
const GUEST = 'demo-guest';
/* Kept beside the database, not in tem/: tem/ is scratch space that gets cleaned,
   and losing this file strands the previous room under an account the script can
   no longer name. See docs/reports/ORPHANED_ROOM_BUG_REPORT.md. */
const STATE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'demo-room.json');

const log = (...parts) => console.log(...parts);
const fail = message => {
  console.error('\n  ' + message + '\n');
  process.exit(1);
};

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'x-card-game-client': 'browser-v1',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${value?.message ?? text}`);
  return value;
}

/** Register, or sign in when the demo accounts already exist. */
async function signIn(username) {
  const credentials = { protocolVersion: PROTOCOL_VERSION, username, password: PASSWORD };
  try {
    return await api('/api/auth/register', { method: 'POST', body: credentials });
  } catch {
    return await api('/api/auth/login', { method: 'POST', body: credentials });
  }
}

function readSavedRoom() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')).roomId ?? null;
  } catch {
    return null;
  }
}

function saveRoom(roomId) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ roomId }, null, 2));
  } catch {
    /* A missing state file only costs a stale-room cleanup on the next run. */
  }
}

/** Connect, and release any seat this account still holds from an earlier run. */
async function connect(token, roomId) {
  const socket = io(BASE, {
    transports: ['websocket'],
    auth: { protocolVersion: PROTOCOL_VERSION, token, ...(roomId ? { roomId } : {}) },
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const seated = await new Promise(resolve => {
    socket.once('sessionReady', info => resolve(info.roomId ?? null));
    setTimeout(() => resolve(null), 1500);
  });
  if (seated) {
    socket.emit('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId: seated });
    await new Promise(resolve => {
      socket.once('roomLeft', resolve);
      setTimeout(resolve, 1500);
    });
    log(`  released the stale room ${seated}`);
  }
  return socket;
}

/** Pick a legal answer for a choice the opponent owns. */
function answerFor(choice) {
  if (choice.kind === 'number') return { choiceId: choice.id, number: choice.range.min };
  if (choice.kind === 'distribution' || choice.kind === 'payment') {
    const allocations = {};
    let remaining = choice.total ?? 0;
    for (const option of choice.options) {
      const minimum = choice.minimumPerOption ?? 0;
      const give = Math.min(option.limit ?? Infinity, Math.max(minimum, remaining));
      allocations[option.id] = give;
      remaining -= give;
    }
    return { choiceId: choice.id, allocations };
  }
  const wanted = Math.max(choice.min ?? 1, 1);
  const seen = new Set();
  const choices = [];
  for (const option of choice.options) {
    if (choices.length >= wanted) break;
    if (option.distinctGroup !== undefined) {
      if (seen.has(option.distinctGroup)) continue;
      seen.add(option.distinctGroup);
    }
    choices.push(option.id);
  }
  if (!choices.length && choice.cancellable) return { choiceId: choice.id, cancel: true };
  return { choiceId: choice.id, choices };
}

/** Sign in both seats, release any stale room, and open a fresh room. */
async function openRoom(hostName, guestName) {
  const host = await signIn(hostName);
  const guest = await signIn(guestName);
  const hostDeck = (await api('/api/decks?offset=0&limit=10', { token: host.token })).decks[0];
  const guestDeck = (await api('/api/decks?offset=0&limit=10', { token: guest.token })).decks[0];
  if (!hostDeck || !guestDeck) fail('The demo accounts have no saved deck. Delete data/card-game.sqlite and retry.');

  /* The scripted opponent opens the room, so the human's account stays free to
     join from a browser: one account reserves one room across every tab. */
  const saved = readSavedRoom();
  const opponentSocket = await connect(guest.token, saved);
  const hostSocket = await connect(host.token, saved);

  const roomId = await new Promise((resolve, reject) => {
    opponentSocket.once('roomCreated', message => resolve(message.roomId));
    opponentSocket.once('error', message => reject(new Error(message.message)));
    opponentSocket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION, deckId: guestDeck.id });
    setTimeout(() => reject(new Error('The server did not confirm the room.')), 8000);
  }).catch(error => {
    hostSocket.disconnect();
    opponentSocket.disconnect();
    throw error;
  });
  saveRoom(roomId);
  return { roomId, hostSocket, opponentSocket, opponentId: guest.playerId, hostName, guestName };
}

async function main() {
  try {
    await api('/healthz');
  } catch {
    fail(`No server at ${BASE}. Start one with "npm start" (or "npm run dev") and run this again.`);
  }

  log('\n  Seeding the demo...');
  let session;
  try {
    session = await openRoom(HOST, GUEST);
  } catch (error) {
    /* A previous run can leave a seat behind that this script cannot name, for
       example when tem/ was cleaned. Fresh accounts are always free, and new
       accounts receive starter decks automatically. */
    if (!/already has a room/i.test(error.message)) throw error;
    const suffix = Math.random().toString(36).slice(2, 6);
    log('  The demo accounts still hold a room this run cannot name; using fresh ones.');
    session = await openRoom(`${HOST}-${suffix}`, `${GUEST}-${suffix}`);
  }
  const { roomId, hostSocket, opponentSocket, opponentId, hostName, guestName } = session;
  let busy = false;
  let picked = false;

  const act = (actionId, data) => opponentSocket.emit('playerAction', {
    protocolVersion: PROTOCOL_VERSION,
    roomId,
    actionId,
    commandId: crypto.randomUUID(),
    ...(data ?? {}),
  });

  /** Play a land, then the cheapest castable spell, then stop. */
  const nextMove = room => {
    const hand = room.players[opponentId]?.hand ?? [];
    const land = hand.find(card => card.cardTypes.includes('Land') &&
      card.actions.some(option => option.actionId === 'play_land' && !option.disabled));
    if (land) return { actionId: 'play_land', data: { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision } };
    const spell = hand.find(card => card.actions.some(option => option.actionId === 'cast_spell' && !option.disabled));
    if (spell) return { actionId: 'cast_spell', data: { cardUuid: spell.uuid } };

    /* Nothing is castable yet. If a spell is only short on mana, tap a land so
       the next pass of this loop can pay for it. */
    const shortOnMana = hand.some(card => card.actions.some(option =>
      option.actionId === 'cast_spell' && option.disabled && /^Need /.test(option.disabledReason ?? '')));
    if (!shortOnMana) return null;
    const source = (room.battlefield ?? []).find(card =>
      card.state.controllerId === opponentId && !card.state.isTapped &&
      card.actions.some(option => option.actionId === 'tapForMana' && !option.disabled));
    if (!source) return null;
    const option = source.actions.find(entry => entry.actionId === 'tapForMana' && !entry.disabled);
    return { actionId: 'tapForMana', data: { cardUuid: source.uuid, ...(option.data ?? {}) } };
  };

  const consider = room => {
    if (!room || busy || room.status === 'gameOver') return;
    /* The opponent opens the room, so it locks its opening pick as soon as the
       second seat fills. The human answers from the lobby's opening round. */
    if (room.status === 'waiting' && room.player2Id && !picked) {
      picked = true;
      opponentSocket.emit('submitRps', { protocolVersion: PROTOCOL_VERSION, roomId, pick: 'rock' });
      return;
    }
    const choice = room.pendingChoice;
    if (choice && choice.kind !== 'waiting' && choice.playerId === opponentId) {
      busy = true;
      setTimeout(() => {
        act('choose', answerFor(choice));
        busy = false;
      }, 400);
      return;
    }
    /* Combat declarations are mandatory and are not priority-gated. */
    if (room.declarationPlayerId === opponentId) {
      busy = true;
      const attacking = room.phase === 'declareAttackersStep';
      setTimeout(() => {
        act(attacking ? 'declare_attackers' : 'declare_blockers', attacking ? { attackers: [] } : { assignments: [] });
        busy = false;
      }, 600);
      return;
    }
    if (room.priorityPlayerId !== opponentId) return;

    /* On its own main phase the opponent develops its board before passing. */
    const mine = room.activeTurnPlayerId === opponentId;
    const main = room.phase === 'stateMainPhase' || room.phase === 'postcombatMainPhase';
    const move = mine && main && !room.stack.length ? nextMove(room) : null;
    busy = true;
    setTimeout(() => {
      act(move ? move.actionId : 'pass_priority', move?.data);
      busy = false;
    }, move ? 700 : 900);
  };

  opponentSocket.on('roomSnapshot', message => consider(message.room));
  /* Deltas carry only changes, so ask for a snapshot to read priority. */
  opponentSocket.on('stateDelta', () => opponentSocket.emit('requestRoomSnapshot', { protocolVersion: PROTOCOL_VERSION, roomId }));
  opponentSocket.on('error', message => log('  opponent: ' + message.message));
  opponentSocket.on('startGame', () => log('\n  The match has started. Good luck.\n'));

  const url = `${BASE}/play`;
  log(`
  ------------------------------------------------------------
   Demo ready.

   1. Open   ${url}
   2. Sign in as   ${hostName}   /   ${PASSWORD}
   3. Join room    ${roomId}

   The opponent is ${guestName} and plays on its own.
   Press Ctrl+C to end the demo.
  ------------------------------------------------------------
`);

  const shutdown = () => {
    log('\n  Closing the demo room...');
    hostSocket.disconnect();
    opponentSocket.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => fail(error.message));
