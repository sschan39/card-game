# Milestone 5 implementation ledger

Scope: roadmap Phase 5.1–5.5: independent builder, public filtered catalog, identical shared card face, local editor and shared validation, owned saves/updates, text import/export, and owned-ID game handoff. No engine rule changes. Pull first; commit finished work.

Implementation decisions: React/Vite workspace at port 5175 and `/deck-builder/`; a React-only `packages/ui` face and stylesheet shared with the game; existing protocol schemas and validator used directly. Builder credentials stay in their own per-tab storage. Handoff carries only a UUID, and the game requires its own game-scoped account login and checks the owned list. Local draft storage contains printed deck data only, never a saved record identity. Public config lives in the builder config folder.

Verification complete: 202 unique focused checks passed across 15 files. After the final empty-draft recovery correction, the 30 builder/real-match subset passed again; it is not added to the unique count. All seven project typechecks and four app builds pass. See the [requirement audit and evidence](phase-5-status-2026-10-28.md). User waived browser smoke, long socket tests and the full suite.

Final design notes: play opens a fresh game tab with no opener and a UUID-only URL. The existing single-current-game-session policy is preserved and disclosed: game login rotates the builder credential; focus revalidation clears old authorization while retaining draft work. The real acceptance covers that fresh login as well as a full normal turn. A minimal unrelated-command pass-through regression in the existing engine choice helper was corrected so this flow can run, preserving the prior readability refactor and game rules.
