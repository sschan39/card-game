export const accountAuthoritySchema = `
ALTER TABLE instance_identity ADD COLUMN accounts_project_id TEXT;
`;
