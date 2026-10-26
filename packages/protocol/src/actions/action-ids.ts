/** Wire action vocabulary. A parity test keeps this aligned with the independent engine registry. */
export const ACTION_IDS = {
  castSpell: 'cast_spell',
  playLand: 'play_land',
  activateAbility: 'activate_ability',
  choose: 'choose',
  declareAttackers: 'declare_attackers',
  declareBlockers: 'declare_blockers',
  tapForMana: 'tapForMana',
  enterBattle: 'enter_battle',
  endTurn: 'end_turn',
  passPriority: 'pass_priority',
  resolveStack: 'resolve_stack',
  rpsPlay: 'rpsPlay',
} as const;

/** Union of the known action IDs — a closed set. */
export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];

/**
 * An action ID that can be emitted/handled.
 * Compatibility alias for consumers; abilities use the generic known action.
 */
export type ActionIdOrAbility = ActionId;

/** Human-readable display labels for the known action IDs (used by GameLog). */
export const ACTION_ID_LABELS: Record<ActionId, string> = {
  [ACTION_IDS.castSpell]: 'Cast spell',
  [ACTION_IDS.playLand]: 'Play land',
  [ACTION_IDS.activateAbility]: 'Activate ability',
  [ACTION_IDS.choose]: 'Choose',
  [ACTION_IDS.declareAttackers]: 'Declare attackers',
  [ACTION_IDS.declareBlockers]: 'Declare blockers',
  [ACTION_IDS.tapForMana]: 'Tap for mana',
  [ACTION_IDS.enterBattle]: 'Enter battle',
  [ACTION_IDS.endTurn]: 'End turn',
  [ACTION_IDS.passPriority]: 'Pass priority',
  [ACTION_IDS.resolveStack]: 'Resolve stack',
  [ACTION_IDS.rpsPlay]: 'RPS play',
};
