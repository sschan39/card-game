import angel from './angel-1-1.json';
import phantomStitchMonster from './token-phantom-stitch-monster.json';

/** Named token blueprints use the ordinary card schema, but are not playable deck definitions. */
const tokens: Record<string, unknown> = { [angel.id]: angel, [phantomStitchMonster.id]: phantomStitchMonster };
export default tokens;

/** Pure manifest lookup; schema validation never recursively loads a parsed blueprint. */
export function isTokenDefinition(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(tokens, id);
}
