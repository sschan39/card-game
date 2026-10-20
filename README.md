# Card game

A two-player, MTG-inspired card game with a TypeScript/Express/Socket.IO engine and a React/Zustand client. The active application is in `src/`; the deprecated pre-refactor prototype lives in `legacy/`.

- [Concept map — where things are and how flows run](docs/MAP.md) (start here to navigate the code)
- [Current status and verification — 7 October 2026](docs/project-status-2026-10-07.md)
- [Future implementation plan — MTG rules fidelity](docs/implementation-plan-2026-10-07.md)
- [Editable development documents by roadmap item](docs/development/README.md)
- [Architecture](ARCHITECTURE.md) (some completion labels are historical; see the current status report)
- [Card JSON field reference and commented examples](src/library/README.md)

Use a supported Node runtime (`^20.19.0 || >=22.12.0`; the audit used Node 24.19.0):

```sh
Remove-Item -Recurse -Force .\node_modules
npm ci
npm run typecheck:server
npm run typecheck:client
npm test
npm run build
npm start
```

Open `http://localhost:3000` in two separate browser sessions and create/join a room. Development uses `npm run dev` for the backend and `npm run dev:client` for the Vite client on port 5173.

CI runs `npm ci`, both typechecks, `npm test`, and `npm run build` on Node 24. The build compiles the TypeScript server and bundles the React client; run both typechecks separately to check all source types without generating output. `npm run build:client` bundles only the client, and `npm run test:watch` runs the test suite in watch mode.

The active server is `src/server.ts`, the engine is in `src/engine/`, and the React client is in `src/client/`. The `legacy/` directory holds the deprecated pre-refactor prototype and is not the active app. The linked status report describes the pre-milestone baseline. The starter deck and RPS setup are prototype content, and several rules systems are incomplete.
