# Effect & Stack System Redesign — Design Document

**Date:** 2026-07-13
**Status:** Draft — Awaiting Review
**Context:** JS-to-TS refactoring; redesigning the effect resolution and stack mechanics

---

## 1. Overview

Redesign the effect and stack system around a **hybrid tagged primitives** model. Instead of high-level named effects (`DEAL_DAMAGE`, `CAST_SPELL`), all game actions decompose into ~8 atomic primitives (`MODIFY_STATS`, `DRAW`, `MOVE_ZONE`, etc.) with optional semantic tags (`damage`, `counter`, `sacrifice`).

**Why:**
- `EffectRegistry` stays small and closed (~8 handlers), never grows with the card pool
- Modifiers intercept at the primitive level — "all damage +1" modifies `MODIFY_STATS` with tag `damage`, no need to know about every damage-dealing card
- Replacement effects are clean — "instead of drawing, mill" replaces `DRAW` with `MOVE_ZONE`
- Targeting is per-effect, naturally handling multi-effect cards

---

## 2. Primitive Actions

### 2.1 EffectRegistry

The registry maps primitive names to pure handler functions: `(room: GameRoom, stackObj: StackObject, effect: StackEffect) => void`.

| Primitive | Params | Tags | Behavior |
|---|---|---|---|
| `MOVE_ZONE` | `{ origin: CardZone, destination: CardZone }` | `counter`, `sacrifice`, `discard`, `bounce`, `reanimate` | Move target card between zones |
| `MODIFY_LIFE` | `{ amount: number }` | `damage`, `lifelink`, `drain`, `heal` | Add amount to player life (negative = loss) |
| `MODIFY_STATS` | `{ power?: number, toughness?: number, damage?: number }` | `damage`, `until_end_of_turn`, `counter_based` | Modify creature P/T or mark damage |
| `ADD_COUNTER` | `{ counterType: string, amount: number }` | — | Place counters on target permanent |
| `REMOVE_COUNTER` | `{ counterType: string, amount: number }` | — | Remove counters from target permanent |
| `TAP` | `{}` | — | Set target permanent to tapped |
| `UNTAP` | `{}` | — | Set target permanent to untapped |
| `DRAW` | `{ amount: number }` | — | Move cards from library to hand |
| `ADD_MANA` | `{ color: ManaColor, amount: number }` | — | Add to player's mana pool |

### 2.2 Handler Signature

```ts
type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect) => void;
```

Each handler:
- Receives the full `StackObject` for context (controllerId, source card)
- Receives the specific `StackEffect` with its params, tags, and locked targets
- Mutates `room` directly — no return value needed
- Has zero knowledge of sockets or transport

### 2.3 What Happens to Existing Handlers

| Old Handler | Disposition |
|---|---|
| `CAST_SPELL` | **Removed.** Spell resolution zone change is structural (Section 5), not an effect. |
| `DEAL_DAMAGE` | **Replaced by `MODIFY_STATS`** with `tags: ["damage"]`. Damage to players uses `MODIFY_LIFE` with `tags: ["damage"]`. |
| `DISCARD_HAND` | **Replaced.** Cards that discard hand use multiple `MOVE_ZONE` primitives (one per card, hand→graveyard). |
| `DRAW_CARDS` | **Replaced by `DRAW`.** |
| `ADD_MANA` | **Kept as-is.** |

---

## 3. StackEffect & StackObject

### 3.1 StackEffect

Each individual effect within a stack item carries its own targets, locked in at cast time:

```ts
interface StackEffect {
  action: string;                    // primitive name, e.g. 'MODIFY_STATS'
  params: Record<string, unknown>;   // e.g. { damage: 3 }
  tags: string[];                    // e.g. ['damage']
  targets: TargetPointer[];          // locked-in targets chosen at cast time
}
```

### 3.2 StackObject

```ts
interface StackObject {
  readonly uuid: string;
  readonly type: 'spell' | 'activated' | 'triggered';
  readonly controllerId: string;
  readonly source: CardInstance;     // the card/ability source (LKI snapshot)
  readonly effects: StackEffect[];   // resolves in order
  readonly timestamp: number;
  countered: boolean;                // set true if countered; effects skipped on resolution
}
```

**Key changes from current design:**
- `payload: EffectPayload` (single) → `effects: StackEffect[]` (array) — supports multi-effect cards
- `targets: TargetPointer[]` on StackObject → `targets: TargetPointer[]` on each StackEffect — per-effect targeting
- `source` stays as `CardInstance` — the card lives inside the StackObject while on the stack; no separate zone array needed

### 3.3 Static Factories

```ts
// Playing a card from hand
StackObject.createSpell(controllerId, cardInstance, effects: StackEffect[])

// Activating a permanent's ability
StackObject.createActivated(controllerId, sourceCard, effects: StackEffect[])

// Triggered ability firing
StackObject.createTriggered(controllerId, sourceCard, effects: StackEffect[])
```

