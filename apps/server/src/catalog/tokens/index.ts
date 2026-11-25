import tokens from './manifest.generated';

/** Named token blueprints use the ordinary card schema, but are not playable deck definitions. */
export default tokens;

/** Pure manifest lookup; schema validation never recursively loads a parsed blueprint. */
export function isTokenDefinition(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(tokens, id);
}
