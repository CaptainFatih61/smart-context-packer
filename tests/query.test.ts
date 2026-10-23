import { describe, it, expect } from 'vitest';
import { BM25CodeSearch, tokenizeCode } from '../src/query.js';

describe('In-Memory BM25 Semantic Intent Routing (src/query.ts)', () => {
  it('tokenizes camelCase, snake_case, PascalCase, and paths cleanly', () => {
    const tokens = tokenizeCode('src/auth/jwtTokenVerifier.ts_verify_user_session');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('jwt');
    expect(tokens).toContain('token');
    expect(tokens).toContain('verifier');
    expect(tokens).toContain('verify');
    expect(tokens).toContain('user');
    expect(tokens).toContain('session');
    // Stop words and single letters filtered out
    expect(tokens).not.toContain('ts');
  });

  it('ranks relevant authentication files higher for auth-related queries', () => {
    const searcher = new BM25CodeSearch();

    searcher.addDocument({
      path: 'src/auth/jwt.ts',
      symbols: ['verifyJwtToken', 'generateAccessToken', 'JwtPayload'],
      content: 'Verifies bearer tokens and issues json web tokens for users.'
    });

    searcher.addDocument({
      path: 'src/database/schema.ts',
      symbols: ['UserModel', 'ProductModel', 'OrderTable'],
      content: 'Defines database relational schema and Postgres connections.'
    });

    searcher.addDocument({
      path: 'src/utils/logger.ts',
      symbols: ['logInfo', 'logError', 'Logger'],
      content: 'Standard formatted stdout logger for application tracing.'
    });

    const results = searcher.search('jwt token verification', 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe('src/auth/jwt.ts');
    expect(results[0].matchedTerms).toContain('jwt');
    expect(results[0].matchedTerms).toContain('token');
  });

  it('boosts exported symbol matches over generic body content', () => {
    const searcher = new BM25CodeSearch();

    searcher.addDocument({
      path: 'src/billing/stripe.ts',
      symbols: ['createCheckoutSession', 'handleStripeWebhook'],
      content: 'Integrates Stripe payments and webhook verification.'
    });

    searcher.addDocument({
      path: 'src/misc/notes.txt',
      symbols: [],
      content: 'We need to integrate checkout payments with Stripe later.'
    });

    const results = searcher.search('stripe webhook checkout', 2);
    expect(results[0].path).toBe('src/billing/stripe.ts');
    expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('returns empty array when query has no matching terms', () => {
    const searcher = new BM25CodeSearch();
    searcher.addDocument({
      path: 'src/math.ts',
      symbols: ['add', 'multiply'],
      content: 'Basic arithmetic functions'
    });

    const results = searcher.search('quantum entanglement physics', 5);
    expect(results).toEqual([]);
  });
});
