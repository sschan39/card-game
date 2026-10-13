# V3 implementation plan

Implementation baseline `6771c32`, current checkout/branch. Owner selected the next slice. Scope: [existing choices as a playable consumer](03-playable-choice-consumer.md). Execute inline and commit locally after verification.

The existing parser preserves declared generic expressions, cost routes and mandatory extras. Existing server announcements already run number → route → targets → discard → payment. Consume those contracts rather than adding another workflow.

- [x] Add a loaded JSON `choice-practice` definition: X=0–4; base X generic mana, alternative two life, mandatory one red mana and one discard; target opponent; MODIFY_LIFE by -X. Configure two copies as the first two development draws while preserving the basic four-card opening hand and nine-card deck size.
- [x] Extend loaded-definition tests in `tests/engine/cost-routes.test.ts` for base X=0/positive and alternative positive X, cancelled unpaid announcement, retained binding/route across JSON reconstruction, invalid answer keeping the prompt and atomic final payment. Extend room-factory tests for the demonstration draws.
- [x] Reuse a small shared `describeActionCost` formatter in OptionService and complete route-choice labels. Materialize the chosen X before formatting route totals. Keep mandatory extras visible on both routes. No parser/rule changes unless these tests reproduce a loss.
- [x] Expose Choose mana payment in the existing context menu and local target confirmation; carry only the existing `choosePayment` flag. Keep automatic payment as the default. Show the numeric range, selected X/card and required payment clearly through ChoicePanel. Player target labels use You/Opponent; exact pointers/IDs remain unchanged.
- [x] Add compact number/selected-count/allocation-total diagnostics to the existing action sender and range/required-total diagnostics to existing engine/client choice logs. Preserve the central actions/detailed-events switches.
- [x] Add client tests for payment flag propagation, range/cost readability and logs; add an actual-server scenario using the loaded definition and configured first draw, including cancellation, invalid answer and reconnect while unpaid. Use ordinary passes for resolution.
- [x] Run focused/full tests, both typechecks, production build and independent read-only review. In two browser sessions complete both routes, cancel once, reload during payment and verify matching committed state. Use normal controls only.
- [x] Record actual evidence and current contracts in the V3/index/logging docs, check links/diff and commit the slice. Leave V4 separate.
