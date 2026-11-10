# Captured card windows and configurable visibility

Status: **implemented, 4 November 2026**. This supplements [resolution-local card collections](resolution-results-architecture.md) and the [current blocker ledger](card-blockers-current.md). Examples below are accepted by the shared strict parser. This delivery adds infrastructure and UI; it does not register new workbook cards.

## The shared model

Yes: a reveal/look window is much like a mill result whose cards have not moved. Share the retained collection and query machinery; keep capture, physical movement, player decisions and information exposure separate.

| Operation | Where the real cards are | What the collection records |
|---|---|---|
| Mill | The actual destination immediately after replacement processing | Successful arrival snapshots, plus attempted-move provenance |
| Capture/look/reveal | Their existing zone, normally the library | Exact captured incarnations and observation snapshots |
| Later selection/movement | Existing movement pipeline changes the real zone | The original collection retains its historical membership; moved cards stop matching its current source-zone references |

Neither collection owns live cards or creates another physical zone. A revealed library card is still in the library. Capture does not itself discard, draw, exile or put anything into a hand. Visibility does not change ownership, control, movement destinations or selection rights.

Reuse `StackObject.resolutionResults`, its continuation ownership and the existing `from: { kind: "result", name: "window" }` query source. Generalize the result kind to include captured observations while retaining `milled` as useful provenance. Do not create a second reveal-only query engine or rename working mill behavior merely for consistency.

## Base visibility belongs to the card instance

`CardState.visibility` stores `public`, `owner` or `hidden`. Creation and every actual zone change initialize it through `createCardState`:

| Zone | Base visibility |
|---|---|
| Battlefield, graveyard, exile, spell stack | `public` |
| Hand | `owner` |
| Library | `hidden`, including to its owner |

`visibilityZone` records which zone that stored value belongs to. Older snapshots and stale imported/fixture states use the current zone's default. Real transitions reset both fields, so a revealed library card moving to hand receives owner visibility. This is a base state, not a client permission to set visibility or a complete face-down-card mechanic.

Temporary observation audiences live in `GameRoom.cardObservations`, bound to their resolving stack object and exact captured incarnation. They do not overwrite the base flag. This permits a private look, public revelation or partial exposure without creating a sticky public card or tracking a card into a later hidden zone. Server `canSeeCard` reads authoritative live membership and base visibility; observation/choice projection separately checks the temporary grant. An arbitrary nested snapshot cannot authorize access.

## An editable authored contract

Private look at the top six cards of your library:

```json
{
  "family": "cards",
  "operation": "capture_window",
  "params": {
    "zone": "library",
    "zonePlayer": "self",
    "position": "top",
    "amount": 6,
    "visibility": {
      "faces": ["controller"],
      "count": ["all_players"],
      "order": ["controller"],
      "expires": "resolution_end"
    },
    "event": "none"
  },
  "recordResult": { "name": "window", "kind": "captured" }
}
```

To publicly reveal those six instead, use `all_players` for faces/count/order and `event: "revealed"`. Public revelation and private looking share capture mechanics but have different information and trigger semantics.

These are strict data fields, not executable callbacks. Capture currently supports the top of self/opponent libraries, one to sixty-four cards, with short/empty libraries recording the actual available cards. Work bounds live in `packages/engine/src/config/observations.json`: `maxWindowCards` is 64 and `historyLimit` is 128 per viewer. Both values are validated at module load. Unsupported origins/positions, unknown fields, unsafe names, incorrect result kinds and contradictory audiences fail validation. Capture requires its named result and does not accept its own choice/target/outcome configuration; wrap optional capture in an ordinary modal or optional payment branch.

Existing authored `cards / reveal_top` recipes now lower into this shared public capture/selection/remainder path. They retain their printed behavior and completion-time reveal events; the convenience recipe also accepts the configured capture bound. The convenience recipe takes to hand and orders the remainder on the bottom by default. Set `remainder: "discard"` to discard the current captured library members as part of Reveal. This uses `cards/discard_captured` and produces ordinary discard events without a milled result. Generated result names avoid existing declarations.

