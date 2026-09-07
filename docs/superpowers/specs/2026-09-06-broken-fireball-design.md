# 破裂火球 (Broken Fireball) — First Real Consumer Targeting Card

**Date:** 2026-09-06
**Status:** Ready for Review
**Context:** The tap-based targeting UI (spec `2026-09-06-tap-targeting-design.md`) is implemented and committed. The only card exercising the targeting flow is the **synthetic test card** `fire-bolt` (火焰箭), which is not a real ST01A card. This spec adds the first **real** consumer card — 破裂火球 (Broken Fireball) — which deals 3 damage to the opponent player, mapping cleanly onto the existing `MODIFY_LIFE` primitive and the existing player-targeting UI.

---

## 1. Overview

破裂火球 is a real ST01A card:

```
破裂火球  1炎  炎兵
此卡被「炎獸」的效果公開時，可以加入手牌
速：對對手玩家造成3點傷害
```

For this first implementation, we implement **only the `速` (instant) effect**: deal 3 damage to the opponent player. The "revealed by 炎獸 effect → add to hand" line is a separate mechanic (card-reveal interaction) and is **out of scope** for this spec.

**Why this card:** It is the simplest real card that exercises the targeting flow. It targets a **player** (not a creature), which the tap-based UI already supports via `PlayerInfo`/`OpponentInfo`. It uses the **`MODIFY_LIFE`** primitive (already implemented and used by the attack handler). No new primitives, no triggers, no counters, no dual-mode timing.

---

## 2. Current State (verified 2026-09-06)

| Piece | Location | Status |
|-------|----------|--------|
| `fire-bolt` (synthetic test card) | `src/library/card_data.json` | ✅ Exists |
| `fire-bolt` in test deck | `src/engine/room-factory.ts` → `TEST_DECK_IDS` | ✅ Exists |
| `MODIFY_LIFE` primitive (player target) | `src/engine/effect-registry.ts` | ✅ Works |
| Player-targeting UI (`type: 'player'`) | `src/client/components/PlayerInfo.tsx` / `OpponentInfo.tsx` | ✅ Works |
| `needsTargets(card)` client helper | `src/client/targeting.ts` | ✅ Works |
| `matchesTargetFilter(card, def, playerId)` | `src/shared/target-utils.ts` | ✅ Works |
| `TargetingDefinition.type` includes `'player'` | `src/types/effect.types.ts` | ✅ Supported |

### Gaps

1. **No real consumer card** exercises the targeting flow — only the synthetic `fire-bolt`.
2. **`fire-bolt` targets a creature** (`type: 'permanent'`, `cardTypes: ['Creature']`). The player-targeting path (`type: 'player'`, `controller: 'opponent'`) is wired in the UI but **never exercised end-to-end** by any card.

---

## 3. Design

### 3.1 Card data

Add a new card `broken-fireball` (破裂火球) to `src/library/card_data.json`:

```json
"broken-fireball": {
  "id": "broken-fireball",
  "name": "破裂火球",
  "manaCost": "{R}",
  "cardTypes": ["Spell"],
  "subTypes": ["FireSoldier"],
  "rulesText": "速：對對手玩家造成3點傷害",
  "onCastEffects": [
    {
      "action": "MODIFY_LIFE",
      "params": { "amount": -3 },
      "tags": ["damage"],
      "targeting": {
        "type": "player",
        "controller": "opponent",
        "required": true,
        "minTargets": 1,
        "maxTargets": 1
      }
    }
  ]
}
```

