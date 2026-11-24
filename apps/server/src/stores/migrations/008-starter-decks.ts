export const starterDecksSchema = `
ALTER TABLE decks ADD COLUMN starter INTEGER NOT NULL DEFAULT 0 CHECK(starter IN (0,1));
`;