## Visibility is an explicit policy

| Field | Meaning |
|---|---|
| `faces` | Who may see card names and faces in this captured observation |
| `count` | Who may count the members covered by this grant; undisclosed members never contribute to the projected count |
| `order` | Who may see their captured source order, such as top-to-bottom |
| `expires` | When this temporary observation grant stops being active |

Audience entries are a closed vocabulary: `controller`, `opponent`, `zone_owner`, `all_players`; an empty list grants nobody that information. `controller` means the resolving object's controller, not the owner of the looked-at library. Resolve roles to concrete room players when the observation is created so later control changes cannot reassign historical information. `zone_owner` needs an unambiguous player-owned source; otherwise reject the combination.

Validate policy relationships. Seeing every face necessarily reveals the set's size, so every face audience must also receive count visibility. Order visibility requires face visibility. Reject contradictory policies rather than letting array shape accidentally override them. Hidden order must use a display order unrelated to source position, without exposing source indices. Captured order is an observation at capture time, not a claim about the current library after a later reorder or shuffle.

An omitted visibility policy grants no additional information; an omitted event means `none`. The normal game-zone visibility still applies: this policy can expose an otherwise hidden library observation, but cannot turn public graveyard/battlefield cards face down. Face-down cards or concealed public-zone identities require their own actual game mechanic.

Visibility must be enforced by server projection, using one shared audience resolver for views, events and history. Hiding a React component is insufficient. An unauthorized player receives no names, definitions, UUIDs, source positions or raw result maps. Counts include only members whose count audience admits the viewer. Partial exposure can therefore publish a subset count without publishing the hidden total or any faces. With no authorized data, omit the observation entirely; do not send zero or placeholder arrays. Blind selection is not supported in this slice: captured choices require face access and unknown blind-choice fields are rejected.

The admin Test Lab's authenticated inspection policy stays separate. Being an admin in a normal player seat must not automatically widen that seat's information rights.

## Updating visibility without changing membership

A later instruction may change exposure for a captured set or filtered subset. For example, after privately looking, reveal only its creatures:

```json
{
  "family": "cards",
  "operation": "set_collection_visibility",
  "params": {
    "from": { "kind": "result", "name": "window" },
    "filter": { "cardTypes": ["Creature"] },
    "visibility": {
      "faces": ["all_players"],
      "count": ["all_players"],
      "order": [],
      "expires": "resolution_end"
    },
    "event": "revealed"
  }
}
```

The subset uses the same shared card filter, materialized into exact member references at this instruction. It does not become a continuously changing library filter. Authorize any emitted reveal event against the effective exposed audience; public `revealed` requires public faces. Merely changing visibility does not create a reveal event unless the instruction explicitly requests it. A private look never silently fires `ON_REVEAL`.

An exposure update replaces that observation's grant on the selected members; ordinary zone visibility and independent valid grants still apply. Reducing exposure stops publishing active information, but cannot make a person forget already seen cards or erase their legitimate history. The active panel displays snapshots from the last explicit observation; it does not show live hidden-zone changes. A later exposure update takes fresh snapshots for its selected current members while retaining the original capture anchors and historical observations. The grant applies to the captured observation, not a tracking right into the card's later hidden zones. When a member moves, its new incarnation follows normal destination visibility; the old observation may remain in authorized history.

Keep the visibility record separate from collection membership. Showing or hiding a card must not remove it from a rule query, change a count used by the engine, or change who chooses. Persistent visibility after resolution would require a separately owned room effect with explicit lifetime; do not retain a completed stack object's temporary collection forever.

## Selection and disposition remain ordinary instructions

After capture, reuse the existing search/filter pattern:

