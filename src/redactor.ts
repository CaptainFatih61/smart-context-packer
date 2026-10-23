/**
 * Security & Secret Redactor for smart-context-packer
 * Detects and masks high-entropy API keys, database URLs, cloud tokens,
 * and private keys to prevent accidental leakage in LLM contexts.
 */

export interface RedactedFinding {
  type: string;
  line: number;
  snippet: string;
}

export interface RedactResult {
  redactedContent: string;
  count: number;
  findings: RedactedFinding[];
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Private Keys
  {
    name: 'PRIVATE_KEY',
    regex: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/gi,
    replacement: '[REDACTED:PRIVATE_KEY]'
  },
  // AWS Access Key ID
  {
    name: 'AWS_ACCESS_KEY',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: '[REDACTED:AWS_ACCESS_KEY]'
  },
  // AWS Secret Key (generic key-value matching with 40-char base64-like secret)
  {
    name: 'AWS_SECRET_KEY',
    regex: /(aws_secret_access_key|aws_secret_key|secret_key)\s*[:=]\s*["']?([A-Za-z0-9\/+=]{40})["']?/gi,
    replacement: '$1 = "[REDACTED:AWS_SECRET_KEY]"'
  },
  // GitHub Personal Access Token
  {
    name: 'GITHUB_TOKEN',
    regex: /\b(ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{22,82})\b/g,
    replacement: '[REDACTED:GITHUB_PAT]'
  },
  // Stripe API Keys
  {
    name: 'STRIPE_SECRET_KEY',
    regex: /\b(sk_live_[0-9a-zA-Z]{24,}|rk_live_[0-9a-zA-Z]{24,})\b/g,
    replacement: '[REDACTED:STRIPE_LIVE_KEY]'
  },
  {
    name: 'STRIPE_RESTRICTED_KEY',
    regex: /\b(sk_test_[0-9a-zA-Z]{24,}|rk_test_[0-9a-zA-Z]{24,})\b/g,
    replacement: '[REDACTED:STRIPE_TEST_KEY]'
  },
  // OpenAI / Anthropic / Generic AI API Keys
  {
    name: 'OPENAI_API_KEY',
    regex: /\b(sk-proj-[a-zA-Z0-9_\-]{40,}|sk-[a-zA-Z0-9]{32,64})\b/g,
    replacement: '[REDACTED:AI_API_KEY]'
  },
  // Slack Tokens
  {
    name: 'SLACK_TOKEN',
    regex: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/g,
    replacement: '[REDACTED:SLACK_TOKEN]'
  },
  // Database Connection URIs with credentials
  {
    name: 'DATABASE_URL',
    regex: /\b((?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|mariadb):\/\/[^:/\s@]+:)(.+?)(@(?:localhost|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|[a-zA-Z0-9_.-]+net|[a-zA-Z0-9_.-]+com)(?::[0-9]+)?(?:\/[^"'\s\n]*)?)/gi,
    replacement: '$1[REDACTED:PASSWORD]$3'
  },
  // Generic Bearer / Authorization Tokens
  {
    name: 'BEARER_TOKEN',
    regex: /(Authorization\s*[:=]\s*["']?Bearer\s+)([A-Za-z0-9_\-\.]{25,})(["']?)/gi,
    replacement: '$1[REDACTED:BEARER_TOKEN]$3'
  },
  // JWT Tokens (3 base64url segments separated by dots)
  {
    name: 'JWT_TOKEN',
    regex: /\b(eyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,})\b/g,
    replacement: '[REDACTED:JWT_TOKEN]'
  },
  // Generic High-Entropy API Key variables: apiKey = "..." / secret = "..."
  {
    name: 'GENERIC_SECRET_ASSIGNMENT',
    regex: /((?:api_?key|secret_?key|auth_?token|client_?secret|app_?secret)\s*[:=]\s*["'])([a-zA-Z0-9_\-]{20,})(["'])/gi,
    replacement: '$1[REDACTED:SECRET_VALUE]$3'
  }
];

/**
 * Redacts secrets from code content.
 */
export function redactSecrets(content: string): RedactResult {
  if (!content) {
    return { redactedContent: content, count: 0, findings: [] };
  }

  let result = content;
  let totalCount = 0;
  const findings: RedactedFinding[] = [];

  for (const pattern of SECRET_PATTERNS) {
    const matchRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = matchRegex.exec(content)) !== null) {
      totalCount++;
      const matchedText = match[0];
      const matchIndex = match.index;
      const line = content.substring(0, matchIndex).split('\n').length;
      findings.push({
        type: pattern.name,
        line,
        snippet: matchedText.length > 30 ? matchedText.substring(0, 15) + '...' + matchedText.substring(matchedText.length - 10) : matchedText
      });

      if (match.index === matchRegex.lastIndex) {
        matchRegex.lastIndex++;
      }
    }

    result = result.replace(pattern.regex, pattern.replacement);
  }

  return {
    redactedContent: result,
    count: totalCount,
    findings
  };
}
