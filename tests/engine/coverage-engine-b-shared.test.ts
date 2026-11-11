import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameLogger, consoleLogSink, serverLogger, clientLogger, engineLogger, type LogEntry } from '@rules/game-logger';
import { actionPermission } from '@rules/action-permissions';
import { matchesTargetFilter } from '@rules/target-utils';
import { CardCharacteristicService, withCharacteristicCache } from '@engine/card-characteristic-service';
import { endTurnHandler } from '@engine/handlers/end-turn-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

afterEach(() => vi.restoreAllMocks());

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: '2026-08-28T12:34:56.789Z',
  level: 'info',
  source: 'test',
  event: 'evt',
  ...over,
});

describe('GameLogger', () => {
  it('writes a formatted line through the console sink and picks the console method by level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    consoleLogSink(entry());
    expect(log).toHaveBeenLastCalledWith('[12:34:56.789] INFO  test evt');

    consoleLogSink(entry({ message: 'hello', data: { a: 1 }, context: { room: 'r1' } }));
    expect(log).toHaveBeenLastCalledWith('[12:34:56.789] INFO  test evt hello {"room":"r1","a":1}');

    consoleLogSink(entry({ level: 'warn', context: { a: 1 } }));
    expect(warn).toHaveBeenLastCalledWith('[12:34:56.789] WARN  test evt {"a":1}');

    consoleLogSink(entry({ level: 'error' }));
    expect(error).toHaveBeenLastCalledWith('[12:34:56.789] ERROR test evt');
  });

  it('defaults to the console sink, debug level and the app source', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new GameLogger();
    logger.debug('room:created', 'made a room', { id: 1 });
    logger.info('rps:resolved');
    logger.warn('weird');
    logger.error('boom');
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('DEBUG app room:created made a room {"id":1}'),
      expect.stringContaining('INFO  app rps:resolved'),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WARN  app weird'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ERROR app boom'));
  });

  it('filters by minimum level and can be disabled entirely', () => {
    const sink = vi.fn();
    const quiet = new GameLogger({ minLevel: 'warn', source: 'server', sinks: [sink] });
    quiet.debug('d');
    quiet.info('i');
    expect(sink).not.toHaveBeenCalled();
    quiet.warn('w');
    expect(sink).toHaveBeenCalledTimes(1);

    const off = new GameLogger({ enabled: false, sinks: [sink] });
    off.error('e');
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('inherits configuration and merges context without mutating the parent', () => {
    const sink = vi.fn();
    const parent = new GameLogger({ minLevel: 'info', source: 'engine', context: { matchId: 'm1' }, sinks: [sink] });
    const child = parent.withContext({ playerId: 'p1' });

    child.info('draw', undefined, { amount: 1 });
    parent.info('other');

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0][0]).toMatchObject({
      source: 'engine',
      event: 'draw',
      context: { matchId: 'm1', playerId: 'p1' },
      data: { amount: 1 },
    });
    expect(sink.mock.calls[1][0].context).toEqual({ matchId: 'm1' });
  });

  it('fans one entry out to every configured sink', () => {
    const a = vi.fn();
    const b = vi.fn();
    new GameLogger({ sinks: [a, b] }).info('fan');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toEqual(b.mock.calls[0][0]);
  });

  it('exposes pre-configured singletons that inherit their documented source', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    for (const logger of [serverLogger, clientLogger, engineLogger]) expect(logger).toBeInstanceOf(GameLogger);
    engineLogger.info('tick');
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('INFO  engine tick'));
  });
});