```json
{
  "family": "cards",
  "operation": "move",
  "params": { "origin": "library", "destination": "hand" },
  "choice": {
    "kind": "search",
    "zone": "library",
    "from": { "kind": "result", "name": "window" },
    "cardTypes": ["Creature"],
    "subTypes": ["蒼巨人"],
    "min": 0,
    "max": 1
  }
}
```

To mill the exact current remainder without an additional human selection:

```json
{
  "family": "cards",
  "operation": "mill",
  "params": { "from": { "kind": "result", "name": "window" } },
  "recordResult": { "name": "remainder", "kind": "milled" }
}
```

This reuses ordinary discard/movement replacements and successful-arrival accounting. Optional `filter` and `amount` restrict that source; omitted amount means every current library member in the set. A missing set never becomes a whole-library mill. Ordinary amount-only milling is unchanged.

A second instruction can select an artifact from the same window; the first selected card has left the library and is no longer in that window's current actionable members. A final instruction moves or orders all remaining current members. No follow-up may fall back to the whole library if the named set is missing.

A chooser's permission and visibility are distinct. Seeing a public window does not let the opponent answer its controller's choice. Conversely, creating a choice must not itself reveal identities that its policy denies; require suitable face access. A future blind-selection mode needs its own explicit contract. Opponents can see public revealed cards while still seeing the ordinary waiting view for another player's pending decision. Unsubmitted selections stay private.

Use shared filters, `current`/`recorded` queries, explicit optional/mandatory bounds and ordinary movement/replacement handling. Take-all uses the existing `allAvailable` search recipe. Distinct-name selections, same-zone picked-card exclusion and conditional repetition are still separate work, not silently accepted options. Repetition must allocate distinct occurrence identities or explicitly replace a consumed window; duplicate names must not silently merge unrelated captures.

## Current versus recorded observations

For captured windows, the collection anchor is the observation in its original zone and revision. For mill, it is the successful actual arrival. Normalize these anchors behind the shared collector without disguising an unmoved observation as a physical zone arrival.

- `current` locates the exact anchored incarnation and evaluates live characteristics. A selected card leaving that zone, or leaving and returning, stops matching. Other cards in the zone are never added.
- `recorded` uses the immutable anchor snapshot. It can count the original revealed yellow cards after some have moved, for example, without changing the historical result.
- Movement that needs its own later result should capture a new named result at its actual outcome; do not make an original window automatically follow every future incarnation.

Capture does not have cancelled-movement semantics because it does not move anything. Mill retains its existing pre-replacement probe and successful-arrival rules, including redirects and cancelled attempts. Capture and mill can share collection consumers without forcing their production steps to be identical.

## Projection, logs and lifecycle

Raw mill/capture result maps and probes remain server-only. `PlayerView.observations` exposes separate `active` and `history` lists. Cards contain a viewer-specific opaque handle, printed definition identity and captured face display data, with no physical UUID, source positions, authored rule objects or actions. Hidden order is an independent stable handle order rather than source order. Library-choice options apply the same rule, including ordinary searches without a captured set. Public reveal events use canonical card order when any player lacks order visibility, preventing notifications or trigger discovery from disclosing the library order. The client has a read-only active observation panel and an expandable history beside its choices.

Capture-time information is available in the same committed snapshot/delta that opens the following choice. Reconnect reconstructs authorized observations from room state. Monotonic exposure sequences reject duplicate/out-of-order mutation replay. Public reveal triggers retain the existing completion-time ordering; migrating `reveal_top` does not fire them early or twice. A private look never enters that event/notification path.

Every historical exposure stores its immutable audience and snapshots. History retention is bounded per viewer: private exposures cannot evict another player's legitimate history, reveal private revision gaps, or consume the other viewer's budget. Unauthorized names are absent from snapshots, deltas, notifications and refresh history. Decreasing active exposure preserves earlier legitimate observations without granting current hand/library access.

