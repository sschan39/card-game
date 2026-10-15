# Player turn controls

15 October 2026. The owner approved starting the consumer refinement sequence. Implement one slice at a time in the existing checkout.

## Sequence

1. Simplify ordinary turn controls and decision prompts (this slice).
2. Consistent card frame and enlarged details, including marked damage/status.
3. Clear target, attacker and blocker presentation.
4. Small animations driven by accepted server changes.
5. Drag-and-drop alongside clicks where it saves effort.
6. Consider optional passing shortcuts after response windows are clear.

## First slice: scope and implementation plan

One prominent phase action at a time. Empty attacker/blocker selection submits through “No attacks”/“No blocks”; selected declarations use their existing confirmation buttons. Clear Selection remains a secondary edit action. Precombat main has one “Go to combat” button instead of a duplicate enter-battle/pass pair. Other response windows have “Pass”; other empty-stack windows have “Continue”. A nearby sentence explains the decision and that the opponent can respond. Both players still pass normally.

Use existing commands and room state directly in `src/client/components/PhaseBar.tsx`; no client rules engine, action registry, auto-pass setting or new server behavior. Hide phase actions during local targeting, pending choices, resolution and game over. Choice prompts take precedence over transient engine-state text. Put existing debug controls inside native, initially closed `details` in `DebugControls.tsx`. Add wrapping/primary-secondary styles in `src/client/style.css`.

- [x] Add failing coverage in `tests/client/debug-controls.test.ts` for one main control, no duplicate zero-block control, closed debug disclosure, waiting/choice/targeting gates, and unchanged command selection.
- [x] Change the two existing components and styles without moving combat draft ownership or changing packets. Keep nonempty declaration packet and draft-preservation regressions in `tests/client/combat-flow.test.ts`.
- [x] Run all client tests and client type/build checks. Inspect ordinary play in two browser sessions: initial phase, one-sided pass, stack response, declaration, manual choice and next turn. Verify debug controls are hidden until expanded.
- [x] Record the result here. Commit/push only on the owner's request.

This slice reduces duplicate/competing controls. It does not reduce the number of required priority passes. Card art, details, drag/drop, animation queues, automatic passing and engine rules changes are outside this slice.

## Verification record

89 client tests passed in 12 files. Client type check, server TypeScript build, production client build and diff whitespace check passed. Read-only review found no remaining blocker; an initial priority-prompt concern was withdrawn after checking the actual branch order and the explicit regression test.

Two independent browser sessions used the existing trigger deck on a separate local server at port 3002, room `66d8b41d-1988-4180-b864-51025e829b47`. RPS → ordinary upkeep/draw/main → land/mana/cast → stack/entry response windows → empty attack → postcombat/end → opponent turn worked without debug actions. Each state exposed one primary phase action; after one player passed, that player saw a waiting prompt and no primary action while the opponent could respond. Debug buttons were invisible until the native disclosure was expanded, and hidden again when closed.

On the next active turn, starting a targeted ability removed phase/debug actions; cancel restored the main action. A selected attacker opened its trigger target choice: its owner saw “Choose below to continue”, the opponent saw “Waiting for opponent’s choice”, and neither saw a phase action. After target resolution the defender saw one “No blocks” action. Confirming it led to the manual damage choice, again with zero phase actions. Confirming three damage completed combat, reduced opponent life to 18 (one attack-trigger life loss plus three combat damage), and restored Continue. Visual inspection at 1280×720 showed the primary action, hint and collapsed debug section fitting the narrow left panel.
