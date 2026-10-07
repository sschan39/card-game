# Milestone 1.4–1.6: Rules checkpoint, passes and live phase stepping

Approved scope: finish slices 1.4–1.6 together and commit at completion. Keep the existing branch, lean debug commands and centralized config. Targeting/choice UI and broad ID migration remain separate.

## Rules completion

Extract a small rules-checkpoint coordinator. Applied events still discover triggers against their captured before/after context. Discovered stack mutations wait in the collector. After a complete action/resolution/step batch, repeatedly apply simultaneous state-based actions until stable, then schedule queued work, repeating if that work changes the rules state. Terminal state discards pending work. Priority is granted after settling.

`GameEngine.hasPendingRulesWork` covers queued work and an active checkpoint. Player commands, passes, debug resolution and phase advancement cannot interleave with it. No player-facing choice exists yet; this is the boundary for a later choice consumer, without introducing an unused choice framework.

## Passes and resolution

Successful intervening card/mana/declaration actions clear `lastPassedPlayerId`; failed actions preserve it. Phase movement and resolution also clear passes. The StateMachine returns an explicit pass continuation (`none`, `resolve`, `advance`). The engine applies the pass mutations, then executes that continuation from current state.

Normal two-pass resolution and debug resolution use `resolveTopOfStack()` and one completion path: checkpoint, reset passes, return active-player priority in the same phase, unless the game ended. Debug tools retain their existing bypass scope.

## Phase progression

StateMachine plans exactly one phase step from live state. GameEngine applies that step, settles the checkpoint and recomputes the next step. Stop at required input, a nonempty stack, pending rules work or game end. Turn switching precedes untapping the new active player's cards within one planned step.

Declaration actions normally retain today's automatic advance. If a declaration produces a trigger, remain in that phase for responses; two small completion flags prevent duplicate declarations until advancement resumes. Reset flags at the beginning/end of combat. Damage planning reads live battlefield cards, excludes departed participants and accumulates simultaneous assignments without stale life/damage totals.

## Validation

Regressions cover SBA-before-trigger placement, repeated SBA deaths with captured watchers, reentrant command rejection, terminal queue disposal, pass→instant→pass response windows, failed-action pass preservation, ordinary/debug resolution parity, trigger-paused automatic steps, live next-step recomputation, declaration interruption/duplicate rejection, departed combatants and accumulated damage. Keep JSONL/delta parity and live server routing working. Run all tests, both typechecks/build, independent review, then commit.
