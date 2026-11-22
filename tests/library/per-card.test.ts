import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { applyPlaytestEdit } from '@engine/playtest-edit';
import { PlaytestRecipeSchema } from '@card-game/protocol';
import { getBlueprint, getCardIds, getTokenIds } from '@library/card-catalog';
import { instantiateCard, instantiateToken } from '@library/card-factory';
import type { CardBlueprint } from '@shared/card.types';
import { randomUUID } from 'node:crypto';
import { createEmptyTestRoom } from '../helpers/test-room-factory';
import { runCardCase, type CardCase } from '../helpers/card-test-cases';

const cardCases = new Map(
  Object.entries(import.meta.glob<CardCase[]>('../card-cases/*.ts', { eager: true, import: 'default' }))
    .map(([path, cases]) => [path.slice('../card-cases/'.length, -'.ts'.length), cases]),
);

const tokenIds = new Set(getTokenIds());
const catalog = new Set([...getCardIds(), ...tokenIds]);
const requested = new Set((process.env.CARD_TEST_IDS ?? '').split(',').filter(Boolean));
const selected = [...(requested.size ? requested : new Set([...catalog, ...cardCases.keys()]))].sort();
type CaseResult = { name: string; covers: string[]; status: 'passed' | 'failed' | 'missing dependency'; detail?: string };
interface CardResult {
  id: string;
  catalog: 'active' | 'removed' | 'unknown';
  required: string[];
  cases: CaseResult[];
  recipe?: ReturnType<typeof PlaytestRecipeSchema.parse>;
}
const results: CardResult[] = [];

function checksFor(blueprint: CardBlueprint, token: boolean): string[] {
  return [
    token ? 'token lifecycle' : 'play',
    ...blueprint.abilities.map(ability => 'ability:' + ability.id),
    ...(blueprint.modes ?? []).map(mode => 'mode:' + mode.id),
    ...(blueprint.castRequirements.alternativeCosts ?? []).map(route => 'cost route:' + route.id),
    ...(blueprint.numericDeclarations ?? []).map(declaration => 'number:' + declaration.name),
    ...(blueprint.castRequirements.additionalCost ? ['additional cost'] : []),
    ...((blueprint.onCastEffects?.length ?? 0) ? ['cast effects'] : []),
    ...((blueprint.onEnterEffects?.length ?? 0) ? ['entry effects'] : []),
  ];
}

function register(card: CardResult, name: string, check: () => void, covers: string[] = []) {
  it(name, () => {
    try {
      check();
      card.cases.push({ name, covers, status: 'passed' });
    } catch (error) {
      card.cases.push({ name, covers, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
}

function catalogCheck(card: CardResult) {
  const token = tokenIds.has(card.id);
  const blueprint = getBlueprint(card.id);
  card.required = checksFor(blueprint, token);
  const room = createEmptyTestRoom();
  const instance = token ? instantiateToken(card.id, 'player1') : instantiateCard(card.id);
  if (token) room.battlefield.push(instance);
  else {
    instance.state = { ...instance.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    room.players.player1.hand.push(instance);
  }
  const engine = new GameEngine(room);
  try {
    engine.initRoom();
    expect(instance.blueprint.id).toBe(card.id);
    expect(Object.isFrozen(blueprint)).toBe(true);
    expect(token ? engine.roomState.battlefield : engine.roomState.players.player1.hand)
      .toContainEqual(expect.objectContaining({ uuid: instance.uuid }));
    if (process.env.CARD_TEST_RECIPE === '1') {
      const recipe = PlaytestRecipeSchema.parse({
        format: 'card-game-playtest-edits', version: 1,
        edits: [
          { kind: 'turn', seat: 0, priority: 0, turnNumber: 1, phase: 'stateMainPhase' },
          { kind: 'player', seat: 0, life: 20, landPlaysUsed: 0,
            mana: { red: 10, blue: 10, white: 10, black: 10, green: 10, yellow: 10 } },
          token ? { kind: 'token', seat: 0, cardId: card.id, quantity: 1 }
            : { kind: 'add', seat: 0, cardId: card.id, quantity: 1, zone: 'hand' },
        ],
      });
      const setup = recipe.edits.reduce((board, edit) => applyPlaytestEdit(board, edit, { uuid: randomUUID }).room, createEmptyTestRoom());
      expect((token ? setup.battlefield : setup.players.player1.hand).some(card => card.blueprint.id === instance.blueprint.id)).toBe(true);
      card.recipe = recipe;
    }
  } finally {
    engine.dispose();
  }
}

function uncovered(card: CardResult): string[] {
  const passed = new Set(card.cases.filter(result => result.status === 'passed').flatMap(result => result.covers));
  return card.required.filter(check => !passed.has(check));
}

for (const id of selected) {
  const scenarios = cardCases.get(id);
  const card: CardResult = { id, catalog: catalog.has(id) ? 'active' : scenarios ? 'removed' : 'unknown', required: [], cases: [] };
  results.push(card);
  describe(id, () => {
    if (card.catalog === 'unknown') {
      register(card, 'exists in the catalog', () => { throw new Error('Unknown card ID: ' + id); });
      return;
    }
    if (card.catalog === 'removed') {
      it('records the removed catalog entry', () => { expect(catalog.has(id)).toBe(false); });
      return;
    }
    register(card, 'loads and enters an isolated match setup', () => catalogCheck(card));
    for (const scenario of scenarios ?? []) {
      const missing = scenario.requires?.filter(dependency => !catalog.has(dependency)) ?? [];
      if (missing.length) {
        card.cases.push({ name: scenario.name, covers: scenario.covers ?? [], status: 'missing dependency', detail: missing.join(', ') });
        it.skip(scenario.name);
      } else {
        register(card, scenario.name, () => runCardCase(id, scenario), scenario.covers);
      }
    }
    if (process.env.CARD_TEST_STRICT === '1') {
      it('has behavior coverage for its catalog rules', () => {
        expect(uncovered(card)).toEqual([]);
        expect(card.cases.filter(result => result.status === 'missing dependency')).toEqual([]);
      });
    }
  });
}

afterAll(() => {
  if (!process.env.CARD_TEST_REPORT) return;
  const report = results.map(card => {
    const missing = uncovered(card);
    const failed = card.cases.some(result => result.status === 'failed');
    const incomplete = missing.length || card.cases.some(result => result.status === 'missing dependency');
    return { ...card, missing, status: failed ? 'failed' : card.catalog === 'removed' ? 'removed' : incomplete ? 'missing coverage' : 'passed' };
  });
  const path = resolve(process.env.CARD_TEST_REPORT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
});