describe('actionPermission', () => {
  type PermissionRule = {
    action: 'cast' | 'activate';
    mode: 'prohibit' | 'instant';
    players?: 'self' | 'opponent' | 'any';
    abilityIds?: string[];
  };

  function permissionRoom(rules: PermissionRule[], keywords: string[] = []) {
    const room = createTestRoom();
    const source = creature('rule-source', 'player2');
    const target = creature('target-card', 'player1', 1, 1, keywords);
    room.battlefield = [source, target];
    room.continuousEffectPool = [{
      layer: 80,
      duration: 'PERMANENT',
      source: source.uuid,
      sourceControllerId: 'player2',
      effect: { type: 'PERMISSION', rules },
      scope: { objects: [{ cardUuid: target.uuid, zoneRevision: 0 }] },
    }] as never;
    return { room, target, source };
  }

  it('allows actions and reports sorcery speed when no rule applies', () => {
    const { room, target } = permissionRoom([]);
    expect(actionPermission(room, 'player1', target, 'cast')).toEqual({ allowed: true, instant: false });
    expect(actionPermission(room, 'player1', target, 'activate', 'sigil')).toEqual({ allowed: true, instant: false });
  });

  it('prohibits only the matching action and player relation', () => {
    const selfProhibit = permissionRoom([{ action: 'cast', mode: 'prohibit', players: 'self' }]);
    // The rule belongs to player2, so player1 is outside a "self" rule.
    expect(actionPermission(selfProhibit.room, 'player1', selfProhibit.target, 'cast').allowed).toBe(true);
    expect(actionPermission(selfProhibit.room, 'player2', selfProhibit.target, 'cast').allowed).toBe(false);

    const opponentProhibit = permissionRoom([{ action: 'activate', mode: 'prohibit', players: 'opponent' }]);
    expect(actionPermission(opponentProhibit.room, 'player2', opponentProhibit.target, 'activate').allowed).toBe(true);
    expect(actionPermission(opponentProhibit.room, 'player1', opponentProhibit.target, 'activate').allowed).toBe(false);
    // The action discriminator excludes an "activate" rule from a cast check.
    expect(actionPermission(opponentProhibit.room, 'player1', opponentProhibit.target, 'cast').allowed).toBe(true);
  });

  it('ignores an opponent rule whose source has no recorded controller', () => {
    const room = createTestRoom();
    const target = creature('sourceless-target', 'player1');
    room.battlefield = [target];
    room.continuousEffectPool = [{
      layer: 80,
      duration: 'PERMANENT',
      source: 'missing-source-card',
      effect: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'prohibit', players: 'opponent' }] },
      scope: { objects: [{ cardUuid: target.uuid, zoneRevision: 0 }] },
    }] as never;
    expect(actionPermission(room, 'player1', target, 'cast').allowed).toBe(true);
  });

  it('scopes a rule to named abilities', () => {
    const { room, target } = permissionRoom([{ action: 'activate', mode: 'prohibit', abilityIds: ['sigil'] }]);
    expect(actionPermission(room, 'player1', target, 'activate').allowed).toBe(true);
    expect(actionPermission(room, 'player1', target, 'activate', 'other').allowed).toBe(true);
    expect(actionPermission(room, 'player1', target, 'activate', 'sigil').allowed).toBe(false);
  });

  it('reports instant timing from a rule or the flash keyword', () => {
    const instantRule = permissionRoom([{ action: 'cast', mode: 'instant' }]);
    expect(actionPermission(instantRule.room, 'player1', instantRule.target, 'cast').instant).toBe(true);
    expect(actionPermission(instantRule.room, 'player1', instantRule.target, 'activate').instant).toBe(false);

    const flashCard = permissionRoom([], ['Flash']);
    expect(actionPermission(flashCard.room, 'player1', flashCard.target, 'cast')).toEqual({ allowed: true, instant: true });
    // Flash only accelerates casting, never activation.
    expect(actionPermission(flashCard.room, 'player1', flashCard.target, 'activate').instant).toBe(false);
  });
});

