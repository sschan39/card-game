import { type AdminAccount } from '@card-game/protocol';
import type { AuthService } from '../auth/service';
import { AuthError } from '../auth/errors';
import type { AuditService } from './audit';

export class AdminAccountService {
  constructor(private readonly auth: AuthService, private readonly audit: AuditService) {}
  disable(actorId: string, targetId: string): AdminAccount {
    const account = this.auth.sessions.atomic(() => {
      const target = this.auth.repository.findAccount(targetId);
      if (!target) throw new AuthError(404, 'Account not found.');
      if (!target.disabled && target.role === 'admin' && this.auth.repository.activeAdminCount() <= 1)
        throw new AuthError(409, 'The final active administrator cannot be disabled.');
      this.auth.repository.saveAccount({ ...target, disabled: true });
      this.auth.sessions.revokeSubject({ kind: 'account', id: target.id }, 'disabled');
      this.audit.record(actorId, 'account.disable', target.id);
      const { passwordHash: _hash, ...publicFields } = target;
      return { ...publicFields, disabled: true };
    });
    this.audit.flush(); return account;
  }
}
