// src/engine/game-reducer.ts
// Pure reducer: (state, mutation) => newState.
// Returns a new GameRoom with shallow copies along the changed path.
// Untouched subtrees are shared by reference.

import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';

/**
 * Find a card by uuid across all zones in the room.
 * Searches battlefield, stack (inside StackObject.source), and per-player zones.
 */
function findCard(room: GameRoom, cardUuid: string): CardInstance | undefined {
  // battlefield
  const bf = room.battlefield.find(c => c.uuid === cardUuid);
  if (bf) return bf;

  // stack (card lives inside StackObject.source)
  for (const so of room.stack) {
    const src = so.source as CardInstance | undefined;
    if (src?.uuid === cardUuid) return src;
  }

  // per-player zones
  for (const player of Object.values(room.players)) {
    const h = player.hand.find(c => c.uuid === cardUuid);
    if (h) return h;
    const gy = player.graveyard.find(c => c.uuid === cardUuid);
    if (gy) return gy;
    const dk = player.deck.find(c => c.uuid === cardUuid);
    if (dk) return dk;
  }

  return undefined;
}

/**
 * Remove a card from a zone array. Returns a new array (shallow copy).
 */
function removeFromZone(
  room: GameRoom,
  cardUuid: string,
  playerId: string,
  zone: string,
): { newRoom: GameRoom; removed: CardInstance | null } {
  if (zone === 'battlefield') {
    const idx = room.battlefield.findIndex(c => c.uuid === cardUuid);
    if (idx === -1) return { newRoom: room, removed: null };
    const removed = room.battlefield[idx];
    return {
      newRoom: {
        ...room,
        battlefield: [...room.battlefield.slice(0, idx), ...room.battlefield.slice(idx + 1)],
      },
      removed,
    };
  }

  if (zone === 'stack') {
    // Card lives inside StackObject.source — find and remove the StackObject
    const idx = room.stack.findIndex(so => (so.source as CardInstance)?.uuid === cardUuid);
    if (idx === -1) return { newRoom: room, removed: null };
    const removed = room.stack[idx].source as CardInstance;
    return {
      newRoom: {
        ...room,
        stack: [...room.stack.slice(0, idx), ...room.stack.slice(idx + 1)],
      },
      removed,
    };
  }

  // Per-player zones
  const player = room.players[playerId];
  if (!player) return { newRoom: room, removed: null };

  // Normalize 'library' (CardZone) to 'deck' (player array key)
  const arrKey = (zone === 'library' ? 'deck' : zone) as 'hand' | 'graveyard' | 'deck';
  const arr = player[arrKey] as CardInstance[];
  const idx = arr.findIndex(c => c.uuid === cardUuid);
  if (idx === -1) return { newRoom: room, removed: null };

  const removed = arr[idx];
  const newArr = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
  return {
    newRoom: {
      ...room,
      players: {
        ...room.players,
        [playerId]: {
          ...player,
          [arrKey]: newArr,
        },
      },
    },
    removed,
  };
}

/**
 * Add a card to a zone array. Returns a new room.
 */
function addToZone(room: GameRoom, card: CardInstance, playerId: string, zone: string): GameRoom {
  if (zone === 'battlefield') {
    return { ...room, battlefield: [...room.battlefield, card] };
  }

  if (zone === 'stack') {
    // Cards don't go directly into stack via addToZone — use PUSH_STACK
    return room;
  }

  const player = room.players[playerId];
  if (!player) return room;

  // Normalize 'library' (CardZone) to 'deck' (player array key)
  const arrKey = (zone === 'library' ? 'deck' : zone) as 'hand' | 'graveyard' | 'deck';
  const arr = player[arrKey] as CardInstance[];

  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: {
        ...player,
        [arrKey]: [...arr, card],
      },
    },
  };
}

/**
 * Update a card's state on the battlefield. Returns a new room with the card
 * replaced at its index.
 */
