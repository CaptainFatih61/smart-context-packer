import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/redactor.js';

describe('Security & Secret Redactor (src/redactor.ts)', () => {
  it('redacts AWS access keys and secret keys', () => {
    const fakeAwsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const fakeAwsSecret = 'aws_secret_access_key = "' + ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/') + '"';
    const code = `
      const awsKey = "${fakeAwsKey}";
      const awsSecret = ${fakeAwsSecret};
    `;
    const { redactedContent, count, findings } = redactSecrets(code);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(redactedContent).toContain('[REDACTED:AWS_ACCESS_KEY]');
    expect(redactedContent).toContain('[REDACTED:AWS_SECRET_KEY]');
    expect(redactedContent).not.toContain(fakeAwsKey);
  });

  it('redacts GitHub Personal Access Tokens and Stripe keys', () => {
    const fakeGh = ['ghp', '123456789012345678901234567890123456'].join('_');
    const fakeStripeLive = ['sk', 'live', '51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P'].join('_');
    const fakeStripeTest = ['sk', 'test', '51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P'].join('_');
    const code = `
      const ghToken = "${fakeGh}";
      const stripeLive = "${fakeStripeLive}";
      const stripeTest = "${fakeStripeTest}";
    `;
    const { redactedContent, count } = redactSecrets(code);
    expect(count).toBe(3);
    expect(redactedContent).toContain('[REDACTED:GITHUB_PAT]');
    expect(redactedContent).toContain('[REDACTED:STRIPE_LIVE_KEY]');
    expect(redactedContent).toContain('[REDACTED:STRIPE_TEST_KEY]');
  });

  it('redacts Database connection URIs with embedded passwords', () => {
    const code = `
      const dbUrl = "postgres://postgres:SuperSecretP@ssw0rd!@db.example.com:5432/mydb";
      const mongo = "mongodb://admin:secretPass123@cluster0.mongodb.net/test";
    `;
    const { redactedContent, count } = redactSecrets(code);
    expect(count).toBe(2);
    expect(redactedContent).toContain('postgres://postgres:[REDACTED:PASSWORD]@db.example.com:5432/mydb');
    expect(redactedContent).toContain('mongodb://admin:[REDACTED:PASSWORD]@cluster0.mongodb.net/test');
    expect(redactedContent).not.toContain('SuperSecretP@ssw0rd!');
  });

  it('redacts JWT tokens and private keys', () => {
    const code = `
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const cert = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA0Y...\\n-----END RSA PRIVATE KEY-----";
    `;
    const { redactedContent, count } = redactSecrets(code);
    expect(count).toBe(2);
    expect(redactedContent).toContain('[REDACTED:JWT_TOKEN]');
    expect(redactedContent).toContain('[REDACTED:PRIVATE_KEY]');
  });

  it('preserves clean regular code without false positives', () => {
    const code = `
      export function add(a: number, b: number): number {
        const skyColor = "blue";
        return a + b;
      }
    `;
    const { redactedContent, count } = redactSecrets(code);
    expect(count).toBe(0);
    expect(redactedContent).toBe(code);
  });
});
