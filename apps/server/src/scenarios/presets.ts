import { gameplayPresetNames, getSetupPreset } from '../config/gameplay';
import { ScenarioFixtureSchema } from '@card-game/protocol';
export const presetNames = gameplayPresetNames;
export function presetFixture(name: string) {
    const old = getSetupPreset(name), counts = new Map<string, number>();
    for (const id of old.developmentDeck)
        counts.set(id, (counts.get(id) ?? 0) + 1);
    const p = () => ({ life: old.startingLife, library: [...counts].map(([cardId, quantity]) => ({ cardId, quantity })), libraryOrder: [...old.developmentDeck].reverse(), hand: [], graveyard: [], battlefield: [] });
    return ScenarioFixtureSchema.parse({ format: 'card-game-scenario', version: 1, scenario: { schemaVersion: 1, name: 'Legacy ' + name, players: [p(), p()], openingHandSize: old.openingHandSize, firstPlayer: 0, shuffle: old.shuffleDevelopmentDeck ? 'seeded' : 'fixed', seed: 1, rulesProfile: old.scorch ? 'scorch-v1' : 'standard-v1' }, provenance: { sourceId: null, revision: 0, instanceId: 'legacy-fixtures' } });
}
