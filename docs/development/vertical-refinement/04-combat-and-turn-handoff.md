# V4 — Combat and turn handoff

Status: proposed; follows V3. Baseline `8798da1`, 13 October 2026. [Vertical plan](README.md). Existing owners: [ordinary turns](../2.1-ordinary-turns.md), [combat participants](../5.2-combat-participants.md), [manual damage](../5.3-manual-damage-allocation.md).

## Scope and transcript

Use current creatures and mana from ordinary play. Reach combat by passing, select/confirm attackers, let the defender select/confirm blocks or no blocks, complete existing manual damage choices, and pass through postcombat/end/cleanup to the next player's untap/draw/main phase. Make the next required action obvious. No new combat keyword, attack destination, auto-allocation, shortcut system or full cleanup-rules expansion.

## Boundaries

| Module | Responsibility |
|---|---|
| PhaseBar | Show phase, active player/priority or declaration owner and normal declaration/pass controls |
| CardComponent / CombatDisplay | Existing selection/pairing and participant highlights; explain ineligible choices encountered in this transcript |
| gameStore / combatSelection | Keep local drafts coherent with incoming state; preserve a rejected draft until the player repairs/cancels it |
| ChoicePanel | Existing manual allocation/waiting states and visible validation feedback |
| Existing declaration handlers/combat-service/state-machine | Authoritative declarations, damage settlement and turn handoff |

```text
Ordinary priority passes → attacker declaration → response passes
  → blocker declaration → response passes → manual allocation if needed
  → committed damage/SBAs → both screens reconcile
  → postcombat/end passes → cleanup → next player's untap/draw/main
```

The source currently clears attacker/blocker selections immediately after sending. Inspect that interaction in-browser; if rejection loses the draft, clear it on the existing authoritative declaration flags/phase transition instead. Do not add a pending-command/retry state machine just to retain selection. On committed board changes, reuse existing reconciliation.

## Implementation/acceptance checkpoint

First demonstrate one attacker/one blocker and one unblocked attack using normal turns, with summoning sickness respected. Exercise the current multi-blocker manual allocation only after the basic flow is readable; do not add keywords to make the fixture interesting. Configure existing creature quantities centrally when a repeatable development match needs them.

Expected files are PhaseBar/CardComponent/CombatDisplay/ChoicePanel, gameStore/combatSelection and focused tests. Change backend combat/phase logic only when the normal transcript exposes a reproduced mismatch. Existing backend damage/turn contracts are not new work.

Extend `tests/client/combatSelection.test.ts`, `tests/client/gameStore.test.ts`, `tests/engine/ordinary-turn.test.ts` or `tests/engine/combat-choices.test.ts` only for demonstrated changes, plus the relevant actual-server transcript. Logs should identify declaration owner, selected participants, allocation choice and resulting phase/priority without dumping the whole battlefield.

Browser acceptance: both screens show the same declarations, damage and survivors; one rejected declaration is visibly recoverable; the next player reaches ordinary main phase and can play a land again. Reload at a committed checkpoint restores the same board/phase. No debug advance/resolve is used to complete the transcript.

## Stop boundary

Stop before overriding server results locally, auto-submitting allocation, skipping response windows, expanding family/keyword rules or treating debug end-turn as a completed ordinary handoff.
