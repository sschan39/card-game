/** Append migrations; never edit an applied schema version to change its meaning. */
export const initialSchema = `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('player','admin')), password_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL CHECK(disabled IN (0,1)), created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY CHECK(length(digest)=64), id TEXT NOT NULL UNIQUE,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('account','guest')), subject_id TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('game','admin')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  CHECK((subject_kind='account' AND account_id IS NOT NULL AND account_id=subject_id) OR (subject_kind='guest' AND account_id IS NULL AND scope='game'))
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_subject ON sessions(subject_kind,subject_id,scope);
CREATE TABLE decks (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), format TEXT NOT NULL CHECK(format='standard'),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX decks_owner ON decks(owner_id,created_at DESC,id);
CREATE TABLE deck_cards (
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 250), position INTEGER NOT NULL CHECK(position>=0),
  PRIMARY KEY(deck_id,card_id), UNIQUE(deck_id,position)
) STRICT;
`;
