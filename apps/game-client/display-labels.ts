import { PHASE_LABELS, type PlayerView } from '@card-game/protocol';
import type { MessageKey, Translate } from '@card-game/ui';

type Phase = PlayerView['phase'];

/** Wire phase value to the interface key that names it. */
const PHASE_KEYS: Record<Phase, MessageKey> = {
  stateTurnStart: 'phase.untap',
  upkeepStep: 'phase.upkeep',
  stateDrawPhase: 'phase.draw',
  stateMainPhase: 'phase.main',
  postcombatMainPhase: 'phase.postcombatMain',
  beginCombatStep: 'phase.beginCombat',
  declareAttackersStep: 'phase.declareAttackers',
  declareBlockersStep: 'phase.declareBlockers',
  combatDamageStep: 'phase.combatDamage',
  endCombatStep: 'phase.endCombat',
  stateEndPhase: 'phase.end',
  cleanupStep: 'phase.cleanup',
};

/**
 * Wire action id to the interface key that names it.
 *
 * Three ids are camelCase (`tapForMana`, `rpsPlay`) while the rest are snake_case;
 * both spellings come straight from the protocol vocabulary and are kept verbatim.
 */
const ACTION_KEYS: Record<string, MessageKey> = {
  concede: 'action.concede',
  cast_spell: 'action.castSpell',
  play_land: 'action.playLand',
  activate_ability: 'action.activateAbility',
  choose: 'action.choose',
  declare_attackers: 'action.declareAttackers',
  declare_blockers: 'action.declareBlockers',
  tapForMana: 'action.tapForMana',
  enter_battle: 'action.enterBattle',
  end_turn: 'action.endTurn',
  pass_priority: 'action.passPriority',
  resolve_stack: 'action.resolveStack',
  rpsPlay: 'action.rpsPlay',
};

/** Phase name in the active language, falling back to the protocol's own label. */
export function phaseLabel(phase: Phase, t: Translate): string {
  const key = PHASE_KEYS[phase];
  return key ? t(key) : PHASE_LABELS[phase] ?? phase;
}

/** Action name in the active language; an unknown id stays visible verbatim. */
export function actionLabel(action: string, t: Translate): string {
  const key = ACTION_KEYS[action];
  return key ? t(key) : action;
}
