import { randomUUID } from 'node:crypto';
import { PlaytestRecipeSchema, type PlaytestEdit, type PlaytestRecipe, type PlaytestZone } from '@card-game/protocol';
import { applyPlaytestEdit } from '@engine/playtest-edit';
import { getBlueprint, isTokenDefinition } from '@library/card-catalog';
import { getPlayableBlueprint } from '@library/card-factory';
import { createEmptyTestRoom } from './test-room-factory';

function place(cardId: string, seat: 0 | 1, zone: PlaytestZone): PlaytestEdit {
  try {
    getBlueprint(cardId);
  } catch (error) {
    throw new Error(`Recipe cannot place ${cardId}: ${error instanceof Error ? error.message : error}`);
  }
  if (!isTokenDefinition(cardId)) return { kind: 'add', seat, cardId, quantity: 1, zone };
  if (zone !== 'battlefield') throw new Error(`Place token ${cardId} on the battlefield.`);
  return { kind: 'token', seat, cardId, quantity: 1 };
}

export function cardRoomRecipe(cardId: string, companions: string[]): PlaytestRecipe {
  const mana = { red: 10, blue: 10, white: 10, black: 10, green: 10, yellow: 10 };
  const recipe = PlaytestRecipeSchema.parse({
    format: 'card-game-playtest-edits', version: 1,
    edits: [
      { kind: 'turn', seat: 0, priority: 0, turnNumber: 1, phase: 'stateMainPhase' },
      { kind: 'player', seat: 0, life: 20, landPlaysUsed: 0, mana },
      { kind: 'player', seat: 1, life: 20, landPlaysUsed: 0, mana },
      place(cardId, 0, isTokenDefinition(cardId) ? 'battlefield' : 'hand'),
      ...companions.map(value => {
        const [id, location] = value.split('@');
        const [seat, zone] = location.split(':');
        return place(id, seat === 'a' ? 0 : 1, zone as PlaytestZone);
      }),
    ],
  });
  recipe.edits.reduce((room, edit) => applyPlaytestEdit(room, edit, { uuid: randomUUID, resolveCard: getPlayableBlueprint }).room, createEmptyTestRoom());
  return recipe;
}