Server-only diagnostics/internal delta logs may retain raw snapshots under the existing trusted logging policy. Those are not player replay payloads; player projection always runs again for the authenticated seat. Rooms remain in-memory; browser reconnect is supported, not server-crash room persistence.

The collection and temporary grants survive payment, search and replacement pauses as serializable continuation data. They expire with the whole resolving object on completion, countering or fizzling. A cancelled optional reveal creates no observation or event. Earlier committed movement stays committed; collection cleanup never moves the cards again.

## Ownership, verification and remaining scope

- `types/card-observation.types.ts` owns typed audiences, snapshots and observation state; `CardState` owns base zone visibility.
- `rules/schema/observations.ts` owns strict authored capture/exposure contracts, using the shared filter/result-source schemas.
- `shared/observation-policy.ts` resolves audiences and validates implications; `shared/card-visibility.ts` owns normal zone defaults.
- `engine/captured-windows.ts` creates named captures and changes current-member grants. `engine/observation-state.ts` owns replay-safe storage, retention and closure.
- Existing result collectors, numeric queries, search choices, movement/replacement transactions and mill arrivals consume the same collection API. Saved captured choices recheck current face access before projection and acceptance.
- Server `projection/observation-view.ts` emits per-viewer display snapshots. The client consumes these projections only.

Focused logic checks cover private/public/partial exposure, count/order independence, opponent-library roles, immutable history, chooser authority, stale access, exact remainder milling and replacement redirects/pauses, short/empty libraries, reconstruction, replay, cleanup and projection/log redaction. Existing mill/reveal/query/zone/choice/trigger/numeric/protocol/client and architecture/readability checks are regression coverage. **360 distinct selected logic checks pass across 25 files**, using the latest result per file, including original catalog/preset preservation. All workspace typechecks pass. No browser smoke, long socket test or full suite is run. An incidental short HTTP/socket setup run found an occupied-seat test expecting 403 while the existing seat-claim path returns 409. The later token delivery updates that assertion to the owner-approved 409 and verifies the focused occupied-seat HTTP case; the handler remains unchanged.

This delivers retained-window infrastructure, not all thirteen complete reveal cards. Distinct printed-name selection, excluding a selected card which remains in the same zone, recursive repetition, off-zone source discovery and cross-owner hand destinations remain explicit dependencies. Persistent visibility and face-down public-zone mechanics need separately owned lifetimes and appropriate card-back views. Catalog coverage stays 72/142 until additional complete definitions are authored and proven.

## Hand custody and turn-long reveals

A hand transfer can name a recipient. The card keeps its owner and uses the recipient's hand for visibility, actions and discard selection. Later moves to a library, graveyard or exile use the owner. Casting and land placement from the borrowed hand give the resulting permanent to the acting player. The same source and destination identities drive applied events and internal deltas.

A hand capture can sample current eligible cards through the shared random picker, or observe the current arrivals of a named result. A reveal with `hand_exit_or_turn_end` keeps the exact card visible in the active observations until it leaves that hand or the turn ends. Public history retains the original observation. Re-entry creates a new incarnation and visibility grant.

永恆魔洋 records a public name restriction in the room's continuous effect pool. It expires at turn end and prohibits the opponent's casting, placement and activated abilities for that name across zones. The reveal and restriction have independent lifetimes. The restriction is visible without exposing other hand cards. Existing static and triggered abilities keep working. A spell already cast can still resolve.

深海之墓 uses the same permission rules. Below five cards, the protected player's hand is excluded from opposing reveal and discard selection and protected from opposing movement effects. Explicit effect targeting of cards in the other player's graveyard is prohibited for both players. Untargeted moves still follow their normal rules.

洛基 observes the exact successful draw from the other player's library. Blue mana can pay any of the revealed card's own colors for that recipient's cast during the current turn. The substitution uses the actual mana inventory and leaves the printed cost and mana value intact.
