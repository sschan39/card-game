export class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
