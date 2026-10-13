# Player actions and debug controls

Known IDs live in `src/types/action.ids.ts`: `ACTION_IDS`, `ActionId`,
`ActionIdOrAbility` and `ACTION_ID_LABELS`. Registry keys remain open strings
so card behavior can be extended.

## Routing

All socket player actions call
`GameEngine.executePlayerAction(playerId, actionId, data)`. The server parses
the existing flat packet and derives the actor from the socket binding.
Action payload fields are retained, so new handlers do not require a server
whitelist change.

The engine checks the actor's room slot/record, terminal state, payload shape,
command status, input readiness and debug mode before execution.
`src/engine/player-commands.ts` contains the small orchestration table;
ordinary card actions use `ActionRegistry`. Card, cost, target, phase and
priority legality stays in the existing handlers. Rejections retain
`ActionResult` and the socket error shape `{ message: string }`.
Selected targets are concrete pointers; expansion comes from card definitions.
The player boundary generates stack identities rather than accepting a supplied
`stackUuid`. Lower-level methods retain fixture UUID injection for debugging.

| Action ID | Producer | Execution |
|---|---|---|
| `cast_spell` | Hand cards / OptionService | Card registry: playCardHandler |
| `play_land` | Effective Land hand cards / OptionService | Card registry: playLandHandler; exact hand zoneRevision, direct movement and accepted-play count, no stack |
| `activate_ability` | OptionService | Card registry: activateAbilityHandler; selected blueprint ability ID |
| `tapForMana` | OptionService | Card registry: tapForManaHandler; no stack object |
| `enter_battle` | PhaseBar | Validate main phase/active actor/priority/empty stack, then advance |
| `declare_attackers` | PhaseBar | Validate/propose with declareAttackersHandler, then advance |
| `declare_blockers` | PhaseBar | Validate/propose with declareBlockersHandler, then advance |
| `pass_priority` | PhaseBar | Engine priority pipeline |
| `resolve_stack` | DebugControls | Debug resolution through the normal effect/mutation pipeline |
| `end_turn` | DebugControls | Debug skip-to-end through the normal phase/mutation pipeline |
| `rpsPlay` | RPS cards | Validate/propose/apply with rpsPlayHandler; server finishes deck setup |

Lower-level engine methods remain available to rules code and tests. Socket
routes use the single command boundary. Registered orchestration handlers are
retained for compatibility with the lower-level action API.

Physical card moves now use the centralized zone-transition helper. Casting
uses one MOVE_CARD carrying its destination spell; this removes the hand card
and inserts the reset stack source atomically. Card UUID and blueprint remain
stable. Active damage/counters/tap/attack/attachment state resets on actual
zone changes; creature battlefield entry starts with summoning sickness.
Departure event payloads retain a snapshot of pre-reset state and calculated
power/toughness. SET_CARD_ZONE was removed because a flag-only change could
disagree with the zone array. Targeting semantics remain a separate review.

## Central configuration

Ordinary land play uses `gameConfig.setup.landPlaysPerTurn` (default one), snapshotted for each room. The default development deck deals repeatable useful hands; `shuffleDevelopmentDeck` can re-enable shuffle. Both settings live in `src/config.ts`. Land plays require the active player's main phase, priority and empty stack. `TurnHistory.landPlays` records accepted special actions and resets on actual turn advancement; generic entries do not consume allowance. An accepted play whose movement is replaced still counts once.

Set `gameConfig.debugMode` in `src/config.ts` and restart/rebuild the server:

| Mode | Debug controls |
|---|---|
| `off` | None |
| `stack` | Resolve Stack |
| `flow` (prototype default) | Resolve Stack and End Turn |

New rooms copy the setting into their snapshots. Legacy rooms without a value
use the same central default. DebugControls reads that room value; it shows
Resolve Stack when the stack is nonempty and End Turn when empty. Busy and
terminal rooms show neither.

Either existing room player can use an enabled debug control regardless of
turn or priority. Resolution still settles effects, triggers and state-based
actions. End Turn completes the current active turn and refuses a nonempty
stack. Terminal guards remain in force. These tools are explicit development
shortcuts; a normal player-facing end-turn shortcut is a later milestone.

## Adding behavior

For a new card action, register its handler in ActionRegistry; its flexible
payload passes through unchanged. Non-mana abilities use `activate_ability`
with `cardUuid` and a stable blueprint-local `abilityId`. Author unique IDs in
card data; client packets select definitions and cannot replace their costs or effects.
Pure mana abilities use `tapForMana`, avoiding duplicate options.

Casting and activation share `action-costs.ts`. Packets may provide an exact
`payment`, selected `discardUuids`, and an ordered `manaActivations` list.
Each mana activation selects its source and ability ID, plus an optional color
and payment/discard selection. The planner previews all payments and commits
only a complete valid transaction. Boolean sacrifice costs sacrifice the source;
tap and untap costs require the source on the battlefield. Loyalty costs remain
unsupported. Mana options carry stable IDs; the prior index selector remains
available for legacy callers.

For an orchestration command, add its shared ID and one descriptor in
`player-commands.ts` containing its input validator, required status, optional
debug capability and execution function. Add a producer and behavioral tests.
The socket route does not change.

Run `npm test`, both `npm run typecheck:server` and
`npm run typecheck:client`, and `npm run build` after action-routing changes.
The command, packet, debug rendering and actual Socket.IO tests cover this
boundary without a new server factory.
