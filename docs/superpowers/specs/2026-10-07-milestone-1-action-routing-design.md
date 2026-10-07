# Milestone 1.1 — Action routing and lean debug modes

Status: approved for implementation, including the owner's centralized-config amendment.
Date: 7 October 2026. Inspected baseline: `5ce87b8`, branch `codex/milestone-0`.

## Purpose and priorities

Make command routing easy to understand and extend. The owner prioritizes structural cleanliness and ease of adding behavior over rights management or private-data control. Keep `resolve_stack` and `end_turn` as explicit debug tools. Validate enough to prevent crashes and impossible engine operations; do not introduce an authentication/authorization subsystem.

This supersedes the earlier proposal to disable both commands and impose a layered rights policy. Raw debug snapshots remain available as agreed in Milestone 0.

## Sequential Milestone 1 scope

Design and implement one slice at a time. Each slice supplies a working boundary and acceptance evidence before the next receives its detailed implementation plan.

| Slice | Scope | Where and when its checks run | Completion evidence |
|---|---|---|---|
| 1.1 Command routing and debug modes — current proposal | One command entry point, small descriptor table, safe inputs, explicit stack/flow debug controls | Packet shape before dispatch; room/player/state prerequisites before command execution; card/target/cost legality in handlers before proposing changes | Every current route works through the same entry point; debug mode matrix and malformed-input tests; ordinary casts/passes/combat and debug commands through real sockets |
| 1.2 Zone transitions and resets — narrowed by owner review | Persistent card UUID; centralized movement/reset rules; departure information; consistent deltas | Validate both zones before source removal; reset during successful movement; capture departure state and P/T before reset | Moves conserve physical cards; stale active state resets; departure triggers retain information; client/reconnect state agrees. Targeting, generation semantics and new zones deferred |
| 1.3 Applied event batches | Typed events derived from actual mutations, with before/after references and shared batch identity | Capture before a mutation batch, derive after applied changes; stop speculative phase code from publishing events | Event payloads describe actual changes; simultaneous changes preserve the common before-state; failed commands emit no committed events |
| 1.4 Rules checkpoint | Settle SBAs, discover/schedule triggers, repeat as needed, then give priority; explicit pending work/choice boundary | After one complete action, stack resolution, or turn-based event batch; repeat until stable or waiting for a required choice | Simultaneous deaths preserve relevant watchers; triggers follow SBAs; pending work prevents unrelated actions; terminal state stops the checkpoint |
| 1.5 Pass history and priority progression | Reset consecutive passes after intervening actions; two-pass resolution through the checkpoint; debug resolution uses the same completion path | Reset after a successful intervening action; inspect passes when a player passes; grant priority only after the checkpoint | p1 pass → p2 instant → p2 pass gives p1 a response window; ordinary and debug resolution converge on consistent state |
| 1.6 Authoritative phase stepping | Advance one live step, settle its events/checkpoint, recompute before another automatic step | Before each step using current state; stop for priority, declarations, choices or game end | Trigger/removal/choice during a step changes subsequent progression correctly; no later step is planned from stale state |

Milestone 1.4 defines ownership checks for pending choices because that state does not exist yet. Milestone 2 implements a player-facing end-turn shortcut that respects opponent responses. The debug `end_turn` command is explicitly a convenience override.

## Chosen structure

Recommended: retain the pure action handlers and existing `ActionRegistry` for card behavior. Introduce a small `player-commands.ts` descriptor table for orchestration commands, consumed by one `GameEngine.executePlayerAction(playerId, actionId, data)` entry point. A command descriptor declares its shape validator, applicable status, optional debug capability and execution callback. This is a table of functions, without a new service class, plugin framework or policy language.

Card actions fall through to the existing action pipeline. Existing lower-level engine methods remain useful for rules execution and tests; they are internal primitives rather than additional socket routes. Their terminal guards remain in place. Server wiring parses the envelope, gets the engine, delegates once, saves the resulting room and broadcasts returned mutations. The RPS setup hook remains an explicit setup responsibility in `server.ts` in this slice; move or redesign setup only when its own consumer requires it.

Rejected alternatives: server-only guards leave orchestration duplicated between socket paths and engine consumers; a declarative permissions framework creates a second system to maintain before it has a consumer.

## Debug mode proposal

```ts
type DebugMode = 'off' | 'stack' | 'flow';
// off: ordinary commands only
// stack: ordinary commands + resolve_stack
// flow: ordinary commands + resolve_stack + end_turn
```

Configure one typed mode in the centralized `src/config.ts` file (`gameConfig.debugMode`), copy it into each created room, and include it in snapshots so the UI can display the same available tools. Use `flow` as the current prototype default, preserving existing debugging access. Existing in-memory rooms with no field use that same default. Invalid settings fail TypeScript checking. No environment override, live toggle, new endpoint, persistent settings, user roles or credentials in this slice.

| Debug command | Mode | Allowed bypass | Preconditions retained | Completion behavior |
|---|---|---|---|---|
| `resolve_stack` | `stack`, `flow` | Either existing room player can resolve without obtaining two passes or holding priority | Room is playing, not terminal; stack nonempty; command boundary is ready for player input | Resolve one object through the existing engine pipeline; preserve triggers/SBAs; return priority using the existing completion rule, subject to terminal guards |
| `end_turn` | `flow` | Either existing room player can skip response windows and complete the current active player's turn | Room is playing, not terminal; stack empty; command boundary is ready for player input | Use the existing `skipToEnd` path; keep zone changes, cleanup and terminal guards; do not discard unresolved stack objects |