function updateCardOnBattlefield(room: GameRoom, cardUuid: string, update: (card: CardInstance) => CardInstance): GameRoom {
  const idx = room.battlefield.findIndex(c => c.uuid === cardUuid);
  if (idx === -1) return room;

  const updated = update(room.battlefield[idx]);
  return {
    ...room,
    battlefield: [
      ...room.battlefield.slice(0, idx),
      updated,
      ...room.battlefield.slice(idx + 1),
    ],
  };
}

/**
 * Update a card's state in a per-player zone. Returns a new room.
 */
function updateCardInPlayerZone(
  room: GameRoom,
  cardUuid: string,
  playerId: string,
  zone: 'hand' | 'graveyard' | 'deck',
  update: (card: CardInstance) => CardInstance,
): GameRoom {
  const player = room.players[playerId];
  if (!player) return room;

  const arr = player[zone];
  const idx = arr.findIndex(c => c.uuid === cardUuid);
  if (idx === -1) return room;

  const updated = update(arr[idx]);
  const newArr = [...arr.slice(0, idx), updated, ...arr.slice(idx + 1)];

  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: {
        ...player,
        [zone]: newArr,
      },
    },
  };
}

/**
 * Pure reducer: (state, mutation) => newState.
 */
export function gameReducer(state: GameRoom, mutation: GameMutation): GameRoom {
  switch (mutation.type) {
    // -- Player mutations --
    case 'SET_LIFE':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            life: mutation.amount,
          },
        },
      };

    case 'SET_MANA':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            mana: {
              ...state.players[mutation.playerId].mana,
              [mutation.color]: mutation.amount,
            },
          },
        },
      };

    case 'ADD_MANA':
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...state.players[mutation.playerId],
            mana: {
              ...state.players[mutation.playerId].mana,
              [mutation.color]: (state.players[mutation.playerId].mana[mutation.color] ?? 0) + mutation.amount,
            },
          },
        },
      };

    case 'SPEND_MANA': {
      const player = state.players[mutation.playerId];
      const newMana = { ...player.mana };
      for (const [color, amount] of Object.entries(mutation.cost)) {
        newMana[color as keyof typeof newMana] -= amount!;
      }
      return {
        ...state,
        players: {
          ...state.players,
          [mutation.playerId]: {
            ...player,
            mana: newMana,
          },
        },
      };
    }

    // -- Card draw --
    case 'DRAW_CARD': {
      const player = state.players[mutation.playerId];
      if (!player || player.deck.length === 0) return state;
      const toDraw = Math.min(mutation.amount ?? 1, player.deck.length);
      let working = state;
      for (let i = 0; i < toDraw; i++) {
        const top = working.players[mutation.playerId].deck[working.players[mutation.playerId].deck.length - 1];
        if (!top) break;
        const { newRoom, removed } = removeFromZone(working, top.uuid, mutation.playerId, 'library');
        if (!removed) break;
        const updated: CardInstance = { ...removed, state: { ...removed.state, zone: 'hand' } };
        working = addToZone(newRoom, updated, mutation.playerId, 'hand');
      }
      return working;
    }

    // -- Card state mutations --
    case 'TAP_CARD':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, isTapped: true },
      }));

    case 'UNTAP_CARD':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, isTapped: false },
      }));

    case 'SET_SUMMONING_SICKNESS':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, summoningSickness: mutation.value },
      }));

    case 'SET_DAMAGE':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: { ...card.state, damageTaken: mutation.amount },
      }));

    case 'ADD_COUNTER':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: {
          ...card.state,
          counters: {
            ...card.state.counters,
            [mutation.counterType]: (card.state.counters[mutation.counterType] || 0) + mutation.amount,
          },
        },
      }));

    case 'REMOVE_COUNTER':
      return updateCardOnBattlefield(state, mutation.cardUuid, card => ({
        ...card,
        state: {
          ...card.state,
          counters: {
            ...card.state.counters,
            [mutation.counterType]: Math.max(0, (card.state.counters[mutation.counterType] || 0) - mutation.amount),
          },
        },
      }));

    // -- Zone mutations --
    case 'MOVE_CARD': {
      const { newRoom, removed } = removeFromZone(state, mutation.cardUuid, mutation.playerId, mutation.from);
      if (!removed) return state;

      const updatedCard: CardInstance = {
        ...removed,
        state: { ...removed.state, zone: mutation.to },
      };

      return addToZone(newRoom, updatedCard, mutation.playerId, mutation.to);
    }

    case 'SET_CARD_ZONE': {
      const card = findCard(state, mutation.cardUuid);
      if (!card) return state;

      // Update zone flag on the card wherever it lives
      // Try battlefield first
      const bfIdx = state.battlefield.findIndex(c => c.uuid === mutation.cardUuid);
      if (bfIdx !== -1) {
        const updated = { ...state.battlefield[bfIdx], state: { ...state.battlefield[bfIdx].state, zone: mutation.zone } };
        return {
          ...state,
          battlefield: [...state.battlefield.slice(0, bfIdx), updated, ...state.battlefield.slice(bfIdx + 1)],
        };
      }

      // Try per-player zones
      for (const [pid, player] of Object.entries(state.players)) {
        for (const zone of ['hand', 'graveyard', 'deck'] as const) {
          const arr = player[zone];
          const idx = arr.findIndex(c => c.uuid === mutation.cardUuid);
          if (idx !== -1) {
            const updated = { ...arr[idx], state: { ...arr[idx].state, zone: mutation.zone } };
            const newArr = [...arr.slice(0, idx), updated, ...arr.slice(idx + 1)];
            return {
              ...state,
              players: {
                ...state.players,
                [pid]: { ...player, [zone]: newArr },
              },
            };
          }
        }
      }

      return state;
    }

    // -- Stack mutations --
    case 'PUSH_STACK':
      return {
        ...state,
        stack: [...state.stack, mutation.stackObject],
      };

    case 'POP_STACK': {
      if (state.stack.length === 0) return state;
      return {
        ...state,
        stack: state.stack.slice(0, -1),
      };
    }

    case 'SET_COUNTERED': {
      const stackIdx = state.stack.findIndex(so => so.uuid === mutation.stackUuid);
      if (stackIdx === -1) return state;
      const updated = { ...state.stack[stackIdx], countered: true };
      return {
        ...state,
        stack: [
          ...state.stack.slice(0, stackIdx),
          updated,
          ...state.stack.slice(stackIdx + 1),
        ],
      };
    }

    // -- Phase / Turn mutations --
    case 'SET_PHASE':
      return { ...state, currentPhase: mutation.phase };

    case 'SET_PREVIOUS_PHASE':
      return { ...state, previousPhase: mutation.phase };

    case 'SET_TURN':
      return { ...state, activeTurnPlayerId: mutation.playerId };

    case 'SET_PRIORITY':
      return { ...state, priorityPlayerId: mutation.playerId };

    case 'SET_LAST_PASSED':
      return { ...state, lastPassedPlayerId: mutation.playerId };

    // -- RPS mutations --
    case 'SET_RPS_STATUS':
      return {
        ...state,
        rpsState: { ...state.rpsState, status: mutation.status },
      };

    case 'SET_RPS_PLAYED_CARD':
      return {
        ...state,
        rpsState: {
          ...state.rpsState,
          playedCards: {
            ...state.rpsState.playedCards,
            [mutation.playerId]: mutation.card,
          },
        },
      };

    case 'RESET_RPS':
      return {
        ...state,
        rpsState: { status: 'pending', playedCards: {} },
      };

    // -- Win condition --
    case 'GAME_OVER':
      return {
        ...state,
        currentPhase: 'gameOver',
        previousPhase: null,
        priorityPlayerId: null,
        lastPassedPlayerId: null,
        winnerId: mutation.winnerId,
      };

    default:
      return state;
  }
}