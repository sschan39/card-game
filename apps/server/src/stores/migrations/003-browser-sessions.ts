/** Existing rows retain legacy bearer semantics. Revocation is explicit for socket notifications. */
export const browserSessionsSchema = `
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy' CHECK(kind IN ('legacy','browser','tab'));
ALTER TABLE sessions ADD COLUMN parent_digest TEXT;
CREATE INDEX sessions_parent ON sessions(parent_digest);
CREATE TABLE instance_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 32),
  purpose TEXT NOT NULL CHECK(purpose IN ('development','live','lab'))
) STRICT;
`;