describe('matchesTargetFilter', () => {
  const def = (over: Record<string, unknown> = {}) => ({ type: 'permanent', required: false, ...over }) as never;

  it('evaluates printed characteristics when no room is supplied', () => {
    const card = creature('solo', 'player1', 2, 2);
    expect(matchesTargetFilter(card, def(), 'player1')).toBe(true);
    expect(matchesTargetFilter(card, def({ cardTypes: ['Land'] }), 'player1')).toBe(false);
    expect(matchesTargetFilter(card, def({ controller: 'self' }), 'player1')).toBe(true);
    expect(matchesTargetFilter(card, def({ controller: 'self' }), 'player2')).toBe(false);
  });

  it('uses effective characteristics and battlefield-relative extrema for the lowest remaining health', () => {
    const room = createTestRoom();
    const big = creature('big', 'player1', 2, 4);
    const small = creature('small', 'player1', 2, 2);
    const hurt = creature('hurt', 'player1', 2, 4);
    hurt.state.damageTaken = 2;
    room.battlefield = [big, small, hurt];
    const lowest = def({ extrema: { field: 'remainingHealth', order: 'min' } });

    expect(matchesTargetFilter(small, lowest, 'player1', room)).toBe(true);
    expect(matchesTargetFilter(big, lowest, 'player1', room)).toBe(false);
    // A 4/4 with two damage is tied with the 2/2 and is also a minimum.
    expect(matchesTargetFilter(hurt, lowest, 'player1', room)).toBe(true);
    // Structural filters still gate the extrema search.
    expect(matchesTargetFilter(small, def({ extrema: { field: 'remainingHealth', order: 'min' }, cardTypes: ['Land'] }), 'player1', room)).toBe(false);
  });

  it('treats a missing damage value as zero when ranking remaining health', () => {
    const room = createTestRoom();
    const untouched = creature('untouched', 'player1', 1, 3);
    delete (untouched.state as { damageTaken?: number }).damageTaken;
    const chipped = creature('chipped', 'player1', 1, 3);
    chipped.state.damageTaken = 0;
    room.battlefield = [untouched, chipped];
    expect(matchesTargetFilter(untouched, def({ extrema: { field: 'remainingHealth', order: 'min' } }), 'player1', room)).toBe(true);
    expect(matchesTargetFilter(chipped, def({ extrema: { field: 'remainingHealth', order: 'min' } }), 'player1', room)).toBe(true);
  });

  it('rejects unsupported extrema, off-battlefield cards and empty candidate sets', () => {
    const room = createTestRoom();
    const card = creature('only', 'player1', 2, 2);
    room.battlefield = [card];
    expect(matchesTargetFilter(card, def({ extrema: { field: 'remainingHealth', order: 'min' } }), 'player1')).toBe(false);
    expect(matchesTargetFilter(card, def({ extrema: { field: 'power', order: 'min' } }), 'player1', room)).toBe(false);
    expect(matchesTargetFilter(card, def({ extrema: { field: 'remainingHealth', order: 'max' } }), 'player1', room)).toBe(false);

    const benched = creature('benched', 'player1', 2, 2);
    benched.state.zone = 'hand';
    expect(matchesTargetFilter(benched, def({ extrema: { field: 'remainingHealth', order: 'min' } }), 'player1', room)).toBe(false);

    // A card that claims the battlefield but is absent from the board yields no candidates.
    const ghost = creature('ghost', 'player1', 2, 2);
    room.battlefield = [];
    expect(matchesTargetFilter(ghost, def({ extrema: { field: 'remainingHealth', order: 'min' } }), 'player1', room)).toBe(false);
  });
});

