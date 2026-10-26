import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors.js';

function matches(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export class TokenService {
  private readonly tokens = new Map<string, number>();
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs = 15 * 60_000,
  ) {
    if (!clientId || !clientSecret) throw new Error('CLIENT_ID and CLIENT_SECRET are required.');
  }

  issue(clientId: string, clientSecret: string) {
    const idMatches = matches(clientId, this.clientId);
    const secretMatches = matches(clientSecret, this.clientSecret);
    if (!idMatches || !secretMatches) throw new AppError(401, 'INVALID_CLIENT', 'Invalid client credentials.');
    for (const [token, expiry] of this.tokens) if (expiry <= this.now()) this.tokens.delete(token);
    const token = randomBytes(32).toString('base64url');
    this.tokens.set(token, this.now() + this.lifetimeMs);
    return { access_token: token, token_type: 'Bearer', expires_in: Math.floor(this.lifetimeMs / 1000) };
  }

  readonly authenticate: RequestHandler = (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? '');
    const token = match?.[1];
    const expiry = token ? this.tokens.get(token) : undefined;
    if (!token || expiry === undefined || expiry <= this.now()) {
      if (token) this.tokens.delete(token);
      res.setHeader('WWW-Authenticate', 'Bearer');
      next(new AppError(401, 'UNAUTHORIZED', 'A valid bearer token is required.'));
      return;
    }
    next();
  };
}
