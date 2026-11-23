export class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class AuthorityLogoutUnconfirmed extends AuthError {
  constructor() { super(503, 'Signed out of the game. The account service could not confirm sign-out.'); }
}
