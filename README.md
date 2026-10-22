# Card game

A two-player, MTG-inspired card game with a TypeScript/Express/Socket.IO engine and a React/Zustand client. The active application is in `src/`.

- [Concept map — where things are and how flows run](docs/MAP.md) (start here to navigate the code)
- [Current architecture and verification](ARCHITECTURE.md)
- [Enforced dependency rules](docs/architecture-import-policy.md)
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

The active server is `src/server.ts`, the engine is in `src/engine/`, and the React client is in `src/client/`. Only maintained current-state documentation is tracked. Local development journals, plans, historical audits, milestone reports, review notes, and the retired JavaScript prototype are ignored.
