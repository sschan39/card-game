import { describe, expect, it } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import type { CardInstance } from '@shared/card.types';
import type { StackObject } from '@shared/effect.types';
import { buildPlayerView, buildStackView } from '@server/projection/view-builder';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

/** A card whose generic mana requirement is a computed expression rather than a fixed number. */
function variableCostCard(): CardInstance {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  card.blueprint = {
    ...card.blueprint,
    castRequirements: { ...card.blueprint.castRequirements, cost: { ...card.blueprint.castRequirements.cost,
      mana: { generic: { numeric: { kind: 'add', left: 2, right: 3 } }, black: 2 } } },
  } as unknown as CardInstance['blueprint'];
  return card;
}

describe('card view state projection', () => {
  it('projects tokens, attachments to public permanents and player attachments', () => {
    const room = createTestRoom(), host = creature('public-host', 'player1'), token = creature('token-permanent', 'player1');
    token.isToken = true;
    token.state = { ...token.state, attachedTo: host.uuid, attachedToRevision: 4, attachedToPlayerId: 'player2', protectorId: host.uuid };
    room.battlefield = [host, token];
    const view = buildPlayerView(room, 'player1'), tokenView = view.battlefield.find(card => card.uuid === token.uuid)!;
    expect(tokenView.isToken).toBe(true);
    expect(tokenView.state).toMatchObject({ attachedTo: host.uuid, attachedToRevision: 4, attachedToPlayerId: 'player2', protectorId: host.uuid });
    expect(tokenView.label).toBe('token-permanent');
  });

  it('hides references to permanents that are not public battlefield objects', () => {
    const room = createTestRoom(), token = creature('hidden-token', 'player1');
    token.state = { ...token.state, attachedTo: 'missing-permanent', protectorId: 'missing-protector' };
    room.battlefield = [token];
    const state = buildPlayerView(room, 'player1').battlefield[0].state;
    expect(state).not.toHaveProperty('attachedTo'); expect(state).not.toHaveProperty('protectorId');
  });

  it('renders a computed generic requirement as a variable mana symbol', () => {
    const room = createTestRoom();
    room.battlefield = [variableCostCard()];
    expect(buildPlayerView(room, 'player1').battlefield[0].manaCost).toContain('{Variable}');
  });
});

describe('player and stack view optional fields', () => {
  it('carries a failed draw and a non-win outcome with its losses', () => {
    const room = createTestRoom();
    room.players.player1.failedDraw = true;
    room.outcome = { type: 'draw', losses: [{ playerId: 'player1', reason: 'decked' }] };
    const view = buildPlayerView(room, 'player2');
    expect(view.players.player1.failedDraw).toBe(true);
    expect(view.outcome).toEqual({ type: 'draw', losses: [{ playerId: 'player1', reason: 'decked' }] });
  });

  it('projects a combat declaration that is not yet blocked', () => {
    const room = createTestRoom(), attacker = creature('attacker', 'player1');
    room.combat = [{ uuid: 'combat-1', attacker, attackerPower: 2, blockers: [] }];
    const declaration = buildPlayerView(room, 'player1').combat[0];
    expect(declaration).toMatchObject({ uuid: 'combat-1', attackerPower: 2, attacker: { uuid: 'attacker' } });
    expect(declaration).not.toHaveProperty('blocked');
  });

  it('shows a fizzled stack object and hides ones whose source left the battlefield', () => {
    const room = createTestRoom(), source = creature('stack-source', 'player1');
    const visible: StackObject = { uuid: 'visible-trigger', type: 'triggered', controllerId: 'player1', source, effects: [], countered: false, fizzled: true };
    const hidden = instantiateCard('empire-servant');
    hidden.state = { ...hidden.state, zone: 'hand', ownerId: 'player2', controllerId: 'player2' };
    const invisible: StackObject = { uuid: 'hidden-trigger', type: 'triggered', controllerId: 'player2', source: hidden, effects: [], countered: false };
    room.stack = [visible, invisible];
    const view = buildPlayerView(room, 'player1');
    expect(view.stack[0]).toMatchObject({ uuid: 'visible-trigger', fizzled: true }); expect(view.stack[0].source).toMatchObject({ uuid: 'stack-source' });
    expect(view.stack[1]).toMatchObject({ uuid: 'hidden-trigger', source: null, description: 'Hidden source · triggered' });
    expect(view.stack[1]).not.toHaveProperty('fizzled');
    expect(buildStackView(room, 'player1', visible)).toMatchObject({ fizzled: true });
  });
});
