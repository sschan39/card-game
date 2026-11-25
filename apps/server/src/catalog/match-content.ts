import { freezeDefinition, getTokenBlueprint, getTokenIds, isTokenDefinition } from './card-catalog';
import { validateTokenReferences } from './token-references';
import { parseCardDefinition, parseCounterDefinitions } from '@card-game/engine/rules/parse';
import type { MatchContent } from '@card-game/engine/types/match-content.types';
import counters from './counters-v1.json';
import legacy from './legacy-match-content-v1.json';

let publishedContent: MatchContent | undefined;
let legacyContent: MatchContent | undefined;

export function loadMatchContent(): MatchContent {
  if (!publishedContent) {
    const tokenBlueprints = Object.fromEntries(getTokenIds().map(id => [id, getTokenBlueprint(id)]));
    const counterDefinitions = parseCounterDefinitions(counters);
    validateTokenReferences(counterDefinitions, isTokenDefinition, 'counters');
    publishedContent = freezeDefinition({ tokenBlueprints, counterDefinitions });
  }
  return publishedContent;
}

/** Format 1 predates pinned definitions. Its original token and counter data are archived. */
export function loadLegacyMatchContent(): MatchContent {
  if (!legacyContent) {
    const tokenBlueprints = Object.fromEntries(Object.entries(legacy.tokens).map(([id, raw]) => [id, parseCardDefinition(raw)]));
    const counterDefinitions = parseCounterDefinitions(legacy.counters);
    legacyContent = freezeDefinition({ tokenBlueprints, counterDefinitions });
  }
  return legacyContent;
}