Targets are already embedded in each `StackEffect` — no separate targets parameter needed.

---

## 4. Card Definition Format

### 4.1 Card Data Schema

Cards in `card_data.json` define effects in two arrays:

```json
{
  "id": "inferno-drake",
  "name": "Inferno Drake",
  "manaCost": "{2}{R}{R}",
  "cardTypes": ["Creature"],
  "subTypes": ["Drake"],
  "power": 3,
  "toughness": 3,
  "rulesText": "When ~ enters, deal 3 damage to target creature and draw a card.",
  "onCastEffects": [],
  "onEnterEffects": [
    {
      "action": "MODIFY_STATS",
      "params": { "damage": 3 },
      "tags": ["damage"],
      "targeting": {
        "type": "permanent",
        "cardTypes": ["Creature"],
        "controller": "opponent",
        "required": true,
        "minTargets": 1,
        "maxTargets": 1
      }
    },
    {
      "action": "DRAW",
      "params": { "amount": 1 },
      "targeting": { "type": "self" }
    }
  ]
}
```

### 4.2 Field Definitions

| Field | Purpose |
|---|---|
| `onCastEffects` | Effects that resolve as part of the spell resolving. For sorceries/instants, this is where all effects go. For permanents, these are rare ("when you cast this spell" effects). |
| `onEnterEffects` | Effects that trigger when the permanent enters the battlefield. Creates a separate triggered `StackObject`. |
| `targeting.type` | `"player"`, `"permanent"`, `"spell"`, `"card"` (in graveyard/library), `"self"` (auto-targets controller) |
| `targeting.controller` | `"self"`, `"opponent"`, `"any"` |
| `targeting.required` | If true, must choose targets to cast. If false, may cast with zero targets. |
| `targeting.minTargets` / `maxTargets` | How many targets must/can be chosen |

### 4.3 Type Definitions

```ts
interface CardDefinition {
  id: string;
  name: string;
  manaCost: string;
  cardTypes: CardType[];
  subTypes: string[];
  power?: number;
  toughness?: number;
  rulesText: string;
  onCastEffects?: EffectDefinition[];
  onEnterEffects?: EffectDefinition[];
  abilities?: AbilityDefinition[];
}

interface EffectDefinition {
  action: string;                    // primitive name
  params: Record<string, unknown>;   // primitive-specific params
  tags?: string[];                   // semantic tags
  targeting: TargetingDefinition;
}

interface TargetingDefinition {
  type: 'player' | 'permanent' | 'spell' | 'card' | 'self';
  cardTypes?: CardType[];
  controller?: 'self' | 'opponent' | 'any';
  required: boolean;
  minTargets?: number;
  maxTargets?: number;
}
```

---

## 5. Resolution Flow

### 5.1 Spell Resolution (Structural)

When a `StackObject` resolves, the game engine performs a **structural zone change** before executing effects. This is a game rule, not an effect — it does not use `EffectRegistry`.

```
if source is a permanent (Creature, Artifact, Enchantment):
    source.state.zone = 'battlefield'
    room.battlefield.push(source)
    emit PERMANENT_ENTERED

if source is non-permanent (Sorcery, Instant):
    source.state.zone = 'graveyard'
    player.graveyard.push(source)
```

If the spell was **countered** (a `MOVE_ZONE` with tag `counter` targeted this spell on the stack in an earlier resolution), the `StackObject` is marked `countered: true`. The structural zone change still happens (stack→graveyard) but `stackObj.effects` are skipped and no `PERMANENT_ENTERED` fires. The `countered` flag is set by the `MOVE_ZONE` handler when it moves a spell from stack to graveyard with the `counter` tag.

### 5.2 Effect Execution

After structural zone change, iterate `stackObj.effects` in order:

```
for each effect in stackObj.effects:
    transformed = ModifierPipeline.apply(effect, room, stackObj)  // stub: identity
    handler = EffectRegistry[transformed.action]
    handler(room, stackObj, transformed)
```

### 5.3 Post-Resolution Events

After all effects execute:
1. `EventBus.emit('STACK_ITEM_RESOLVED', { stackObj })`
2. `TriggerManager` listeners fire — scan for matching triggered abilities
3. Any new `StackObject`s are pushed to `room.stack`
4. If stack is non-empty → new priority round
5. If stack is empty → return to previous phase

### 5.4 Complete Example: Playing Inferno Drake

