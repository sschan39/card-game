# Card testing and UI verification

All 161 card and token definitions passed strict rules coverage. The project also passed its automated regression suite, including client rendering checks and Test Room integration. Full browser sign-off requires recorded evidence of what players can see and do for each card.

## What passed

| Check | Result | What a pass establishes |
| --- | --- | --- |
| Strict card rules | 161 definitions, 614 checks | Every definition loaded in an isolated game. At least one passing authored case covers each behavior category required by the runner. |
| Full regression | 4,266 tests in 263 files | Engine, server, and client automated checks passed with local connections enabled. |
| Focused Test Room verification | 554 tests in 8 files | Includes recipe import and ordinary game commands from both controlled seats. |

These results are from the completed card-coverage run. The totals overlap. The saved report is local to this workspace and can be regenerated.

## How to audit card coverage

```sh
npm run test:cards -- --strict --report outputs/card-tests.json
npm run test:cards -- --strict --card fireball
```

For each active card ID, check for `status: "passed"` and an empty `missing` list. The report includes case names, the behavior categories each case covers, and each case result. The 614 checks comprise 161 setup checks, 292 authored behavior cases, and 161 strict coverage checks.

The runner loads the actual definition by stable ID and prepares a fresh room for each case. Cases assert explicit outcomes such as life changes, counter amounts, zone movement, valid targets, and payment. Some prepare engine events directly to isolate a trigger. Strict mode checks coverage for play or token lifecycle, each declared ability and mode, and tracked costs, numeric choices, and effects. It takes additional scenarios to verify interactions across cards or behavior outside that checklist. [Runner](../tests/library/per-card.test.ts) · [Fireball cases](../tests/card-cases/fireball.ts)

In an isolated copy, changing Fireball damage from five to six failed its own checks while Frozen Snowball passed. Removing Red Wolf reported the removal and identified four Andu Gittes cases that require it. Moving a definition preserved its stable ID. The [catalog workflow](per-card-testing.md) documents adding, moving, and retiring cards.

## How to verify what players see

| Evidence | Check |
| --- | --- |
| Rules case | Confirm the cost, timing, choices, and outcome in the engine. |
| Server view | Verify each seat receives the right actions, prompts, and public state. Check that hidden information stays private. |
| Client rendering | Verify the UI displays counters, target eligibility, attachments, choices, and other fields. |
| Browser play | Use the real controls, confirm the outcome from each affected seat, and record the result. Check placement, readability, and input as well as the final state. |

Test Rooms and ordinary matches both use the shared match screen. Use a Test Room to stage a reproducible position, then use normal game controls to exercise it. Check ordinary match navigation and independent-session reconnect separately. [Test Room integration](../tests/server/scenarios.test.ts) · [Server view](../tests/server/player-projection.test.ts) · [Board rendering](../tests/client/board-render.test.ts) · [Choice rendering](../tests/client/pending-choices.test.ts)

### Fireball in the Test Room

```sh
npm run test:cards -- --strict --card fireball --recipe outputs/fireball-ui.json --with frozen-snowball@b:battlefield
```

1. In the Codex browser, start a fresh Test Room. Under **Edit board → Board edits as JSON**, paste the recipe, select **Apply recipe**, then **Resume play**. Leave **Reveal both hands** off.
2. From Seat A’s main phase, cast the main-phase mode on Seat B’s Frozen Snowball. Pass priority from both seats as needed. Confirm two Scorch counters on the creature, Seat B at 20 life, and an empty stack after resolution.
3. Restore the starting board. In the editor, make Seat B active and give Seat A priority. Resume, cast the instant mode at Seat B, and verify a two-red cost, the change from 20 to 15 life, and Fireball in Seat A’s graveyard.
4. Restore the starting position with Seat B active again. Check that Seat A cannot complete the main-phase mode and that its mana, hand, and stack stay unchanged.

### Browser evidence to keep

Record the build or commit, card ID and behavior, rules case, room recipe or checkpoint, seat, viewport, actions, expected and observed UI, result, and screenshot or trace. Record rules and browser results independently.

- Use real pointer or keyboard input. Check that the legal action is discoverable, clickable, and unobstructed.
- Verify both seats’ views for private prompts and public outcomes. For motion, check that a transition finishes at the right card or zone and that an opponent draw never exposes a card face.
- Repeat affected interactions with a crowded board or hand. Check combat with and without blocks, targeting, reveal and search, equipment, and reconnect where they apply.
- Start automated browser coverage with these shared flows. Claim full card-by-card browser coverage only when each card’s player-visible behavior has a recorded passing result, including its card-specific differences.
