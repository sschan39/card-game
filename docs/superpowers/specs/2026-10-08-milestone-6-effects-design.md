# Milestone 6: continuous effects and permissions

Implement the complete Milestone 6 scope from the implementation roadmap, as an engine system. Preserve UUID/revision identity, room-owned state, debug visibility, manual combat choices and existing catalog data. Work in the existing checkout and branch per the owner's preference. No new card mechanics or client components.

## Design

Use one pure characteristic evaluator shared by server and client. Begin with blueprint characteristics, evaluate copying, control, text, type, color, abilities, then P/T (defining, setting, modifying/counters, switching). Effects use timestamps and same-layer dependencies; dependency cycles fall back to timestamp order. Expose effective types, subtypes, colors, keywords, abilities, controller and P/T. Never mutate blueprint data.

Model resolved effects independently from static abilities. Resolved characteristic effects capture affected object references and controller at creation. Their lifetime is independent of source presence unless explicitly declared dependent. Static abilities generate active entries from sources in their declared zones; scopes match dynamically and lost abilities stop supplying later-layer effects. Source and target revisions prevent old effects applying after re-entry. Every committed effect has an ID and timestamp; individual removal uses its ID.

Support serializable characteristic-defining numeric expressions, copying of copiable blueprint values, text substitutions, set/add/remove type and color changes, ability/keyword addition/removal, counters and switching. Static sources use effective control. Keep permissions separate from the characteristic fold: shared target protection/shroud/hexproof and shared cast/activation prohibitions and timing grants. Restrictions win over grants. Apply permissions at announcement and target revalidation; a prohibition on casting does not counter an already cast object.

Route existing engine and client legality/display consumers through the same facade. Preserve effective last-known source characteristics for departed abilities/events. Add generic effect primitives and deliberately declared static zones; no catalog additions.

## Verification

Test independent lifetime, frozen versus dynamic recipients, source/target re-entry, ID-specific removal/expiry, every layer, defining expressions, timestamp conflicts, dependency chains/cycles, static ability loss/gain and control, shared permissions, combat/activation/target resolution and client queries. Add actual-server protocol evidence for changed characteristics and permissions. Run complete tests, both typechecks and production build. Finish with a requirement-by-requirement report and a local commit.
