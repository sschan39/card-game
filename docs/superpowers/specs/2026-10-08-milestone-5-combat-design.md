# Milestone 5: combat engine

Implement the combat design presented in chat. Engine only; no new named-card behavior, keyword mechanics, allocation heuristic, or configuration flags. Keep existing Flying and Trample behavior behind extension hooks.

## State and identity

Retain declaration card snapshots for debugging and the existing display contract. Capture them by value. A snapshot's UUID, battlefield zone revision, and controller identify a combat participant. Reconcile combat after each committed battlefield change; leaving, changing controller, or ceasing to be a creature removes participation permanently. Explicit blocked status survives removal of all blockers. Legacy declarations infer blocked status from their initial blocker array.

Keep participants through the end-combat response window; clear combat when entering postcombat main or using the existing flow debug skip.

## Decisions and execution

After the post-blocker response window, enter combat damage and reconcile live participants. Query current characteristics. Persist a damage plan and collect allocations with the existing distribution choice protocol, including controller ownership, stable choice IDs, source references, and continuation state. Every positive source with eligible recipients requires its controller's allocation; there is no automatic split. Zero/negative power and blocked creatures with no recipients assign nothing. Validate complete power assignment, recipient identity, nonnegative safe integers, and extension constraints. Ordinary multi-block damage allows arbitrary splits and overassignment. Existing Trample permits the player recipient, with lethal assignment to all surviving blockers before spillover.

Commit the complete damage batch atomically, preserving each source's pre-damage snapshot, controller, recipient, amount, and combat flag. Only then derive events, settle state-based actions, schedule triggers, and grant priority. Assignment and application have no response window between them. Pending damage choices and partial allocations survive JSON serialization and engine reconstruction. Damage is a turn-based action, never a stack object.

## Extension seams

A small combat rule registry exposes whole-declaration legality, declaration consequences, damage-pass planning/participation, recipient selection, lethal thresholds, and allocation validation. Default pass is normal; registered engine rules may add passes with priority windows between them. No first/double strike consumer is included. Characteristic queries expose keywords through one facade. Shared damage processing exposes proposal transformation and consequence hooks; no prevention, lifelink, deathtouch, or other new consumer is included.

Spell/ability damage uses the same damage pipeline as combat. Life loss remains distinct. The reducer owns state writes; hook functions return data/proposals and do not own checkpoints or priority.

## Verification

Prove blink/controller-change removal, persistent blocked status, live power, declaration legality, manual arbitrary splits, overassignment, Trample validation, cumulative damage, simultaneous deaths and trigger observation, nonpositive damage, stale/wrong-controller choices, serialized resume, synthetic extension hooks, response windows between generic damage passes, and real server choice/delta/event flow. Run the full existing suite, both typechecks, production build, and diff checks. Update the roadmap and completion report from actual evidence.
