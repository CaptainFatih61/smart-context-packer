import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  locatePrismaSchema,
  parsePrismaSchema,
  extractRelevantPrismaSchema,
} from '../src/prisma.js';
import { DependencyAnalyzer } from '../src/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaAppDir = path.resolve(__dirname, 'fixtures/prisma-app');

describe('Smart Prisma Schema Model Extractor', () => {
  const schemaPath = path.join(prismaAppDir, 'prisma/schema.prisma');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

  it('locates schema.prisma in workspace', () => {
    const located = locatePrismaSchema(prismaAppDir);
    expect(located).not.toBeNull();
    expect(located).toContain('schema.prisma');
  });

  it('parses models, relations, enums, and datasources correctly', () => {
    const parsed = parsePrismaSchema(schemaContent);

    expect(parsed.models.has('User')).toBe(true);
    expect(parsed.models.has('Post')).toBe(true);
    expect(parsed.models.has('Profile')).toBe(true);
    expect(parsed.models.has('UnrelatedInvoice')).toBe(true);

    expect(parsed.enums.has('Role')).toBe(true);
    expect(parsed.enums.has('UnrelatedStatus')).toBe(true);

    const userModel = parsed.models.get('User')!;
    expect(userModel.relations).toContain('Post');
    expect(userModel.relations).toContain('Profile');
    expect(userModel.relations).toContain('Role');
  });

  it('extracts ONLY referenced models and direct relations, omitting unrelated models', () => {
    const sampleCode = `
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const user = await prisma.user.findFirst();
    `;

    const extracted = extractRelevantPrismaSchema(schemaContent, [sampleCode]);
    expect(extracted).not.toBeNull();

    // Must contain referenced model and direct relations
    expect(extracted).toContain('model User');
    expect(extracted).toContain('model Post');
    expect(extracted).toContain('model Profile');
    expect(extracted).toContain('enum Role');

    // Must NOT contain unrelated models or enums
    expect(extracted).not.toContain('model UnrelatedInvoice');
    expect(extracted).not.toContain('model UnrelatedAuditLog');
    expect(extracted).not.toContain('enum UnrelatedStatus');
  });

  it('integrates with DependencyAnalyzer to inject virtual prisma schema node', async () => {
    const analyzer = new DependencyAnalyzer({
      cwd: prismaAppDir,
      maxDepth: 1,
    });

    const graph = await analyzer.analyze(['src/user-service.ts']);

    expect(graph.nodes.has('src/user-service.ts')).toBe(true);

    // Should contain the extracted Prisma virtual node
    const virtualPrismaKey = 'prisma/schema.prisma [Extracted Models]';
    expect(graph.nodes.has(virtualPrismaKey)).toBe(true);

    const prismaNode = graph.nodes.get(virtualPrismaKey)!;
    expect(prismaNode.content).toContain('model User');
    expect(prismaNode.content).toContain('model Post');
    expect(prismaNode.content).not.toContain('model UnrelatedInvoice');
  });
});
