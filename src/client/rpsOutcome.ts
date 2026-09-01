/**
 * src/client/rpsOutcome.ts
 * Pure, DOM-free helpers for the Rock/Paper/Scissors resolution messaging.
 *
 * Kept dependency-free so the outcome attribution logic is unit-testable
 * without a browser (import in Vitest directly).
 */

export interface RpsOutcome {
  winner: string; // winning PlayerId (socket id)
  firstTurnPlayerId: string;
}

export type RpsPerspective = 'you-win' | 'opponent-win' | 'tie' | 'pending';

/**
 * Classify an RPS resolution from the local player's perspective.
 * - { winner, firstTurnPlayerId } when the game advanced.
 * - { tie } when it re-prompts.
 * Returns 'pending' for any other shape (e.g. only one choice recorded yet).
 */
export function classifyRpsOutcome(
  data: { winner?: string; tie?: boolean },
  myPlayerId: string | null | undefined,
): RpsPerspective {
  if (data.tie) return 'tie';
  if (!data.winner) return 'pending';
  if (myPlayerId != null && data.winner === myPlayerId) return 'you-win';
  return 'opponent-win';
}

/**
 * The prompt text to show for the given perspective.
 * Used by the client RPS result handler to correctly attribute the winner
 * (History: the previous logic tested boolean truthiness of `winner`, so the
 * "you win" branch was dead code and a winning player always saw "opponent win".)
 */
export function rpsOutcomeText(perspective: RpsPerspective): string {
  switch (perspective) {
    case 'you-win':
      return 'You won the toss — you start!';
    case 'opponent-win':
      return 'Opponent won the toss — they start.';
    case 'tie':
      return 'Tie! Choose again — Rock, Paper, or Scissors!';
    case 'pending':
      return 'Waiting for your opponent…';
  }
}