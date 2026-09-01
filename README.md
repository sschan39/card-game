# Card Game

A real-time multiplayer card game (Magic-style) built with **TypeScript**, **Express**, **Socket.IO**, and **React**.

> **Status:** MVP playable. The engine is strictly layered — `engine` is a pure, network-agnostic state machine with an exhaustive Vitest suite.

---

## Highlights

- **Pure, testable engine** — `src/engine` has zero socket/HTTP knowledge. Every rule is a mutation applied through a pure reducer, verified by **163+ Vitest tests**.
- **Layered architecture** — `types → library → engine → server`. `server.ts` is the only translation layer between network events and engine calls.
- **Delta-driven client sync** — state changes produce immutable `StateDelta`s that are broadcast per-player with hidden-zone redaction (opponent hand/deck are never leaked).
- **Real-time multiplayer** — rooms created/joined over Socket.IO, Rock-Paper-Scissors start, full turn cycle, stack resolution, priority passing.
- **React client** (`src/client`) — Vite + Zustand store applying server deltas.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [GAME_JS_REFERENCE.md](./GAME_JS_REFERENCE.md) for the detailed design.

```
src/
├── server.ts            # Express + Socket.IO entry point; wires GameEngine to network
├── types/               # Pure type definitions — no runtime code
├── library/             # Card data loading + instantiation (card-parser, card-factory)
├── engine/              # Core game logic — pure, no socket/HTTP knowledge
│   ├── game-engine.ts   # Single unified public API (owns EventBus, StateMachine, ActionService)
│   ├── game-reducer.ts  # Pure reducer: (state, mutation) => newState
│   ├── state-machine.ts # Turn phases, stack, priority
│   ├── effect-registry.ts / effect-resolver.ts
│   └── handlers/        # cast_spell, attack, tapForMana, end_turn, pass_priority, resolve_stack
└── src/client/          # React + Zustand client
```

### Game flows implemented

- Room lifecycle: create, join, RPS mini-game, deal starting hands
- Turn structure: TurnStart (untap) → Draw → Main → Battle → End → Cleanup
- Cast spell, attack, tap for mana, stack resolution (LIFO), ETB triggers
- Priority system with consecutive-pass resolution and turn-cycle phase advance
- Per-player delta broadcasting with opponent hidden-zone redaction

## Getting started

```bash
npm install
npm test        # run the Vitest suite
npm run build   # type-check + build client
npm run start   # run the server on http://localhost:3000
npm run dev     # build then start
npm run dev:client  # standalone Vite dev server (proxies socket.io to :3000)
```

## Requirements

- Node.js 20+
- npm

## License

ISC