describe('CardCharacteristicService', () => {
  it('resolves every facade projection for a card', () => {
    const room = createTestRoom();
    const card = room.players.player1.hand[0];
    expect(CardCharacteristicService.resolveBlueprint(room, card).name).toBe(card.blueprint.name);
    expect(CardCharacteristicService.resolveCopiableBlueprint(room, card).id).toBe(card.blueprint.id);
    expect(CardCharacteristicService.resolveManaCost(room, card)).toEqual(card.blueprint.castRequirements.cost?.mana ?? {});
    expect(CardCharacteristicService.resolveManaValue(room, card)).toBe(
      Object.values(card.blueprint.castRequirements.cost?.mana ?? {}).reduce<number>((sum, value) => sum + (value as number), 0),
    );
    expect(CardCharacteristicService.resolvePower(room, card)).toBe(card.blueprint.power ?? 0);
    expect(CardCharacteristicService.resolveToughness(room, card)).toBe(card.blueprint.toughness ?? 0);
    expect(CardCharacteristicService.resolveKeywords(room, card)).toEqual(card.blueprint.keywords ?? []);
    expect(CardCharacteristicService.resolveTypes(room, card)).toEqual(card.blueprint.cardTypes);
    expect(CardCharacteristicService.resolveSubTypes(room, card)).toEqual(card.blueprint.subTypes ?? []);
    expect(CardCharacteristicService.resolveColors(room, card)).toEqual(card.blueprint.colors ?? []);
    expect(CardCharacteristicService.resolveAbilities(room, card)).toEqual(card.blueprint.abilities ?? []);
    expect(CardCharacteristicService.resolveController(room, card)).toBe('player1');
  });

  it('reports an empty mana cost for a card with no mana requirement', () => {
    const room = createTestRoom();
    const free = creature('free-card', 'player1');
    room.battlefield = [free];
    expect(CardCharacteristicService.resolveManaCost(room, free)).toEqual({});
  });

  it('memoizes per room and layer inside a cache scope and restores the previous scope on throw', () => {
    const room = createTestRoom();
    const card = room.players.player1.hand[0];

    const uncachedFirst = CardCharacteristicService.resolve(room, card);
    const uncachedSecond = CardCharacteristicService.resolve(room, card);
    expect(uncachedFirst).not.toBe(uncachedSecond);

    const inside = withCharacteristicCache(room, () => [
      CardCharacteristicService.resolve(room, card),
      CardCharacteristicService.resolve(room, card),
      CardCharacteristicService.resolve(room, card, 1),
    ]);
    expect(inside[0]).toBe(inside[1]);
    expect(inside[2]).not.toBe(inside[0]);

    // A different room bypasses the active scope's caches.
    const otherRoom = createTestRoom();
    const otherCard = otherRoom.players.player1.hand[0];
    withCharacteristicCache(room, () => {
      expect(CardCharacteristicService.resolve(otherRoom, otherCard).name).toBe(otherCard.blueprint.name);
    });

    // A card absent from the board uses the per-card, per-layer cache instead.
    const stray = structuredClone(card);
    stray.uuid = 'stray-card';
    const strays = withCharacteristicCache(room, () => [
      CardCharacteristicService.resolve(room, stray),
      CardCharacteristicService.resolve(room, stray),
    ]);
    expect(strays[0]).toBe(strays[1]);

    expect(() => withCharacteristicCache(room, () => {
      throw new Error('scope failure');
    })).toThrow('scope failure');

    // The scope was restored, so uncached resolution is back.
    expect(CardCharacteristicService.resolve(room, card)).not.toBe(CardCharacteristicService.resolve(room, card));
  });
});

describe('endTurnHandler', () => {
  it('rejects RPS, a non-empty stack and non-turn players', () => {
    expect(endTurnHandler.validate({ ...createTestRoom(), status: 'RPS' }, 'player1', {})).toMatchObject({
      success: false,
      reason: expect.stringContaining('Rock Paper Scissors'),
    });
    const stacked = createTestRoom();
    stacked.stack = [{ uuid: 'obj' } as never];
    expect(endTurnHandler.validate(stacked, 'player1', {})).toMatchObject({
      success: false,
      reason: expect.stringContaining('stack'),
    });
    expect(endTurnHandler.validate(createTestRoom(), 'player2', {})).toMatchObject({
      success: false,
      reason: 'Not your turn!',
    });
  });

  it('accepts the active player on an empty stack and has no propose/resolve work', () => {
    const room = createTestRoom();
    expect(endTurnHandler.validate(room, 'player1', {})).toEqual({ success: true });
    expect(endTurnHandler.propose!(room, 'player1', {})).toEqual({ success: true });
    expect(endTurnHandler.resolve!(room, {} as never)).toEqual({ success: true });
  });
});