Debug mode does not disable costs/targets on ordinary card actions. It does not bypass the reducer, state-based actions, terminal convergence or sync. Explicit fixture editing, forced invalid states, reset/revive commands and bypass-everything modes are outside this proposal.

## Exact check placement

| Location | Timing | Responsibility |
|---|---|---|
| `server.ts` thin envelope reader | First operation when a packet arrives, before dereferencing its fields or recovering an engine | Require an object and nonempty string `roomId`/`actionId`; retain the current flat packet shape, extracting the remaining fields as action data; derive player ID from the existing socket binding; discard client-supplied identity fields |
| `player-commands.ts` command descriptor | After recognizing the command, before execution | Validate only fields consumed by that command; declare status and debug capability; unrecognized registry actions fail without throwing |
| `GameEngine.executePlayerAction` common preflight | Before generating UUIDs, running handlers or producing mutations | Require an existing player record and player slot; reject terminal state; enforce descriptor status; ordinary gameplay requires `playing` and `waiting_for_player`; RPS requires `RPS`; check debug capability for debug commands |
| Existing action handlers / `ActionValidator` | Immediately before proposal | Card zone/control, target existence and legality, cost, speed, turn and priority requirements appropriate to the actual action |
| Special orchestration command validators | Immediately before phase/pass operations | Enter battle: main phase, active player, priority, empty stack. Attack/block: existing designated actor/phase requirements. Passing: actual priority holder. Debug commands: the retained preconditions above |
| `OptionService.getOptions` | Before looking up `room.players[playerId].hand` | Safe fields and existing player; return no options for missing card/player or ended game; reuse ordinary card legality rather than create a second rights model |
| Reducer/engine mutation application | During execution, after accepted commands | Preserve Milestone 0 terminal immutability and convergence; never trust UI gating as a substitute |

The descriptor's shape validation handles arrays before a handler maps or iterates them: attackers are `{ cardUuid: string }[]`; blocker assignments are `{ attackerUuid: string, blockerUuids: string[] }[]`; targets use supported TargetPointer discriminants and the required identifier for each. Cardinality, duplicates, costs and current target legality remain handler rules. Strip transport fields but retain action payload fields so extensions do not require a server whitelist update. No validation dependency is required.

Errors retain the existing `{ message: string }` socket shape and existing ActionResult failure structure. Add codes only when a caller needs to branch on them; this slice has no such consumer. Rejected requests produce no state changes, deltas or committed engine events. `getOptions` retains its empty-list behavior and invokes only a callback confirmed to be a function.

## UI and extension path

Keep normal combat and pass controls in PhaseBar. Add a small DebugControls section that receives the room mode and shows the supported debug tools, labelled as debug actions. Show resolve when the stack is nonempty; show end-turn when it is empty. Both remain absent after game end. Visibility follows mode/state, without a separate client permission framework. Preserve action IDs so existing logs and packets remain understandable.

Adding an orchestration command means adding its ID and one descriptor containing validator, mode requirement and execution callback; add its UI control and a behavioral test if needed. Adding card behavior continues through ActionRegistry/blueprints. Socket wiring stays unchanged. A future checkpoint replaces the command completion internals without changing the socket envelope or inventing another router.

## First-slice file boundary

Create `src/config.ts`, `src/engine/player-commands.ts`, `src/types/debug-mode.types.ts`, `src/server/action-packet.ts` and `src/client/components/DebugControls.tsx`. Modify `src/engine/game-engine.ts`, `src/server.ts`, `src/types/game.room.types.ts`, `src/engine/room-factory.ts`, `src/engine/option-service.ts` and `src/client/components/PhaseBar.tsx`. Reuse `src/types/action.ids.ts`, ActionResult and existing handlers; modify handlers only to remove obsolete special-route assumptions when needed.

Tests: new `tests/engine/player-commands.test.ts`; extend `tests/server/live-routing.test.ts` for debug modes and rejected inputs; add `tests/client/debug-controls.test.ts` for rendered visibility. Existing terminal/lifecycle tests remain coverage, adapted to explicitly choose a debug mode when they use debug commands. No server factory/injection framework or authentication rewrite.

## Acceptance and review boundary

- Mode matrix: off rejects both tools; stack accepts resolution/rejects end-turn; flow accepts both. Rejections preserve room and collector and emit no deltas.
- Debug resolution works from either existing player and settles effects/deaths/triggers normally. A lethal result cannot regain priority or accept a later debug command.
- Debug end-turn acts on the current active turn, accepts either existing player, and rejects a nonempty stack. It retains cleanup and terminal checks.
- Malformed envelope/action arrays, unknown action, missing player and invalid options requests return predictable failures/empty options without an exception.
- Normal RPS, cast, mana, pass, attack and block still use their existing legality rules through the single command entry point.
- Real sockets and the real client delta reducer observe the same public result, including after reconnect.
- UI debug availability matches the room mode and terminal state.
- Before implementation completion: focused tests, full suite, both typechecks and production build, using the supported Node runtime. Do not run these gates for a documentation-only planning change.

The owner approved this first slice with the centralized-config amendment. Later slices receive separate design review and plans in order; this document fixes their scope/checkpoint boundaries, not their full types or algorithms.