**Key decisions:**
- **`action: 'MODIFY_LIFE'`** with `amount: -3` — matches the attack handler's damage-to-player pattern (`amount: -power`).
- **`targeting.type: 'player'`** — the tap-based UI already handles this.
- **`targeting.controller: 'opponent'`** — restricts the legal target to the opponent player. `matchesTargetFilter` and the `PlayerInfo`/`OpponentInfo` controller checks already honor this.
- **`cardTypes: ['Spell']`** — matches the existing `fire-bolt` convention (spells are `Spell` type, not `Creature`).
- **`subTypes: ['FireSoldier']`** — 炎兵 maps to "FireSoldier" (the card's 種族). This is informational; no filter logic depends on it yet.

### 3.2 Test deck — **replace** `fire-bolt`

**Decision: replace `fire-bolt` with `broken-fireball`** in `TEST_DECK_IDS`. This keeps the deck at 9 cards and means there is only **one** card to remove when the test is done — easy cleanup.

```ts
const TEST_DECK_IDS = [
  'empire-servant', 'empire-servant', 'empire-servant', 'empire-servant',
  'land-red', 'land-red', 'land-red', 'land-red',
  'broken-fireball',
];
```

**Trade-off:** `fire-bolt` exercises the **creature-targeting** path (`type: 'permanent'`), which `broken-fireball` does not. Replacing it means the creature-targeting path is no longer exercised by the test deck. This is acceptable because:
- The creature-targeting path is already covered by the engine tests (`play-card-handler.test.ts`, `effect-resolver.test.ts`).
- The goal here is a **quick, easily-removable** test of the player-targeting UI path.
- A real creature-targeting card can be added later when needed.

### 3.3 Server-side validator fix (found during implementation)

While implementing, I found that `ActionValidator.isTargetLegal` for `case 'player'` only checked that the player **exists** — it did **not** apply the `controller` filter. This meant a card with `targeting: { type: 'player', controller: 'opponent' }` would accept **either** player as a target on the server, even though the client UI correctly restricted it.

**Fix:** Added the `controller` check to `isTargetLegal` for player targets:

```ts
case 'player': {
  if (!target.playerId) return false;
  if (!room.players[target.playerId]) return false;
  if (def.controller === 'self' && target.playerId !== playerId) return false;
  if (def.controller === 'opponent' && target.playerId === playerId) return false;
  return true;
}
```

**Tests added** in `tests/engine/action-validator.test.ts`:
- accept opponent target when `controller: 'opponent'`
- reject self target when `controller: 'opponent'`
- accept self target when `controller: 'self'`
- reject opponent target when `controller: 'self'`

### 3.4 Removal checklist (for when the test is done)

To remove 破裂火球 entirely, revert these spots:
1. `src/library/card_data.json` — delete the `broken-fireball` entry.
2. `src/engine/room-factory.ts` — remove `'broken-fireball'` from `TEST_DECK_IDS`.
3. `tests/engine/room-factory.test.ts` — line 15: `['empire-servant', 'land-red', 'fire-bolt']` (restore `fire-bolt`).
4. `tests/engine/rps-play-handler.test.ts` — line 220: same restore.
5. `src/engine/action-validator.ts` — revert the `controller` filter added to `isTargetLegal` `case 'player'` (section 3.3).
6. `tests/engine/action-validator.test.ts` — remove the 4 controller-filter tests (section 3.3).
7. `docs/smoke-test-targeting.md` — restore the `fire-bolt` creature-targeting scenario.

> **Note:** The `action-validator.ts` controller-filter fix (item 5) is a **correctness fix** that benefits any future player-targeting card, not just 破裂火球. Consider **keeping** it even after removing the card.

---

## 4. Out of scope

- The "revealed by 炎獸 effect → add to hand" line (card-reveal mechanic).
- Instant-speed response casting (the `速` keyword is not yet reachable — the engine casts from hand at sorcery speed only).
- 火球術 (Fireball) — its dual-mode (主 scorch + 速 damage) needs conditional-effect and instant-speed logic. Deferred.
- Any balance changes to the card's cost/damage (designer's call).

---

## 5. Verification

- `npx tsc --noEmit` — clean.
- `npm test` — **278 tests pass** (21 files). Includes 4 new `action-validator` controller-filter tests.
- Manual smoke test: `docs/smoke-test-targeting.md` — updated with the 破裂火球 player-targeting scenario.

---

## 6. Open questions for review

1. **`subTypes: ['FireSoldier']`** — is 炎兵 correctly mapped to "FireSoldier"? The existing `fire-bolt` has no subtype. Confirm the subtype naming convention.
2. **Replace `fire-bolt`?** — I recommend replacing it (single card to remove later). This drops creature-targeting coverage from the test deck, but that path is covered by engine tests. Confirm.
3. **`rulesText`** — should it include the full original text (including the out-of-scope reveal line) or only the implemented effect? I used only the implemented effect for accuracy.
4. **Card ID** — `broken-fireball` is my chosen slug. Confirm the ID convention (existing IDs use kebab-case: `empire-servant`, `land-red`, `fire-bolt`).