export const auditUnavailableSchema = `
ALTER TABLE admin_audit RENAME TO previous_admin_audit;
CREATE TABLE admin_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL, actor_id TEXT,
  action TEXT NOT NULL, target TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','denied','not_found','unavailable')),
  exported INTEGER NOT NULL DEFAULT 0 CHECK(exported IN (0,1))
) STRICT;
INSERT INTO admin_audit SELECT * FROM previous_admin_audit;
DROP TABLE previous_admin_audit;
CREATE INDEX admin_audit_pending ON admin_audit(exported,sequence);
`;
