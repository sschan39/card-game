# Card testing and catalog changes

## Run the tests

```shell
npm run test:cards
npm run test:cards -- --strict
npm run test:cards -- --card fireball --card frozen-snowball
npm run test:cards -- --card fireball --strict
npm run test:cards -- --report outputs/card-tests.json
npm run test:cards -- --card fireball --recipe outputs/fireball-setup.json
npm run test:cards -- --card fireball --recipe outputs/fireball-combat.json --with frozen-snowball@b:battlefield
```

Every catalog card and token has a separate load and room-setup test. The report tracks those checks separately from authored behavior cases. A card is marked **missing coverage** if a declared mode, ability, play, or lifecycle check lacks a passing case. The strict option makes missing coverage fail for the selected cards. A failed behavior case fails either run. A misspelled ID fails explicitly. A removed card with retained cases is reported as **removed** and excluded from the active coverage count.

Add a file under `tests/card-cases/` named after the stable card ID, following the [Fireball example](../tests/card-cases/fireball.ts). The runner discovers it automatically. Use ordinary commands and assert observable state such as life changes, zone movement, counters, or priority. Add separate cases for required choices, illegal timing or targets, and resolution after conditions change. List any other catalog definitions a case needs in `requires` so their removal is reported against that case. Generic targets and library cards can use test fixtures with stable characteristics. A test that derives its expected result from the card under test would pass even if the card's effect were authored incorrectly.

Run the full catalog in strict mode to check for behavior coverage gaps after adding a card or ability. Existing engine and gameplay regressions still run in the normal suite. The card report only credits cases that explicitly declare coverage and pass in that run.

To try a card in the UI, export its starting board with `--recipe` and paste the JSON into **Edit board → Board edits as JSON** in a fresh Test Room. The recipe gives both seats mana and puts the test card in Seat A's hand, or puts a token on the battlefield. Repeat `--with CARD_ID@SEAT:ZONE` to add supporting cards or targets. Use `a` or `b` for the seat and `hand`, `battlefield`, `graveyard`, `exile`, `libraryTop`, or `libraryBottom` for the zone. The runner checks the recipe through the same board-edit code the room uses.

## Add, change, or retire a card

1. Add or edit one JSON definition under `apps/server/src/catalog/cards`, or a token under `tokens`. Keep the ID unchanged when renaming or moving an existing card file.
2. Run the targeted card test. The normal root test, type-check, and server build commands also regenerate the import manifests. Run `npm run cards:sync` before using raw tool entry points and after adding or removing files while a watcher is running.
3. Review and commit any generated manifest changes alongside the definitions. Use `npm run cards:check` to check for stale manifests.
4. For a published card, add its ID to `retiredCards` in [eligibility.json](../packages/protocol/src/decks/config/eligibility.json). The card disappears from deck-building search and existing decks containing it are flagged for correction before new play. Its definition stays available to Test Rooms and existing scenario references.

Delete files for unpublished cards when no definitions, deck policies, fixture presets, or saved scenarios depend on them. The generator drops missing imports automatically. Existing behavior cases can stay as a record. If a dependent definition still needs a removed token, its catalog test identifies the referring card. Keep a retired definition when those references should continue to work.
