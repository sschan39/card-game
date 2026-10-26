import { readFileSync, statSync } from 'node:fs';
import { PROTOCOL_VERSION, RegisterRequestSchema } from '@card-game/protocol';
import type { AuthService } from './service';

/** Operator configuration only. Public registration cannot choose a role. */
export async function bootstrapAdmin(auth: AuthService, environment: NodeJS.ProcessEnv): Promise<void> {
  const username = environment.ADMIN_BOOTSTRAP_USERNAME;
  const file = environment.ADMIN_BOOTSTRAP_PASSWORD_FILE;
  const configuredPassword = environment.ADMIN_BOOTSTRAP_PASSWORD;
  if (!username && !file && !configuredPassword) return;
  if (!username || (!file && !configuredPassword) || file && configuredPassword) throw new Error('Incomplete or ambiguous admin bootstrap configuration');
  let password = configuredPassword;
  if (file) {
    if (statSync(file).size > 4096) throw new Error('Admin password file exceeds the input limit');
    password = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  }
  const parsed = RegisterRequestSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, username, password });
  if (!parsed.success) throw new Error('Admin bootstrap does not satisfy account policy');
  await auth.bootstrapAdmin(parsed.data.username, parsed.data.password);
}
