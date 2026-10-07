# Card game

A two-player, MTG-inspired card game with a TypeScript/Express/Socket.IO engine and a React/Zustand client. The active application is in `src/`; root JavaScript files and `public/` are legacy references.

- [Current status and verification — 7 October 2026](docs/project-status-2026-10-07.md)
- [Future implementation plan — MTG rules fidelity](docs/implementation-plan-2026-10-07.md)
- [Architecture](ARCHITECTURE.md) (some completion labels are historical; see the current status report)

Use a supported Node runtime (`^20.19.0 || >=22.12.0`; the audit used Node 24.19.0):

```sh
npm ci
npm test
npm run build
npm start
```

Open `http://localhost:3000` in two separate browser sessions and create/join a room. Development uses `npm run dev` for the backend and `npm run dev:client` for the Vite client on port 5173.

The production build currently excludes client typechecking. Check it separately with `npx tsc --noEmit -p src/client/tsconfig.json`; the status report records four errors on the audited baseline. The starter deck and RPS setup are prototype content, and several rules systems are incomplete.
