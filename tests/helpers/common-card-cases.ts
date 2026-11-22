import { expect } from 'vitest';
import { parseCardDefinition } from '@library/card-parser';
import type { ManaColor } from '@shared/card.types';
import { act, resolveByPassing, type CardCase } from './card-test-cases';
import { creature } from './combat-fixture';

function basicLand(color: ManaColor): CardCase {
  const abilityId = 'produce-' + color;
  return {
    name: `uses the land play and taps for exactly one ${color} energy`,
    covers: ['play', 'ability:' + abilityId],
    run(engine, source) {
      act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.zone).toBe('battlefield');
      expect(engine.roomState.turnHistory?.landPlays.player1).toBe(1);
      const before = { ...engine.roomState.players.player1.mana };
      const ability = { cardUuid: source.uuid, abilityId, manaColor: color };
      act(engine, 'tapForMana', ability);
      expect(engine.roomState.players.player1.mana).toEqual({ ...before, [color]: before[color] + 1 });
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(true);
      expect(engine.executePlayerAction('player1', 'tapForMana', ability).success).toBe(false);
      expect(engine.roomState.players.player1.mana).toEqual({ ...before, [color]: before[color] + 1 });
    },
  };
}

function dualLand(colors: readonly [ManaColor, ManaColor]): CardCase[] {
  const supported = new Set<ManaColor>(colors);
  const unsupported = (['red', 'black', 'green', 'yellow', 'white', 'blue'] as const).find(color => !supported.has(color))!;
  return colors.map(color => ({
    name: `enters tapped and produces only one ${color} when chosen`,
    covers: ['play', 'ability:entry-tap', 'ability:produce-chosen-color'],
    run(engine, source) {
      act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(true);
      const ability = { cardUuid: source.uuid, abilityId: 'produce-chosen-color', manaColor: color };
      expect(engine.executePlayerAction('player1', 'tapForMana', ability).success).toBe(false);
      engine.applyMutations([{ type: 'UNTAP_CARD', cardUuid: source.uuid }]);
      const before = { ...engine.roomState.players.player1.mana };
      expect(engine.executePlayerAction('player1', 'tapForMana', { ...ability, manaColor: unsupported }).success).toBe(false);
      act(engine, 'tapForMana', ability);
      expect(engine.roomState.players.player1.mana).toEqual({ ...before, [color]: before[color] + 1 });
    },
  }));
}

function vanillaCreature(power: number, toughness: number, payment?: ManaColor): CardCase {
  return {
    name: `casts for ${payment ? 'one ' + payment : 'zero'} and enters as a ${power}/${toughness}`,
    covers: ['play'],
    run(engine, source) {
      const before = { ...engine.roomState.players.player1.mana };
      act(engine, 'cast_spell', { cardUuid: source.uuid });
      expect(engine.roomState.players.player1.mana).toEqual(payment ? { ...before, [payment]: before[payment] - 1 } : before);
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power, toughness });
    },
  };
}

function manaCreature(color: ManaColor, cost = 1): CardCase {
  const abilityId = 'produce-' + color;
  return {
    name: `costs ${cost} ${color}, then taps for one ${color} after summoning sickness`,
    covers: ['play', 'ability:' + abilityId],
    run(engine, source) {
      const before = { ...engine.roomState.players.player1.mana };
      act(engine, 'cast_spell', { cardUuid: source.uuid });
      expect(engine.roomState.players.player1.mana).toEqual({ ...before, [color]: before[color] - cost });
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)).toMatchObject({
        blueprint: { power: 1, toughness: 1 }, state: { summoningSickness: true },
      });
      const ability = { cardUuid: source.uuid, abilityId, manaColor: color };
      expect(engine.executePlayerAction('player1', 'tapForMana', ability).success).toBe(false);
      engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid: source.uuid, value: false }]);
      act(engine, 'tapForMana', ability);
      expect(engine.roomState.players.player1.mana).toEqual({ ...before, [color]: before[color] - cost + 1 });
    },
  };
}

function tokenLifecycle(power: number, toughness: number): CardCase {
  return {
    name: `enters as a ${power}/${toughness} token and disappears after destruction`,
    covers: ['token lifecycle'],
    prepare(room) {
      const spell = creature('fixture-destroy-spell', 'player2');
      spell.state.zone = 'hand';
      spell.blueprint = parseCardDefinition({
        schemaVersion: 1, id: 'fixture-destroy-spell', cardTypes: ['Spell'], name: 'Fixture destroy spell',
        onCastEffects: [{ family: 'cards', operation: 'destroy',
          targeting: { type: 'permanent', controller: 'opponent', cardTypes: ['Creature'], required: true, minTargets: 1, maxTargets: 1 } }],
      });
      room.players.player2.hand.push(spell);
      room.priorityPlayerId = 'player2';
      room.activeTurnPlayerId = 'player2';
    },
    run(engine, source) {
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)).toMatchObject({
        isToken: true, blueprint: { power, toughness }, state: { zone: 'battlefield' },
      });
      act(engine, 'cast_spell', { cardUuid: 'fixture-destroy-spell', targets: [{ targetType: 'permanent', cardUuid: source.uuid }] }, 'player2');
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.some(card => card.uuid === source.uuid)).toBe(false);
      expect(engine.roomState.players.player1.graveyard.some(card => card.uuid === source.uuid)).toBe(false);
    },
  };
}

export const commonCardCases: Record<string, CardCase[]> = {
  'land-red': [basicLand('red')],
  'ancient-weapon-battlefield': [basicLand('white')],
  'angel-holy-land': [basicLand('yellow')],
  'aurora-northland': [basicLand('white')],
  'beast-holy-land': [basicLand('green')],
  'blazing-dragon-habitat': [basicLand('red')],
  'divine-wind-torii': [basicLand('green')],
  'nether-ancient-land': [basicLand('black')],
  'phantom-underworld': [basicLand('black')],
  'sea-domain': [basicLand('blue')],
  'thunder-main-camp': [basicLand('yellow')],
  'blazing-wind-river': dualLand(['green', 'red']),
  'demon-flame-abyss': dualLand(['red', 'blue']),
  'far-north-graveyard': dualLand(['white', 'black']),
  'great-wave-thunder-array': dualLand(['blue', 'yellow']),
  'thunder-tundra': dualLand(['yellow', 'white']),
  'undying-dusk-forest': dualLand(['black', 'green']),
  'frozen-snowball': [vanillaCreature(2, 2)],
  'musketeer-infantry': [vanillaCreature(4, 5, 'red')],
  'sky-hound': [vanillaCreature(2, 2, 'yellow')],
  'empire-servant': [manaCreature('red')],
  'sea-city-noble': [manaCreature('blue')],
  'wind-beast-bean': [manaCreature('green')],
  'winged-envoy': [manaCreature('yellow', 2)],
  'winter-drake': [manaCreature('white')],
  'token-angel-1-1': [tokenLifecycle(1, 1)],
  'token-phantom-stitch-monster': [tokenLifecycle(7, 6)],
};
