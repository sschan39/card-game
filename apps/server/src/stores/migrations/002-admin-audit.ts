export const adminAuditSchema = `
CREATE TABLE admin_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL, actor_id TEXT,
  action TEXT NOT NULL, target TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('success','denied','not_found')),
  exported INTEGER NOT NULL DEFAULT 0 CHECK(exported IN (0,1))
) STRICT;
CREATE INDEX admin_audit_pending ON admin_audit(exported,sequence);
`;
