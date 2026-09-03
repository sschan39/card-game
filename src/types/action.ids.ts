/**
 * src/types/action.ids.ts
 * Single source of truth for the known player action IDs.
 *
 * Action IDs are free-form strings at the registry level (`ActionType = string`
 * in effect.types.ts) so the engine stays extensible. But the *known* set of
 * player actions is closed — these are the actions a player can take per the
 * rules (MTG CR 116.3: cast a spell, activate an ability, take a special action).
 *
 * This module is the compile-time link between producers (OptionService, client
 * components) and consumers (server.ts, ActionRegistry). If you add, rename, or
 * remove an action ID, change it HERE and every producer/consumer that references
 * `ACTION_IDS` or `ActionId` updates automatically. See docs/action-ids.md.
 */

/** The closed set of known player action IDs. */
export const ACTION_IDS = {
  castSpell: 'cast_spell',
  attack: 'attack',
  tapForMana: 'tapForMana',
  endTurn: 'end_turn',
  passPriority: 'pass_priority',
  resolveStack: 'resolve_stack',
  rpsPlay: 'rpsPlay',
} as const;

/** Union of the known action IDs — a closed set. */
export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];

/**
 * An action ID that can be emitted/handled.
 * Either one of the known `ActionId`s, or a dynamic activated-ability ID
 * (`activateAbility_<EFFECT_ID>`) generated per-card from the ability's effect.
 */
export type ActionIdOrAbility = ActionId | `activateAbility_${string}`;

/** Human-readable display labels for the known action IDs (used by GameLog). */
export const ACTION_ID_LABELS: Record<ActionId, string> = {
  [ACTION_IDS.castSpell]: 'Cast spell',
  [ACTION_IDS.attack]: 'Attack',
  [ACTION_IDS.tapForMana]: 'Tap for mana',
  [ACTION_IDS.endTurn]: 'End turn',
  [ACTION_IDS.passPriority]: 'Pass priority',
  [ACTION_IDS.resolveStack]: 'Resolve stack',
  [ACTION_IDS.rpsPlay]: 'RPS play',
};