```
1. Client → executeAction({ actionId: 'playCardAction', cardUuid })
2. Server validates, sees targeting needed → targetRequest to client
3. Client → submitTargets({ effectTargets: [[{ cardUuid: 'opp-creature' }], []] })
4. Server validates targets, creates StackObject:
   { type: 'spell', source: drakeCard, effects: [] }  // no onCastEffects
5. StackObject pushed to room.stack, priority to opponent
6. Both pass → resolve:
   a. Structural: drakeCard moves stack→battlefield
   b. effects[] is empty, nothing to execute
   c. Emit PERMANENT_ENTERED
   d. TriggerManager sees onEnterEffects, creates new StackObject:
      { type: 'triggered', source: drakeCard, effects: [
        { action: 'MODIFY_STATS', params: { damage: 3 }, tags: ['damage'], targets: [opp-creature] },
        { action: 'DRAW', params: { amount: 1 }, tags: [], targets: [self] }
      ]}
   e. New StackObject pushed, priority round begins
7. Both pass → resolve triggered ability:
   a. Structural: not a spell, no zone change
   b. Execute MODIFY_STATS: deal 3 damage to opp-creature
   c. Execute DRAW: controller draws 1
   d. Emit STACK_ITEM_RESOLVED
   e. No new triggers, stack empty → return to main phase
```

---

## 6. Targeting Flow

### 6.1 Server-Prompted Targeting

Targets are chosen after the action is declared but before the StackObject is created:

```
Client                    Server
  |                          |
  |-- executeAction -------->|  (no targets yet)
  |                          |  validate card playable
  |                          |  check which effects need targets
  |<-- targetRequest --------|  (legal targets for each effect)
  |                          |
  |  [player chooses targets in UI]
  |                          |
  |-- submitTargets -------->|  (chosen targets per effect)
  |                          |  validate each target
  |                          |  lock targets into StackEffect
  |                          |  create StackObject, push to stack
  |<-- stateDelta -----------|  (stack updated)
```

### 6.2 Auto-Targeting

Effects with `targeting.type: "self"` are auto-filled by the server — targets the controller. No client prompt needed.

### 6.3 Target Validation

Server validates each target at submission time:
- Target exists in the specified zone
- Target matches `cardTypes` filter (if specified)
- Target's controller matches `controller` filter (if specified)
- Target is not hexproof/shroud (future: ModifierRegistry)
- Count is within `minTargets`/`maxTargets`

---

## 7. EventBus & TriggerManager

### 7.1 EventBus

Real implementation replacing the current stub:

```ts
type EventListener = (event: GameEvent) => void;

class EventBus {
  private listeners: Map<string, EventListener[]> = new Map();
  private roomId: string;

  constructor(roomId: string);

  emit(event: GameEvent): void;
  on(eventId: string, listener: EventListener): void;
}
```

One `EventBus` instance per room. Listeners are stored in a `Map<string, EventListener[]>`.

### 7.2 Game Events

| Event | When Emitted | Payload |
|---|---|---|
| `ACTION_PROPOSED` | StackObject created and pushed | `{ actionType, playerId, stackObj }` |
| `STACK_ITEM_RESOLVED` | All effects of a stack item executed | `{ stackObj }` |
| `PERMANENT_ENTERED` | Card enters battlefield | `{ card, controllerId }` |
| `PERMANENT_LEFT` | Card leaves battlefield | `{ card, fromZone, toZone }` |
| `PHASE_CHANGED` | Turn phase transitions | `{ phase, currentPlayer }` |
| `TURN_STARTED` | New turn begins | `{ playerId, turnNumber }` |
| `LIFE_CHANGED` | Player life total changes | `{ playerId, oldLife, newLife, source }` |

### 7.3 TriggerManager

New class that registers listeners on the EventBus at game initialization:

```ts
class TriggerManager {
  constructor(eventBus: EventBus, room: GameRoom) {
    // ETB triggers
    eventBus.on('PERMANENT_ENTERED', (event) => {
      const card = event.payload.card as CardInstance;
      if (card.onEnterEffects?.length) {
        const stackObj = StackObject.createTriggered(
          card.state.controllerId,
          card,
          buildStackEffects(card.onEnterEffects)
        );
        room.stack.push(stackObj);
        eventBus.emit({ eventId: 'ACTION_PROPOSED', roomId: room.roomId, payload: { stackObj } });
      }
    });

    // Future:
    // PERMANENT_LEFT → death triggers
    // LIFE_CHANGED → life-gain triggers
    // TURN_STARTED → upkeep triggers
    // PHASE_CHANGED → beginning-of-combat triggers
  }
}
```

### 7.4 Trigger Ordering

When multiple triggers fire from the same event, they are pushed to the stack in APNAP order (Active Player, Non-Active Player). The active player's triggers go on the stack first (resolve last), then the non-active player's triggers go on top (resolve first).

---

## 8. Modifier System (Stub)

### 8.1 ModifierPipeline

Stub implementation — returns effects unchanged. Signature updated to work with `StackEffect`:

