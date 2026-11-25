# Predefined tokens, creation and board-only lifecycle

Implemented 4 November 2026. Tokens use ordinary card blueprints and the existing effect, trigger, replacement, source-history and projection paths. Token lifecycle is intrinsic instance state; it is not an exile ability which can be removed or countered.

## Definitions and factory

`apps/server/src/catalog/tokens/` contains explicit JSON templates, registered in its own small manifest. Each uses the same strict card schema and parser as ordinary cards: types, subtypes, colors, printed stats and normal activated/triggered/static abilities. The first template is `token-angel-1-1`, the 1/1 vanilla **上使** token confirmed by the owner. No color was added because its source wording specifies none.

One catalog parses, caches and freezes both ordinary and token blueprints, with disjoint IDs. `getBlueprint` can inspect either kind. `getCardIds` continues enumerating the ordinary card manifest; `getTokenIds` enumerates token templates. Token templates do not enter the deck builder's normal catalog or become selectable deck cards. `instantiateCard` rejects token IDs; `instantiateToken` requires one. An ordinary card cannot silently become a token merely because its ID was supplied to the creation effect.

The token factory sets top-level `CardInstance.isToken: true`, ordinary battlefield state, public base visibility, summoning sickness and `summonKind: "effect"`. Its owner and controller are the player receiving it. The flag survives changes to copiable characteristics, loss/grant of abilities and control changes; it does not depend on the printed blueprint retaining a special death effect.

## Authored creation effect

```json
{
  "family": "cards",
  "operation": "create_token",
  "params": {
    "tokenId": "token-angel-1-1",
    "amount": 1
  }
}
```

The default recipient is the resolving object's controller through ordinary self targeting. Explicit player targeting can create tokens for another player. Permanent/source-card recipients are rejected. `amount` defaults to one, accepts the existing validated numeric-expression contract, and must resolve to a nonnegative safe integer. Zero creates nothing. The total across all recipients is bounded by `config/tokens.json`, currently 64 tokens per instruction (config validation permits 1–256). Oversized/unresolved/invalid runtime amounts fail closed without partial creation.

Only registered `tokenId`s are accepted. Unknown fields, arbitrary inline blueprints, destination zones, negative/fractional counts and ordinary card IDs fail the strict parser. New token variants belong in JSON templates rather than per-card runtime handlers. Stats are supplied by the template and ordinary characteristic rules; ad hoc per-instance stat/ability overrides and copying an arbitrary live card are not exposed by this instruction.

## Creation through the existing pipeline

1. The effect planner allocates card identities using the room's runtime UUID provider. It validates the complete batch and detects collisions with live cards or another identity in that batch.
2. It produces `CREATE_TOKEN` mutations containing only template ID, card ID, receiving player and a monotonic birth sequence. No callbacks or raw client-supplied card state enter a snapshot.
3. The pure reducer uses the card factory to admit the canonical token directly to the battlefield. It never stages a token in the library, hand or spell stack.
4. Shared applied-event derivation publishes the same `PERMANENT_ENTERED` contract used by ordinary zone-entry moves. The existing trigger manager discovers other cards' entry triggers and the token's normal own-entry abilities. Source/cause metadata remain on the existing event/transaction path.
5. Normal rules checkpoints handle lethal state, continuous effects, attachments and trigger ordering. A token can enter and immediately die while its queued entry ability still resolves from its retained source information.

Creating a token is not casting a spell, playing a land or moving a card out of another zone. It does not fabricate a `CARD_MOVED` event. Countering the creating spell/ability skips its creation effects normally. Creation-specific replacement/multiplier rules are not invented here; existing movement replacements do not acquire a fake library origin to match creation.

Birth sequences are retained in room state and reject replay after a token has disappeared. A paused/reconstructed continuation carries already allocated mutations/identities rather than rerolling tokens. Normal catalog blueprints remain immutable and runtime functions stay outside serialized state.

## Tokens exist only on the board

The owner's ruling is strict: a token must never occupy hand, deck, graveyard, exile or the spell stack. A departure therefore has two separate facts: its settled semantic destination/reason and the token's actual cessation.

Movement/destruction/sacrifice first uses the existing proposal and replacement pipeline. Cancellation, indestructibility and regeneration can keep the token on the battlefield. Once a departure actually commits, shared zone transition code retains source snapshots and removes the token, then omits destination insertion. Even reducer previews and later instructions in the same resolving object cannot find it in another zone.

| Settled departure | Occupancy afterward | Semantic events |
|---|---|---|
| Creature token destroyed/lethal, graveyard-bound | Nowhere | Ordinary leave/death, applicable destruction and attributed kill, plus token cessation |
| Creature token sacrificed, graveyard-bound | Nowhere | Leave/death and cessation; sacrifice is not destruction or a kill |
| Returned toward hand/deck, or exiled | Nowhere | Leave and cessation; no false graveyard death |
| Destruction cancelled or regenerated | Still battlefield | No departure/death/cessation |

Existing attributed-exile kill policy remains separate from death: an attributed exile kill can retain its kill outcome while never firing a graveyard death event. Normal cards continue arriving in their real destination zones.

`PERMANENT_DIED`/`PERMANENT_DESTROYED` and kill outcomes use the successful settled token departure, not the presence of a destination card. `TOKEN_CEASED` retains the departure snapshot and settled destination for inspection. Its destination is semantic metadata, not evidence that the token occupied that zone. `CARD_MOVED` still requires a real arrival and is not emitted for cessation.

A token's ordinary `ON_DIE` ability can draw cards, deal damage, create another token or perform other supported instructions. It resolves through the normal stack after the token has ceased. A triggered “exile this token” rule would be too late and unnecessary; making disappearance a triggered ability would also let countering or removing abilities defeat the invariant.

Existing `CEASE_CARD` cleanup remains a defensive consumer for old/imported invalid states containing tokens outside the battlefield. Fresh factory-created tokens never need that delayed cleanup. A departed token cannot be returned or cast from a zone in which it never exists.

## Ownership and verification

- `apps/server/src/catalog/tokens/` owns named templates. The server catalog validates references and pins those definitions with the match.
- `engine/token-creation.ts` plans identities and creates marked instances from the pinned definitions.
- `rules/schema/instructions.ts`/`contracts.ts` validate the authored effect; `config/tokens.json` owns its work bound.
- Existing zone transitions, applied events and outcome settlement implement cessation, death and successful-outcome semantics without a second death-trigger system.
- Existing server projection shows token cards with `isToken`; delta mapping adds/removes the actual battlefield instance without phantom destination cards.

Focused verification covers templates, schema failures, numeric counts, recipient ownership, ETB watchers, ordinary own-entry/death abilities, immediate lethal state, countering, reconstruction, replay, all nonboard destinations, replacement redirects/cancellation/regeneration, sacrifice/kill/destruction distinctions and projection deltas. Related trigger, source, cost, replacement, outcome, state-based and architecture/readability checks are included. **273 distinct selected checks pass across 22 files**, including the focused occupied-seat HTTP 409 assertion and original catalog/preset preservation. All workspace typechecks pass. Architecture and readability budgets remain unchanged. No full suite, browser smoke or long socket test was run. Four older shuffle assertions were updated to verify the existing cause metadata rather than omit it; shuffle behavior is unchanged.

This delivery adds infrastructure and one token template, not new workbook card definitions. The two 1/1 angel-token cards need complete card-specific recipes/proof; 死亡組裝 still needs its success prerequisite ruling and named 7/6 token recipe. Dynamic template variants, token-copy instructions and creation-count/entry replacement rules remain separate explicit extensions.
