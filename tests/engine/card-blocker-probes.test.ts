import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { parseCardDefinition } from '@library/card-parser';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

// Test-only recipes demonstrate composition; no workbook card is registered by this audit.
const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
const self = { type: 'self', required: false };
const eligible = { colors: ['black'], cardTypes: ['Spell', 'Artifact', 'Land'], not: { cardTypes: ['Creature'] } };
const count = { numeric: { kind: 'query', id: 'count', args: { scope: {
  from: { kind: 'result', name: 'milled' }, zones: ['graveyard'], ...eligible,
} } } };
const effects = [
  { family: 'cards', operation: 'mill', params: { amount: 1 }, targeting: self,
    recordResult: { name: 'milled', kind: 'milled' }, choice: { kind: 'optional' } },
  { family: 'cards', operation: 'move', params: { origin: 'graveyard', destination: 'hand' }, targeting: self,
    condition: { op: 'gt', left: count, right: 0 },
    choice: { kind: 'search', zone: 'graveyard', from: { kind: 'result', name: 'milled' }, ...eligible, min: 0, max: 1 } },
];
function triggered(id: string, triggerCondition: string) {
  return { id, type: 'triggered', castSpeed: 'instant', triggerCondition, trigger: { subject: 'self' }, effects };
}

const attachmentRequirements = {
  type: 'permanent', controller: 'self', cardTypes: ['Creature'], subTypes: ['幻影木偶'],
  required: true, minTargets: 1, maxTargets: 1,
};
const scythe = {
  schemaVersion: 1, id: 'probe-scythe', name: 'Test-only scythe recipe', manaCost: '{1}{B}{B}',
  cardTypes: ['Artifact'], subTypes: ['Equipment'], colors: ['black'], attachmentRequirements,
  abilities: [
    { id: 'attach', type: 'activated', cost: {}, castSpeed: 'sorcery',
      effect: { family: 'attachments', operation: 'attach', targeting: attachmentRequirements } },
    { id: 'equipped-creature', type: 'static', rules: [
      { id: 'equipped-creature-power', group: 'effect', family: 'characteristics', scope: { attachedToSource: true },
        operation: { type: 'STAT_DELTA', power: 2 } },
      { id: 'equipped-creature-trigger', group: 'effect', family: 'characteristics', scope: { attachedToSource: true },
        operation: { type: 'ABILITY', add: [triggered('scythe-attack', 'ON_ATTACK')] } },
    ] },
  ],
};

function setup(equipment = false, type = 'Spell', color = 'black') {
  const raw = equipment ? scythe : {
    schemaVersion: 1, id: 'probe-ghostfire', name: 'Test-only ghostfire recipe', manaCost: '{1}{B}{B}',
    cardTypes: ['Creature'], subTypes: ['幻影木偶'], colors: ['black'], power: 3, toughness: 3,
    abilities: [triggered('entry', 'ON_ENTER_BATTLEFIELD'), triggered('attack', 'ON_ATTACK')],
  };
  const room = createTestRoom(); fillTestLibraries(room, 8);
  const source = creature(raw.id, 'player1'); source.blueprint = parseCardDefinition(raw); source.state.zone = 'hand';
  room.players.player1.hand = [source];
  const top = creature('top', 'player1'); top.state.zone = 'library';
  top.blueprint = { ...top.blueprint, cardTypes: [type], colors: [color as any] }; room.players.player1.deck.push(top);
  const old = creature('older', 'player1'); old.state.zone = 'graveyard';
  old.blueprint = { ...old.blueprint, cardTypes: ['Spell'], colors: ['black'] }; room.players.player1.graveyard.push(old);
  const host = creature('host', 'player1'); host.blueprint = { ...host.blueprint, subTypes: ['幻影木偶'] };
  if (equipment) room.battlefield.push(host);
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
  expect(engine.resolveTopOfStack().success).toBe(true);
  if (!equipment) expect(engine.resolveTopOfStack().success).toBe(true);
  return { engine, source, top, host };
}
function choose(engine: GameEngine, choices: string[]) {
  const choice = engine.roomState.pendingChoice!;
  expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices }).success).toBe(true);
}
function attack(engine: GameEngine, uuid: string) {
  engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
  engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid: uuid, value: false }]);
  expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: uuid }] }).success).toBe(true);
  expect(engine.resolveTopOfStack().success).toBe(true);
}
describe('latest blocker audit: existing-consumer composition proofs', () => {
  it.each(['Spell', 'Artifact', 'Land'])('can mill and optionally recover the exact black %s on entry', type => {
    const { engine } = setup(false, type); choose(engine, ['yes']);
    expect(engine.roomState.players.player1.graveyard.some(card => card.uuid === 'top')).toBe(true);
    expect(engine.roomState.pendingChoice!.options.map(option => option.id)).toEqual(['top']);
    choose(engine, ['top']); expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['top']);
    expect(JSON.stringify(engine.roomState)).not.toContain('"resolutionResults"');
  });
  it.each([['Creature', 'black'], ['Spell', 'white']])('excludes %s/%s without offering an older matching graveyard card', (type, color) => {
    const { engine } = setup(false, type, color); choose(engine, ['yes']);
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.players.player1.hand).toEqual([]);
  });
  it('can decline the mill and still use a fresh exact-card result on attack', () => {
    const { engine, source } = setup(); choose(engine, ['no']);
    expect(engine.roomState.players.player1.deck.at(-1)?.uuid).toBe('top');
    attack(engine, source.uuid); choose(engine, ['yes']); choose(engine, []);
    expect(engine.roomState.players.player1.hand).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.some(card => card.uuid === 'top')).toBe(true);
  });
  it('composes restricted attachment, +2 attack and the host’s exact-mill recovery trigger', () => {
    const { engine, source, host } = setup(true);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'attach',
      targets: [{ targetType: 'permanent', cardUuid: host.uuid }] }).success).toBe(true);
    engine.resolveTopOfStack(); expect(CardCharacteristicService.resolvePower(engine.roomState, host)).toBe(4);
    attack(engine, host.uuid); choose(engine, ['yes']);
    expect(engine.roomState.pendingChoice!.options.map(option => option.id)).toEqual(['top']); choose(engine, ['top']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['top']);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    expect(CardCharacteristicService.resolveAbilities(engine.roomState, host).some(ability => ability.id?.startsWith('scythe-attack@'))).toBe(false);
  });
});
