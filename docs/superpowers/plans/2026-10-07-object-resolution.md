# Whole-object resolution implementation plan

**Goal:** Fulfil Milestone 3.4 by checking all chosen targets before structural movement or any effect.

- [x] Add regressions for all targets becoming illegal while an untargeted effect also exists; partially legal groups; optional zero-target casts; a targeted permanent spell failing into its owner's graveyard; and legality checked once before sequential effects.
- [x] Add `planStackResolution(room, stackObject)` returning mutations and a resolution report. Freeze legal explicit target groups at resolution entry. Total chosen targets greater than zero with zero legal survivors means the whole object fails. Countered objects also execute no effects.
- [x] Keep resolving spell objects on the stack through effect execution; append structural movement after effects. Failed permanent spells go to the graveyard. Activated/triggered objects remove only their own stack entry.
- [x] Nontargeted selections expand against each effect's current state. Explicit targets retain entry legality; zone identity still prevents later instructions affecting a departed-and-returned card. Report object failure separately from partially unavailable primitive targets.
- [x] Use the plan from ActionService and preserve the existing resolver wrapper for rules callers. Verify canonical events and metadata after application, then review and commit.

Rules reference: [official Comprehensive Rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf), sections 608.2b, 608.2n and 608.3.
