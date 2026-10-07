# Milestone 2.1 — Ordinary turn structure

Approved by owner after the current/proposed comparison: explicit upkeep and postcombat main, ordinary response windows, zero attackers. Retain persistent card IDs, checkpoint architecture, lean debug tools and centralized settings. No new setting is needed.

Sequence: untap (existing stateTurnStart), upkeepStep, draw, precombat main (existing stateMainPhase), beginning combat, attackers, blockers, damage, end combat, postcombatMainPhase, end, cleanup. Only untap and ordinary cleanup automatically continue. Upkeep starts BEGIN_UPKEEP triggers separately from TURN_STARTED; end-step entry starts END_OF_TURN triggers. Both main phases permit sorcery-speed actions.

Declaration decisions and priority are separate: enter declaration steps with no priority, await the appropriate player's declaration, then give active-player priority in the same step. Completed flags gate repeats. Accept zero attackers and skip blockers/damage after both players pass, entering end combat. Other ordinary steps advance only after consecutive passes. Enter Battle becomes a pass toward combat, allowing the opponent a main-phase response.

Debug end_turn keeps skipping windows to the next precombat main, stopping on any new stack. It is separate from the future player-facing finish-turn shortcut. Drawing failure, mana lifetime/payment, lands, setup, mulligans, hand-limit choices and special combat mechanics remain deferred.

Use small shared turn helpers for main-phase timing and pending declarations, consumed by engine and client. Keep reducer/events/deltas unchanged except new typed phase-entry events. Client controls show declaration actions to their owner and hide them after completion; pass controls follow actual priority. Existing labels use Precombat Main and Postcombat Main.

Validation: full ordinary turn transcript, instant response after drawing/declarations/damage/end, blocker ownership independent of post-declaration priority, zero attackers, sorcery timing in both main phases, BEGIN_UPKEEP/END_OF_TURN events, debug skip compatibility, socket/client delta convergence. Migrate old tests whose automatic advancement expectations changed; retain checkpoint regressions. Full tests, both typechecks, build, independent review, commit.
