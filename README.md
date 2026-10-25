# Card game

A two-player, MTG-inspired card game with a TypeScript/Express/Socket.IO server and a React/Zustand client, organised as npm workspaces:

- `packages/engine/src/` — game rules, card data, helpers, and contracts (`@card-game/engine`).
- `apps/server/src/` — transport and multiplayer lifecycle (`@card-game/server`).
- `apps/game-client/` — React player app (`@card-game/client`).

- [Concept map — where things are and how flows run](docs/MAP.md) (start here to navigate the code)
- [Current architecture and verification](ARCHITECTURE.md)
- [Workspace architecture supplement](docs/workspace-architecture.md)
- [Enforced dependency rules](docs/architecture-import-policy.md)
- [Security lab plan — Linux hosting, pentest, detection, observability](docs/security-lab-plan.md) (proposed; no phase implemented)
- [Card JSON field reference and commented examples](packages/engine/src/library/README.md)
- [Platform roadmap](docs/platform-plan-2026-10-24.md)

Use Node `^20.19.0 || >=22.12.0` and run these commands from the repository root:

```sh
npm ci
npm run verify
npm start
```

Open `http://localhost:3000` in two separate browser sessions and create/join a room. Development uses `npm run dev` for the backend and `npm run dev:client` for the Vite client on port 5173.

`verify` checks all three TypeScript projects, runs all four Vitest projects (including architecture checks), and builds both applications. TypeScript emits only declaration/build metadata under ignored `build/types/`. Vite bundles the engine source into `apps/server/dist/index.js` and builds the client independently under `apps/game-client/dist/`; Express serves the latter. Internal engine imports and tests resolve the same source package, with no engine JavaScript build to go stale.

The individual gates are `npm run typecheck:server`, `npm run typecheck:client`, `npm run test:architecture`, `npm test`, and `npm run build`. `npm run test:watch` watches the test projects. CI runs `npm ci` followed by `npm run verify` on Node 24. See the [RPS smoke checklist](docs/smoke-test-rps.md) for the production browser flow.
