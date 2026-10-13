# V4 — Combat and turn handoff

Status: implemented and verified. Implementation baseline `e603a19`, 13 October 2026. [Vertical plan](README.md), [execution record](04-combat-and-turn-handoff-plan.md). Existing owners: [ordinary turns](../2.1-ordinary-turns.md), [combat participants](../5.2-combat-participants.md), [manual damage](../5.3-manual-damage-allocation.md).

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

The baseline silently ignored an ineligible creature click and cleared declaration drafts immediately after sending. V4 allows own creatures to be selected as candidates during the existing declaration window, retaining tap/sickness indicators. Confirmation uses existing engine validation. Rejection keeps the draft editable; clicking a candidate again or Clear Selection repairs it. An accepted declaration or phase transition clears the draft using existing flags/reconciliation. A full snapshot clears unsent local drafts while retaining committed `room.combat`. No pending-command/retry state machine was added.

## Implementation/acceptance checkpoint

The completed transcript uses one attacker/one blocker, an unblocked attack, then a multi-blocker split, with summoning sickness respected. `src/config.ts` now supplies deterministic twelve-card development decks and five-card opening hands: basic spell, two existing creatures and two lands, followed by the existing choice consumers and later creatures. Custom room settings and card definitions are unchanged.

PhaseBar supplies short instructions and explicit local clear; CombatDisplay uses normal pairing buttons, including repeating a pair to remove it. Duplicate blocker candidates remain an editable draft: the existing engine rejects committing one blocker against two attackers, after which the extra pair can be removed. No second client rules system was added.

`battlefieldCardLabel` numbers identical effective names across the entire battlefield. Cards, combat rows, pending pairs and manual allocation options use the same display labels; these may renumber after departures. UUIDs, revisions, choice IDs and recipient values remain unchanged. Damage player recipients display You/Opponent. Ordinary tapped/sick/duplicate-blocker rejection messages use the live card name.

Existing action diagnostics now include selected attacker pointers/block assignments, nonzero allocation recipient keys/amounts, declaration owner and resulting priority. The recent log summarizes accepted declarations, simultaneous damage, departures and turn handoff. The shared logger, central settings and JSONL event owners remain unchanged; see [logging contracts](../../logging.md).

The actual-server transcript exposed a repeatable untap delay beyond its existing 2.5-second command wait. Temporary timing isolated the proposal phase rather than commit work; `proposed-events.run` rebuilt its completed prefix for every primitive. The loop now carries its local preview forward through appended primitives once. Each fresh/resumed/nested run still starts from its supplied room, and simultaneous replacement matching still uses the original board. No cache service, new rules, timeout relaxation or commit change was needed.

## Two-session browser acceptance

Room `af89e9ab-1fec-4481-8621-1e1cbe3d9f4e` at localhost:3000 used ordinary controls and configured cards only:

1. A created, B joined, both chose Rock, and normal priority passes reached main. A played a land, produced red mana and cast the first 1/1 creature. At its first combat, selecting/confirming it showed the named summoning-sickness rejection while Confirm Attackers (1) and Clear Selection stayed available. A removed it, confirmed zero attackers and completed the ordinary handoff.
2. B played a land and cast a creature, then declared no attackers. On A's next turn, A played another land/cast another creature and attacked only with the ready first creature. B paired its creature through the Combat button. Both screens showed distinct attacker/blocker labels. A and B each assigned one damage manually; the battlefield remained intact after A's answer, then both combatants died together after B's answer. The new A creature survived.
3. B cast a replacement creature and passed an empty combat. A cast the next naturally drawn creature and attacked with the ready survivor. B chose No Blocks. A's manual choice displayed Opponent; assigning one damage left B at 19 life on both views.
4. B cast the next naturally drawn creature and kept both blockers untapped. A's next combat declared two ready attackers. B drafted the same blocker against both; confirmation showed the existing duplicate-assignment rejection and retained both pairs. Repeating the extra pair removed it; B then paired the second blocker to the first attacker and confirmed. The currently sick new blocker was valid for blocking under existing rules.
5. A explicitly assigned 1 to blocker #2 and 0 to blocker #4, then 1 to Opponent from the unblocked attacker. B assigned one damage from each blocker to the blocked attacker. After all four answers, that attacker and the first blocker died together; one creature per player survived and B had 18 life. The recent log explained completed combat damage and departures.
6. B reloaded at the committed damage checkpoint and restored the same phase, life and survivors, with no pending choice. Ordinary end-combat/postcombat/end/upkeep/draw passes reached B's next main. Its survivor was untapped and no longer sick; the land allowance was reset. B played another land, showing 1/1 land plays, 18 life, three library cards and five graveyard cards. No debug End Turn/resolve, board injection or private client callbacks were used.

Accepted block command `fab6ee67-be8e-46d1-8a88-c5291f44c071` matched B's send, backend receipt/acceptance/publication and both clients' applied declaration at sequence 156. Final damage answer `52c5249e-a2f1-49ee-b2d2-8b5655bdf135` logged allocationTotal=1 and committed sequence 162; A's applied summary explained the deaths/life change, and B's reload restored that committed result. The browser's duplicate-block message originally exposed an opaque UUID; the final handler uses the loaded name, covered by the actual-server regression.

## Regression and review

`tests/client/combat-flow.test.ts` covers candidate selection, sent/rejected draft retention, local clear/pair repair, accepted/phase/snapshot clearing, cross-controller labels, unchanged choice values and readable summaries. Existing reconciliation/effective-control/default-setup fixtures now explicitly match declaration windows and current development settings.

The actual-server scenario covers the same normal turns, both rejected declarations with no delta, single/unblocked/multi-block combat, no partial damage before all answers, simultaneous deaths, reconnect, cleanup/untap and the next land allowance. Its intentionally long transcript has a 30-second case budget; all existing command waits and older case timeouts are unchanged. Existing replacement/resume tests exercise the preview correction. Independent review checked append-only completion, fresh resume initialization and simultaneous matching; its snapshot/label findings were reproduced and corrected. Its final allocation-trace finding added nonzero option IDs/amounts to the same frontend/backend helper, covered by hook and actual-server assertions. The full browser transcript preceded that final diagnostic-only addition.

After loading the final built server/client, a fresh smoke match `38c81703-ca5a-4ec1-b481-7629ce625eed` used normal RPS, priority passes, land/mana, targeted spell and explicit manual payment. Payment command `16805586-73fe-4afd-bc54-d062e0fc1752` logged the same nonzero red:1 allocation in frontend/backend, with resulting priority in the accepted engine diagnostic. Ordinary passes resolved the spell; both views showed the defender at 17 life with no pending choice or stack. This confirms the final shared allocation diagnostic also runs in the built application; the full combat transcript above remains its gameplay acceptance record.

Final gates: 1065 tests in 81 files passed, including 42 actual-server scenarios. Both typechecks and the production build passed. Final independent review found no remaining critical or important issues. All 235 local links in development/logging documents and the diff check passed.

## Stop boundary

Stop before overriding server results locally, auto-submitting allocation, skipping response windows, expanding family/keyword rules or treating debug end-turn as a completed ordinary handoff.