```ts
class ModifierPipeline {
  static apply(effect: StackEffect, room: GameRoom, stackObj: StackObject): StackEffect {
    // Future: chain active modifiers, transform effect
    return effect;
  }
}
```

### 8.2 ModifierRegistry

Stub implementation — all permission checks pass:

```ts
class ModifierRegistry {
  static canPlay(room: GameRoom, playerId: PlayerId, card: CardInstance): boolean;
  static canTarget(room: GameRoom, playerId: PlayerId, card: CardInstance, targets: TargetPointer[]): boolean;
}
```

### 8.3 Future Modifier Interface (Designed, Not Implemented)

```ts
interface Modifier {
  source: CardInstance;
  condition: (effect: StackEffect, stackObj: StackObject) => boolean;
  apply: (effect: StackEffect) => StackEffect;
}
```

Modifiers apply at **resolution time** (not cast time). If the source of a modifier is removed before resolution, the modifier no longer applies.

---

## 9. Files Changed

### 9.1 Modified Files

| File | Changes |
|---|---|
| `src/types/effect.types.ts` | Add `StackEffect` interface. Replace `EffectPayload` in `StackObject` with `effects: StackEffect[]`. Add `EffectDefinition`, `TargetingDefinition`. |
| `src/types/card.types.ts` | Add `onCastEffects?` and `onEnterEffects?` to `CardDefinition`. |
| `src/engine/effect-registry.ts` | Replace 4 handlers with ~9 primitive handlers. Remove `CAST_SPELL`. Add `MOVE_ZONE`, `MODIFY_STATS`, `DRAW`, `TAP`, `UNTAP`, `ADD_COUNTER`, `REMOVE_COUNTER`. Keep `ADD_MANA`. |
| `src/engine/action-registry.ts` | Update `ActionHandler.resolve()` to iterate `stackObj.effects[]` and call `EffectRegistry` per effect. |
| `src/engine/handlers/play-card-handler.ts` | Update `propose()` to build `StackEffect[]` from card definition's `onCastEffects`. Update `resolve()` to delegate to shared effect resolver. Remove `CAST_SPELL` logic. |
| `src/engine/game-engine.ts` | Add structural zone change in `resolveTopOfStack()`. Add shared effect iteration. Integrate `TriggerManager` initialization. |
| `src/engine/event-bus.ts` | Implement real `emit`/`on` with stored listeners. |
| `src/engine/modifier-pipeline.ts` | Update signature: `ActionData` → `StackEffect`. Keep stub. |
| `src/library/card-parser.ts` | Update parser for `onCastEffects`/`onEnterEffects` format. |
| `data/card_data.json` | Update all cards to new format. |
| `tests/engine/` | Update existing tests. Add tests for new primitives, EventBus, TriggerManager. |

### 9.2 New Files

| File | Purpose | ~Lines |
|---|---|---|
| `src/engine/trigger-manager.ts` | Listens to EventBus, creates triggered StackObjects for ETB effects | 40 |
| `src/engine/effect-resolver.ts` | Shared effect iteration: runs effects through pipeline, calls EffectRegistry, emits events | 30 |

### 9.3 Not Changed

| File | Reason |
|---|---|
| `src/engine/modifier-registry.ts` | Stub — interface already designed, implementation deferred |
| `src/engine/action-validator.ts` | No changes needed — validates costs and conditions, not effects |
| `src/engine/room-factory.ts` | No changes needed |
| All legacy JS files | Untouched per refactoring policy |

---

## 10. What's Deferred

| Item | Reason |
|---|---|
| ModifierPipeline implementation | Stub is sufficient; modifiers need continuous effect tracking first |
| ModifierRegistry implementation | Stub is sufficient; needs hexproof/shroud/can't-cast rules |
| Death triggers (`PERMANENT_LEFT`) | TriggerManager handles `PERMANENT_ENTERED` only; death triggers follow same pattern later |
| Upkeep/beginning-of-combat triggers | Same pattern as ETB; add when needed |
| Activated abilities on permanents | StackObject type `'activated'` is defined but no handler exists yet |
| Target redirection effects | ModifierPipeline stub; needs real pipeline first |

---

## 11. Key Design Decisions

1. **Hybrid tagged primitives** — small closed registry + semantic tags for rules that care about damage vs life loss, etc.
2. **Spell resolution is structural, not an effect** — `MOVE_ZONE` exists as a primitive for effects that move things, but a spell resolving and entering the battlefield is a game rule
3. **ETB triggers are separate StackObjects** — can be responded to independently of the creature spell
4. **Targets are per-effect, server-prompted** — server is always authority on legal targets
5. **Modifiers apply at resolution time** — if the source is removed, the modifier stops applying
6. **EventBus is real now** — needed for ETB triggers; the listener system is small enough to implement immediately
7. **One EventBus per room** — events don't cross room boundaries